"""Build the public problem bank from MBPP-sanitized and HumanEval.

Run only inside the disposable container started by build.mjs. Reference
solutions and tests are executed in subprocesses with timeouts. A problem is
kept only when every retained test passes with the runner's exact JSON rules.

Usage: python3 build.py <data-dir> <output.json>
"""
import ast
import gzip
import json
import multiprocessing
import re
import sys

MAX_VISIBLE = 3
MAX_TESTS = 16
MAX_JSON_BYTES = 8192
POSITIONAL = {"arguments": "positional JSON arguments", "return": "JSON-serializable return value", "comparison": "exact JSON equality"}


def exact_json(value):
    """True when JSON round-trips the value without changing its type."""
    if value is None or isinstance(value, (bool, str)):
        return True
    if isinstance(value, int):
        return abs(value) <= 2**53 - 1
    if isinstance(value, float):
        return value == value and value not in (float("inf"), float("-inf")) and value.is_integer()
    if isinstance(value, list):
        return all(exact_json(item) for item in value)
    if isinstance(value, dict):
        return all(isinstance(key, str) and exact_json(item) for key, item in value.items())
    return False


def as_json(value):
    """Mirror jsonb -> JavaScript -> JSON: tuples become arrays, 2.0 becomes 2,
    and object keys take jsonb's order (shorter keys first, then bytewise)."""
    def integral(item):
        if isinstance(item, float) and item.is_integer():
            return int(item)
        if isinstance(item, list):
            return [integral(child) for child in item]
        if isinstance(item, dict):
            ordered = sorted(item, key=lambda key: (len(key.encode("utf-8")), key.encode("utf-8")))
            return {key: integral(item[key]) for key in ordered}
        return item
    return integral(json.loads(json.dumps(value, allow_nan=False)))


def same(actual, expected):
    """Node's isDeepStrictEqual over parsed JSON: booleans are not numbers."""
    if isinstance(actual, bool) or isinstance(expected, bool):
        return type(actual) is type(expected) and actual == expected
    if isinstance(actual, (int, float)) and isinstance(expected, (int, float)):
        return actual == expected
    if isinstance(actual, list) and isinstance(expected, list):
        return len(actual) == len(expected) and all(same(a, e) for a, e in zip(actual, expected))
    if isinstance(actual, dict) and isinstance(expected, dict):
        return actual.keys() == expected.keys() and all(same(actual[key], expected[key]) for key in actual)
    return type(actual) is type(expected) and actual == expected


def parse_case(node, callee):
    """Extract (args, expected) from `callee(<literals>) == <literal>`."""
    if isinstance(node, ast.Compare) and len(node.ops) == 1 and isinstance(node.ops[0], ast.Eq):
        call, expected_node = node.left, node.comparators[0]
    elif isinstance(node, ast.Call):
        call, expected_node = node, ast.Constant(True)
    elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not) and isinstance(node.operand, ast.Call):
        call, expected_node = node.operand, ast.Constant(False)
    else:
        return None
    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == callee and not call.keywords):
        return None
    try:
        args = [ast.literal_eval(arg) for arg in call.args]
        expected = ast.literal_eval(expected_node)
    except (ValueError, SyntaxError, TypeError, MemoryError, RecursionError):
        return None
    if not all(exact_json(arg) for arg in args):
        return None
    try:
        args = as_json(args)
        expected = as_json(expected)
    except (TypeError, ValueError):
        return None
    if not exact_json(expected) or len(json.dumps(args)) > MAX_JSON_BYTES or len(json.dumps(expected)) > MAX_JSON_BYTES:
        return None
    return {"args": args, "expected": expected}


def mbpp_candidates(path):
    for item in json.load(open(path, encoding="utf-8")):
        if item.get("test_imports"):
            continue
        callees = set()
        for line in item["test_list"]:
            match = re.match(r"\s*assert\s+(?:not\s+)?(?:\(?\s*)?([A-Za-z_]\w*)\s*\(", line)
            if match:
                callees.add(match.group(1))
        if len(callees) != 1:
            continue
        entry = callees.pop()
        cases = []
        for line in item["test_list"]:
            try:
                statement = ast.parse(line.strip()).body[0]
            except SyntaxError:
                continue
            if isinstance(statement, ast.Assert):
                case = parse_case(statement.test, entry)
                if case:
                    cases.append(case)
        yield {"source": "mbpp", "sourceId": item["task_id"], "entry": entry, "prompt": item["prompt"].strip(), "reference": item["code"].replace("\r\n", "\n").strip() + "\n", "cases": cases, "docstring": None}


def humaneval_candidates(path):
    for line in gzip.open(path, "rt", encoding="utf-8"):
        item = json.loads(line)
        entry = item["entry_point"]
        try:
            check = next(node for node in ast.parse(item["test"]).body if isinstance(node, ast.FunctionDef) and node.name == "check")
        except (StopIteration, SyntaxError):
            continue
        cases = []
        for statement in check.body:
            if isinstance(statement, ast.Assert):
                case = parse_case(statement.test, "candidate")
                if case:
                    cases.append(case)
        tree = ast.parse(item["prompt"])
        function = next((node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == entry), None)
        docstring = ast.get_docstring(function) if function else None
        yield {"source": "humaneval", "sourceId": int(item["task_id"].split("/")[1]), "entry": entry, "prompt": item["prompt"], "reference": item["prompt"] + item["canonical_solution"], "cases": cases, "docstring": docstring}


def run_case(queue, source, entry, args):
    try:
        scope = {"__name__": "reference"}
        exec(compile(source, "reference.py", "exec"), scope)
        queue.put(("ok", as_json(scope[entry](*args))))
    except BaseException as error:  # noqa: BLE001 - any failure excludes the case
        queue.put(("error", repr(error)[:200]))


def verify(candidate, case):
    queue = multiprocessing.Queue()
    process = multiprocessing.Process(target=run_case, args=(queue, candidate["reference"], candidate["entry"], case["args"]))
    process.start()
    process.join(5)
    if process.is_alive():
        process.kill()
        return False
    try:
        status, actual = queue.get(timeout=1)
    except Exception:  # noqa: BLE001
        return False
    return status == "ok" and same(actual, case["expected"])


def title(entry):
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", entry).lower().replace("__", "_").strip("_").split("_")
    text = " ".join(word for word in words if word)
    return text[:1].upper() + text[1:]


TOPICS = [
    ("Bit manipulation", r"\bbits?\b|binary|xor|bitwise|\bset bits?\b"),
    ("Strings", r"string|\bchar|word|vowel|palindrome|substring|letter|uppercase|lowercase|sentence|text"),
    ("Hash maps & sets", r"dictionar|\bdict\b|frequency|occurr|count the number of|unique|duplicate|distinct"),
    ("Matrices", r"matrix|matrices|list of lists|nested list|2d|grid"),
    ("Sorting & searching", r"\bsort|search|smallest|largest|minimum|maximum|\bmin\b|\bmax\b|median|kth|k-th"),
    ("Math & number theory", r"prime|factorial|fibonacci|\bgcd\b|\blcm\b|digit|divisib|number|sum of|square|cube|power|perfect|even|odd|integer"),
    ("Arrays & lists", r"list|array|sequence|tuple|element"),
]


def topic(prompt):
    text = prompt.lower()
    for name, pattern in TOPICS:
        if re.search(pattern, text):
            return name
    return "Fundamentals"


def difficulty(source, entry):
    """Heuristic from the reference's size and nesting; review before relying on it."""
    tree = ast.parse(source)
    function = next((node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == entry), None)
    if function is None:
        return "Medium"
    lines = {node.lineno for node in ast.walk(function) if isinstance(node, ast.stmt)} - {function.lineno}
    helpers = sum(isinstance(node, ast.FunctionDef) for node in tree.body) - 1
    depth = 0

    def loop_depth(node, current=0):
        nonlocal depth
        for child in ast.iter_child_nodes(node):
            nested = current + isinstance(child, (ast.For, ast.While, ast.comprehension))
            depth = max(depth, nested)
            loop_depth(child, nested)

    loop_depth(function)
    score = len(lines) + 3 * helpers + 3 * max(0, depth - 1)
    return "Easy" if score <= 5 else "Medium" if score <= 14 else "Hard"


def call_text(entry, args):
    return f"{entry}({', '.join(repr(arg) for arg in args)})"


def starter(candidate):
    if candidate["source"] == "humaneval":
        return candidate["prompt"].rstrip() + "\n    pass\n"
    tree = ast.parse(candidate["reference"])
    function = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef) and node.name == candidate["entry"])
    parameters = ", ".join(arg.arg for arg in function.args.args)
    return f"def {candidate['entry']}({parameters}):\n    pass\n"


def spread(cases):
    """Order cases so the visible prefix covers as many distinct answers as possible."""
    chosen, rest, seen = [], [], set()
    for case in cases:
        key = json.dumps(case["expected"], sort_keys=True)
        (rest if key in seen else chosen).append(case)
        seen.add(key)
    return chosen[:MAX_VISIBLE] + rest + chosen[MAX_VISIBLE:]


def build(candidate, cases):
    prefix = "mbpp" if candidate["source"] == "mbpp" else "humaneval"
    problem_id = f"{prefix}-{candidate['sourceId']}-v1"
    example = cases[0]
    if candidate["source"] == "mbpp":
        prompt = f"{candidate['prompt']}\n\nExample: {call_text(candidate['entry'], example['args'])} returns {example['expected']!r}."
    else:
        prompt = candidate["docstring"] or candidate["prompt"]
    return {
        "id": problem_id,
        "familyId": problem_id[:-3],
        "title": title(candidate["entry"]),
        "topic": topic(candidate["prompt"] if candidate["source"] == "mbpp" else (candidate["docstring"] or "")),
        "difficulty": difficulty(candidate["reference"], candidate["entry"]),
        "prompt": prompt,
        "starterCode": starter(candidate),
        "referenceSolution": candidate["reference"],
        "clarificationGuidance": f"Confirm the example: {call_text(candidate['entry'], example['args'])} returns {example['expected']!r}. Ask about empty, repeated, or boundary inputs before coding.",
        "helpGuidance": "Ask the candidate to trace the first visible example by hand and state the rule they applied before changing code.",
        "entryPoint": candidate["entry"],
        "testContract": POSITIONAL,
        "source": f"{'MBPP-sanitized' if prefix == 'mbpp' else 'HumanEval'} task {candidate['sourceId']}",
        "tests": [{"id": f"{problem_id[:-3]}-t{index + 1}-v1", "inputData": {"args": case["args"]}, "expectedOutput": case["expected"], "visibility": "visible" if index < MAX_VISIBLE else "hidden"} for index, case in enumerate(cases[:MAX_TESTS])],
    }


def main():
    data, output = sys.argv[1], sys.argv[2]
    candidates = [*mbpp_candidates(f"{data}/sanitized-mbpp.json"), *humaneval_candidates(f"{data}/HumanEval.jsonl.gz")]
    problems, skipped = [], {"too_few_tests": 0, "single_answer": 0, "reference_failed": 0, "bad_entry": 0}
    for candidate in candidates:
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,127}", candidate["entry"]) or candidate["entry"].startswith("__"):
            skipped["bad_entry"] += 1
            continue
        if len(candidate["cases"]) < 2:
            skipped["too_few_tests"] += 1
            continue
        # One repeated answer lets a constant return pass every test.
        if len({json.dumps(case["expected"], sort_keys=True) for case in candidate["cases"]}) < 2:
            skipped["single_answer"] += 1
            continue
        if not all(verify(candidate, case) for case in candidate["cases"]):
            skipped["reference_failed"] += 1
            continue
        problems.append(build(candidate, spread(candidate["cases"])))
    json.dump({"problems": problems, "candidates": len(candidates), "skipped": skipped}, open(output, "w", encoding="utf-8"), indent=1)
    print(json.dumps({"kept": len(problems), "candidates": len(candidates), "skipped": skipped}))


if __name__ == "__main__":
    main()
