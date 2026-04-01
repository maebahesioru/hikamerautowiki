import { NextResponse } from "next/server";
import { z } from "zod";
import { runFactCheckPipeline } from "@/lib/pipeline";
import { validateFactCheckEnv } from "@/lib/serverEnv";
import type { Proposal } from "@/lib/types";

export const maxDuration = 300;

const bodySchema = z.object({
  wikiTitle: z.string().min(1, "ページ名を入力してください"),
  /** 観点・補足（空可） */
  instruction: z.string().optional(),
  tweetQuery: z.string().optional(),
  tweetSince: z.string().optional(),
  tweetUntil: z.string().optional(),
  /** 空でページ全文。指定時は抜粋を主に検証 */
  focusWikitext: z.string().optional(),
  stream: z.boolean().optional(),
});

function sseLine(obj: Record<string, unknown>): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function proposalFromBody(data: z.infer<typeof bodySchema>): Proposal {
  const now = new Date().toISOString();
  const ins = data.instruction?.trim() || "（指示なし）";
  return {
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    status: "draft",
    wikiTitle: data.wikiTitle.trim(),
    instruction: ins,
    tweetQuery: data.tweetQuery?.trim() || undefined,
    tweetSince: data.tweetSince?.trim() || undefined,
    tweetUntil: data.tweetUntil?.trim() || undefined,
  };
}

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

  const proposal = proposalFromBody(parsed.data);
  const useStream = parsed.data.stream === true;
  const focusWikitext = parsed.data.focusWikitext?.trim() || undefined;

  const envErr = validateFactCheckEnv();
  if (envErr) return envErr;

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
          const result = await runFactCheckPipeline(proposal, {
            focusWikitext,
            onProgress: (message) => {
              controller.enqueue(sseLine({ type: "progress", message }));
            },
            onAiStream: (phase, delta) => {
              controller.enqueue(
                sseLine({ type: "ai_stream", phase, delta })
              );
            },
          });
          controller.enqueue(
            sseLine({
              type: "complete",
              ok: true,
              tweetQueryUsed: result.tweetQueryUsed,
              tweetQueriesUsed: result.tweetQueriesUsed,
              tweetCount: result.tweetCount,
              log: result.log,
              report: result.report,
            })
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          controller.enqueue(
            sseLine({
              type: "complete",
              ok: false,
              error: msg,
            })
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
    const result = await runFactCheckPipeline(proposal, {
      focusWikitext,
    });
    return NextResponse.json({
      ok: true,
      tweetQueryUsed: result.tweetQueryUsed,
      tweetQueriesUsed: result.tweetQueriesUsed,
      tweetCount: result.tweetCount,
      log: result.log,
      report: result.report,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
