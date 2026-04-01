import { describe, expect, it } from "vitest";
import { normalizeChatCompletionUsage } from "@/lib/openaiUsage";

describe("normalizeChatCompletionUsage", () => {
  it("maps OpenAI-style keys", () => {
    const u = normalizeChatCompletionUsage({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30,
    });
    expect(u.inputTokens).toBe(10);
    expect(u.outputTokens).toBe(20);
    expect(u.totalTokens).toBe(30);
  });

  it("sums input+output when total missing", () => {
    const u = normalizeChatCompletionUsage({
      prompt_tokens: 5,
      completion_tokens: 7,
    });
    expect(u.totalTokens).toBe(12);
  });
});
