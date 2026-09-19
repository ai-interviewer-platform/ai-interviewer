export const contract = { arguments: "values: list", return: "JSON-serializable return value", comparison: "exact JSON equality" };
export const correct = "def solve(values):\n    return sum(values[1::2])\n";
export function fixture(sourceCode = correct) {
  return { attemptId: "fictional-attempt", checkpointId: "fictional-checkpoint", sourceCode, entryPoint: "solve", testContract: { ...contract }, tests: [{ testId: "empty", inputData: { args: [[]] }, expectedOutput: 0 }, { testId: "values", inputData: { args: [[4, 7, 2, 9]] }, expectedOutput: 16 }] };
}
