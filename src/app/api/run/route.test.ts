import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/serverEnv", () => ({
  validateRunEnv: vi.fn(() => null),
}));

vi.mock("@/lib/pipeline", () => ({
  runProposalPipeline: vi.fn(),
}));

import { POST } from "./route";
import { runProposalPipeline } from "@/lib/pipeline";
import type { PipelineRunLog } from "@/lib/types";

const mockLog: PipelineRunLog = {
  querySource: "ai",
  tweetQueryUsed: "q",
  tweetQueriesUsed: ["q"],
  yahooCount: 0,
  dbCount: 0,
  mergedTweetCount: 0,
  cap: 10000,
  aiStrategy: "full",
  aiPatchCount: 0,
};

describe("POST /api/run", () => {
  beforeEach(() => {
    vi.mocked(runProposalPipeline).mockResolvedValue({
      tweetQueryUsed: "q",
      tweetQueriesUsed: ["q"],
      tweetCount: 0,
      applied: false,
      log: mockLog,
      proposal: {
        id: "p1",
        createdAt: "2020-01-01T00:00:00.000Z",
        updatedAt: "2020-01-01T00:00:00.000Z",
        wikiTitle: "Test",
        instruction: "hi",
        status: "draft",
      },
    });
  });

  it("JSON が空なら 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/run", {
        method: "POST",
        body: "",
      })
    );
    expect(res.status).toBe(400);
  });

  it("必須フィールド欠落なら 400", async () => {
    const res = await POST(
      new Request("http://localhost/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wikiTitle: "A" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("非ストリームでパイプライン成功なら 200 と ok", async () => {
    const res = await POST(
      new Request("http://localhost/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wikiTitle: "Page",
          instruction: "Do",
          dryRun: true,
        }),
      })
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok?: boolean };
    expect(json.ok).toBe(true);
    expect(runProposalPipeline).toHaveBeenCalled();
  });

  it("stream: true なら event-stream と complete イベント", async () => {
    const res = await POST(
      new Request("http://localhost/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wikiTitle: "Page",
          instruction: "Do",
          dryRun: true,
          stream: true,
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toContain('"type":"complete"');
    expect(text).toContain('"ok":true');
  });
});
