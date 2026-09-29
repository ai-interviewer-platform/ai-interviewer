// Owner decision 2026-09-28: Workers AI through the AI binding (no provider key).
// K2.6 with reasoning off serves both jobs. Reviews must finish inside the review
// provider timeout (45 s, under the 60 s idle-transaction limit that holds the review
// lock); K2.7 Code (always reasoning) took 36-53 s and timed out. Needs Workers Paid.
export const REVIEW_MODEL = "@cf/moonshotai/kimi-k2.6";
export const INTERVIEWER_MODEL = "@cf/moonshotai/kimi-k2.6";

export type ModelMessage = { role: "system" | "user" | "assistant"; content: string };
export type ModelInput = {
  messages: ModelMessage[];
  max_completion_tokens: number;
  reasoning_effort?: "none" | "high";
  response_format?: { type: "json_schema"; json_schema: { name: string; strict: boolean; schema: unknown } };
};
type ChatCompletion = { choices?: Array<{ finish_reason?: string | null; message?: { content?: string | null } }> };

// Returns the text of a completed response. Truncation, filtering, and empty
// output throw, so callers never publish a partial or substituted answer.
export async function modelText(ai: Ai, model: string, input: ModelInput, options: { attempts: number; timeoutMs: number }): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("the model timed out")), options.timeoutMs); });
      // Called as a method: the binding needs its `this`. The cast covers models newer than the generated types.
      const binding = ai as unknown as { run(model: string, input: ModelInput): Promise<ChatCompletion> };
      const response = await Promise.race([binding.run(model, input), timeout]).finally(() => clearTimeout(timer));
      const choice = response.choices?.[0];
      if (choice?.finish_reason !== "stop") throw new Error(`the model stopped with ${choice?.finish_reason ?? "no finish reason"}`);
      const text = choice.message?.content?.trim();
      if (!text) throw new Error("the model returned no text");
      return text;
    } catch (error) {
      if (attempt >= options.attempts) throw error;
    }
  }
}
