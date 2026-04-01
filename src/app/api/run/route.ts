import { NextResponse } from "next/server";
import { z } from "zod";
import { decodeAndValidateAttachedImages } from "@/lib/inlineAttachmentImages";
import { runProposalPipeline } from "@/lib/pipeline";
import { validateRunEnv } from "@/lib/serverEnv";
import type { Proposal } from "@/lib/types";

/** AI + Wiki パイプラインが長引くため（Vercel の既定 10s では足りないことがある） */
export const maxDuration = 300;

const bodySchema = z
  .object({
    wikiTitle: z.string().min(1, "ページ名を入力してください"),
    instruction: z.string().optional(),
    tweetQuery: z.string().optional(),
    tweetSince: z.string().optional(),
    tweetUntil: z.string().optional(),
    dryRun: z.boolean().optional(),
    /** true のとき text/event-stream で進捗を逐次送信し、最後に complete イベント */
    stream: z.boolean().optional(),
    /** true のとき既存ページに本文がある場合はエラーにして新規作成のみ許可 */
    createNew: z.boolean().optional(),
    /** 記事編集・新規: 添付画像（base64）。最大 10 枚・各 8MB まで */
    attachedImages: z
      .array(
        z.object({
          name: z.string().max(200),
          dataBase64: z.string().max(12_000_000),
          mimeType: z.string().max(80),
        })
      )
      .max(10)
      .optional(),
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

function sseLine(obj: Record<string, unknown>): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function proposalFromBody(
  data: z.infer<typeof bodySchema>
): Proposal {
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
  const dryRun = parsed.data.dryRun ?? false;
  const useStream = parsed.data.stream === true;

  let attachedDecoded: ReturnType<typeof decodeAndValidateAttachedImages> | undefined;
  if (parsed.data.attachedImages?.length) {
    try {
      attachedDecoded = decodeAndValidateAttachedImages(
        parsed.data.attachedImages
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  const envErr = validateRunEnv(dryRun);
  if (envErr) return envErr;

  if (useStream) {
    const stream = new ReadableStream({
      async start(controller) {
        const heartbeatMs = 20_000;
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(
              sseLine({ type: "heartbeat", at: Date.now() })
            );
          } catch {
            /* ストリームが閉じたあと */
          }
        }, heartbeatMs);
        try {
          const result = await runProposalPipeline(proposal, {
            dryRun,
            attachedImages: attachedDecoded,
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
              applied: result.applied,
              log: result.log,
              proposal: result.proposal,
            })
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const failed: Proposal = {
            ...proposal,
            status: "error",
            lastError: msg,
            updatedAt: new Date().toISOString(),
          };
          controller.enqueue(
            sseLine({
              type: "complete",
              ok: false,
              error: msg,
              proposal: failed,
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
    const result = await runProposalPipeline(proposal, {
      dryRun,
      attachedImages: attachedDecoded,
    });
    return NextResponse.json({
      ok: true,
      tweetQueryUsed: result.tweetQueryUsed,
      tweetQueriesUsed: result.tweetQueriesUsed,
      tweetCount: result.tweetCount,
      applied: result.applied,
      log: result.log,
      proposal: result.proposal,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const failed: Proposal = {
      ...proposal,
      status: "error",
      lastError: msg,
      updatedAt: new Date().toISOString(),
    };
    return NextResponse.json(
      { ok: false, error: msg, proposal: failed },
      { status: 500 }
    );
  }
}
