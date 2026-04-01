import { NextResponse } from "next/server";
import { serverEnvSummary } from "@/lib/serverEnv";

/**
 * 設定の有無を返す（ロードバランサ用）。認証はミドルウェアから除外。
 * `HIKAMER_EXPOSE_ENV_HEALTH=1` のときは missing 配列も含める（運用者向け）。
 */
export async function GET() {
  const summary = serverEnvSummary();
  const expose = process.env.HIKAMER_EXPOSE_ENV_HEALTH?.trim() === "1";
  if (expose) {
    return NextResponse.json(summary);
  }
  return NextResponse.json({
    ok: summary.ok,
    openAiConfigured: summary.openAi.configured,
    wikiWriteConfigured: summary.wikiWrite.configured,
  });
}
