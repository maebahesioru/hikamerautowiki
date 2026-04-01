import { describe, expect, it } from "vitest";
import {
  formatOpenAiCompatibleErrorForHuman,
  parseOpenAiCompatibleErrorBody,
} from "@/lib/openaiErrorParse";

describe("parseOpenAiCompatibleErrorBody", () => {
  it("classifies context length", () => {
    const raw = JSON.stringify({
      error: {
        message: "This model's maximum context length is 8192 tokens",
        code: "context_length_exceeded",
      },
    });
    const p = parseOpenAiCompatibleErrorBody(raw);
    expect(p.kind).toBe("context");
  });

  it("classifies when 1048576 token limit appears in message", () => {
    const raw = JSON.stringify({
      error: { message: "Total tokens 1048577 exceeds limit 1048576" },
    });
    const p = parseOpenAiCompatibleErrorBody(raw);
    expect(p.kind).toBe("context");
  });

  it("classifies safety", () => {
    const raw = JSON.stringify({
      error: { message: "Content blocked by safety filters", code: "content_policy" },
    });
    const p = parseOpenAiCompatibleErrorBody(raw);
    expect(p.kind).toBe("safety");
  });
});

describe("formatOpenAiCompatibleErrorForHuman", () => {
  it("prefixes context errors", () => {
    const s = formatOpenAiCompatibleErrorForHuman(
      JSON.stringify({
        error: { message: "maximum context length exceeded", code: "invalid_request" },
      })
    );
    expect(s).toContain("コンテキスト超過");
  });
});
