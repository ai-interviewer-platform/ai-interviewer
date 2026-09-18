"""Untrusted-side adapter, run ONLY in a disposable restricted container.

No expected values, test IDs or verdicts enter this process. Its entire output
is untrusted; comparison and result assembly happen in the Node controller.
"""
import json
import os
import sys
import tempfile
import traceback

LIMIT = 8192
request = json.load(sys.stdin)
# Save the protocol FD and capture even os.write(1/2, ...) from the solution.
protocol = os.dup(1)
stdout = tempfile.TemporaryFile()
stderr = tempfile.TemporaryFile()
os.dup2(stdout.fileno(), 1)
os.dup2(stderr.fileno(), 2)
result = {}
try:
    scope = {"__name__": "candidate"}
    exec(compile(request["sourceCode"], "candidate.py", "exec"), scope)
    function = scope.get(request["entryPoint"])
    if not callable(function):
        raise ValueError("Entry point is missing or is not callable")
    result["actualOutput"] = function(*request["args"])
    # Reject non-JSON values, nonfinite floats and oversized results.
    encoded = json.dumps(result["actualOutput"], allow_nan=False)
    if len(encoded.encode("utf-8")) > LIMIT:
        raise ValueError("Return value exceeds 8 KiB")
except BaseException:
    result = {"error": traceback.format_exc(limit=8)[-LIMIT:]}
finally:
    sys.stdout.flush()
    sys.stderr.flush()
    for name, stream in [("stdout", stdout), ("stderr", stderr)]:
        stream.seek(0)
        value = stream.read(LIMIT + 1)
        result[name] = value[:LIMIT].decode("utf-8", errors="replace")
        if len(value) > LIMIT:
            result.pop("actualOutput", None)
            result["error"] = "Output exceeds 8 KiB per stream"
    if "error" in result:
        result["stderr"] = (result["stderr"] + result["error"])[-LIMIT:]
    os.write(protocol, json.dumps(result, allow_nan=False).encode("utf-8"))
