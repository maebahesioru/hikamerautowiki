import { NextResponse } from "next/server";
import { z } from "zod";
import {
  fetchBootstrapEvidenceOnly,
  gatherProposalEvidence,
} from "@/lib/pipeline";
import { formatTokenUsageForProgressLine } from "@/lib/openaiUsage";
import { validateRunEnv } from "@/lib/serverEnv";
import type { Proposal } from "@/lib/types";

function sseLine(obj: Record<string, unknown>): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

export const maxDuration = 300;

const bodySchema = z
  .object({
    wikiTitle: z.string().min(1, "ページ名を入力してください"),
    instruction: z.string().optional(),
    tweetQuery: z.string().optional(),
    tweetSince: z.string().optional(),
    tweetUntil: z.string().optional(),
    createNew: z.boolean().optional(),
    /** true のとき text/event-stream で gather の進捗を逐次送信し、最後に complete */
    stream: z.boolean().optional(),
    /** true のときページ名のみのブートストラップ取得だけ（検索クエリ生成前） */
    bootstrapOnly: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.createNew === true) return;
    if (!(data.instruction ?? "").trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "指示を入力してください",
        path: ["instruction"],
      });
    }
  });

function proposalFromBody(data: z.infer<typeof bodySchema>): Proposal {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "draft",
    wikiTitle: data.wikiTitle.trim(),
    instruction: (data.instruction ?? "").trim(),
    tweetQuery: data.tweetQuery?.trim() || undefined,
    tweetSince: data.tweetSince?.trim() || undefined,
    tweetUntil: data.tweetUntil?.trim() || undefined,
    createNewArticle: data.createNew === true,
  };
}

/**
 * ツイート・Wiki 検索の取得のみ（パイプライン本体の事前プレビュー用）。
 */
export async function POST(req: Request) {
  let json: unknown;
  try {
    const t = await req.text();
    if (!t) {
      return NextResponse.json({ error: "JSON ボディが空です" }, { status: 400 });
    }
    json = JSON.parse(t);
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const envErr = validateRunEnv(false);
  if (envErr) return envErr;

  const proposal = proposalFromBody(parsed.data);
  const useStream = parsed.data.stream === true;
  const bootstrapOnly = parsed.data.bootstrapOnly === true;

  if (bootstrapOnly) {
    if (proposal.tweetQuery?.trim()) {
      return NextResponse.json(
        { error: "bootstrapOnly は登録検索クエリ未使用のときのみ使えます" },
        { status: 400 }
      );
    }
    if (useStream) {
      const stream = new ReadableStream({
        async start(controller) {
          const heartbeatMs = 20_000;
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(sseLine({ type: "heartbeat", at: Date.now() }));
            } catch {
              /* ストリームが閉じたあと */
            }
          }, heartbeatMs);
          try {
            const { bootstrapTweets, cap } = await fetchBootstrapEvidenceOnly(
              proposal,
              (message) => {
                controller.enqueue(sseLine({ type: "progress", message }));
              }
            );
            controller.enqueue(
              sseLine({
                type: "complete",
                ok: true,
                bootstrapOnly: true,
                bootstrapTweets: bootstrapTweets ?? [],
                cap,
              })
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            controller.enqueue(
              sseLine({ type: "complete", ok: false, error: msg })
            );
          } finally {
            clearInterval(heartbeat);
            controller.close();
          }
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }
    try {
      const { bootstrapTweets, cap } = await fetchBootstrapEvidenceOnly(
        proposal,
        undefined
      );
      return NextResponse.json({
        ok: true,
        bootstrapOnly: true,
        bootstrapTweets: bootstrapTweets ?? [],
        cap,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  if (useStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const heartbeatMs = 20_000;
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(sseLine({ type: "heartbeat", at: Date.now() }));
          } catch {
            /* ストリームが閉じたあと */
          }
        }, heartbeatMs);
        try {
          const g = await gatherProposalEvidence(
            proposal,
            (message) => {
              controller.enqueue(sseLine({ type: "progress", message }));
            },
            {
              onStreamDelta: (delta) => {
                controller.enqueue(
                  sseLine({
                    type: "ai_stream",
                    phase: "suggest_queries",
                    delta,
                  })
                );
              },
              onReasoningStreamDelta: (delta) => {
                controller.enqueue(
                  sseLine({
                    type: "ai_stream",
                    phase: "suggest_queries_reasoning",
                    delta,
                  })
                );
              },
              onTokenUsage: (u) => {
                controller.enqueue(
                  sseLine({
                    type: "progress",
                    message: formatTokenUsageForProgressLine(
                      u,
                      "検索クエリ生成"
                    ),
                  })
                );
              },
            }
          );
          controller.enqueue(
            sseLine({
              type: "complete",
              ok: true,
              tweets: g.tweets,
              cap: g.cap,
            })
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(
            sseLine({ type: "complete", ok: false, error: msg })
          );
        } finally {
          clearInterval(heartbeat);
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  }

  try {
    const g = await gatherProposalEvidence(proposal, undefined, undefined);
    return NextResponse.json({
      ok: true,
      tweets: g.tweets,
      cap: g.cap,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
