import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatCompletionStream, readOpenAiSseBody } from "./openaiCompat";

function encodeSse(lines: string[]): Uint8Array {
  return new TextEncoder().encode(lines.join("\n") + "\n");
}

function streamFromChunks(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(chunks[i++]);
      } else {
        controller.close();
      }
    },
  });
}

describe("readOpenAiSseBody", () => {
  it("concatenates delta.content chunks", async () => {
    const body = streamFromChunks([
      encodeSse([
        'data: {"choices":[{"delta":{"content":"He"}}]}',
        'data: {"choices":[{"delta":{"content":"llo"}}]}',
        "data: [DONE]",
      ]),
    ]);
    const deltas: string[] = [];
    const r = await readOpenAiSseBody(body, (t) => deltas.push(t));
    expect(r.content).toBe("Hello");
    expect(deltas).toEqual(["He", "llo"]);
    expect(r.diagnostics.streamContentChars).toBe(5);
  });

  it("reads delta.text when content absent", async () => {
    const body = streamFromChunks([
      encodeSse(['data: {"choices":[{"delta":{"text":"ok"}}]}', "data: [DONE]"]),
    ]);
    const r = await readOpenAiSseBody(body, () => {});
    expect(r.content).toBe("ok");
  });

  it("reads delta.output_text when content absent", async () => {
    const body = streamFromChunks([
      encodeSse([
        'data: {"choices":[{"delta":{"output_text":"z"}}]}',
        "data: [DONE]",
      ]),
    ]);
    const r = await readOpenAiSseBody(body, () => {});
    expect(r.content).toBe("z");
  });

  it("reads candidates[0].content.parts[].text", async () => {
    const j = {
      candidates: [
        {
          content: {
            parts: [{ text: "g" }],
          },
        },
      ],
    };
    const body = streamFromChunks([
      encodeSse([`data: ${JSON.stringify(j)}`, "data: [DONE]"]),
    ]);
    const r = await readOpenAiSseBody(body, () => {});
    expect(r.content).toBe("g");
  });

  it("empty stream with stop and usage yields empty content and diagnostics", async () => {
    const body = streamFromChunks([
      encodeSse([
        'data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}',
        'data: {"choices":[{"finish_reason":"stop","delta":{},"index":0}]}',
        'data: {"usage":{"prompt_tokens":645000,"completion_tokens":0,"total_tokens":645000}}',
        "data: [DONE]",
      ]),
    ]);
    const r = await readOpenAiSseBody(body, () => {});
    expect(r.content).toBe("");
    expect(r.diagnostics.finishReasons).toContain("stop");
    expect(r.diagnostics.streamContentChars).toBe(0);
    expect(r.diagnostics.streamReasoningChars).toBe(0);
    const u = r.usage as Record<string, unknown>;
    expect(u.completion_tokens).toBe(0);
  });

  it("multi-line pretty-printed JSON breaks parse (sseParseFailures)", async () => {
    const bad = new TextEncoder().encode(
      'data: {\n  "choices": [{"delta": {"content": "x"}}]\n}\n'
    );
    const body = streamFromChunks([bad]);
    const r = await readOpenAiSseBody(body, () => {});
    expect(r.content).toBe("");
    expect(r.diagnostics.sseParseFailures).toBeGreaterThan(0);
  });

  it("splits utf-8 across byte chunks without corrupting text", async () => {
    const line = 'data: {"choices":[{"delta":{"content":"あ"}}]}\n';
    const full = new TextEncoder().encode(line);
    const c1 = full.slice(0, 2);
    const c2 = full.slice(2);
    const body = streamFromChunks([c1, c2]);
    const r = await readOpenAiSseBody(body, () => {});
    expect(r.content).toBe("あ");
  });

  it("uses reasoning channel as content when assistant content empty", async () => {
    const body = streamFromChunks([
      encodeSse([
        'data: {"choices":[{"delta":{"reasoning_content":"think"}}]}',
        "data: [DONE]",
      ]),
    ]);
    const r = await readOpenAiSseBody(body, () => {});
    expect(r.content).toBe("think");
    expect(r.diagnostics.streamReasoningChars).toBe(5);
  });
});

describe("chatCompletionStream (mock fetch)", () => {
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubEnv("OPENAI_API_BASE", "http://test.invalid/v1");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENAI_MODEL", "mock-model");
    vi.stubEnv("HIKAMER_OPENAI_STREAM_INCLUDE_USAGE", "0");
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    vi.unstubAllEnvs();
  });

  it("returns assembled text from mock SSE", async () => {
    const payload = {
      choices: [{ delta: { content: '{"a":1}' } }],
    };
    const sse = `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n`;
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        })
      )
    ) as typeof fetch;

    const r = await chatCompletionStream(
      [{ role: "user", content: "hi" }],
      {
        jsonObject: false,
        onDelta: () => {},
      }
    );
    expect(r.content).toBe('{"a":1}');
    expect(r.model).toBe("mock-model");
  });
});
