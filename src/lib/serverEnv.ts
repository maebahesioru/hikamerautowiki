import { NextResponse } from "next/server";

/** OpenAI 互換 API（/api/run, /api/fact-check）に必要 */
export function missingOpenAiEnv(): string[] {
  const m: string[] = [];
  if (!process.env.OPENAI_API_KEY?.trim()) m.push("OPENAI_API_KEY");
  return m;
}

/** Wiki への書き込み（反映・リダイレクト）に必要 */
export function missingWikiWriteEnv(): string[] {
  const m: string[] = [];
  if (!process.env.WIKI_USERNAME?.trim()) m.push("WIKI_USERNAME");
  if (!process.env.WIKI_PASSWORD?.trim()) m.push("WIKI_PASSWORD");
  return m;
}

export function jsonEnvError(
  missing: string[],
  message: string
): NextResponse {
  return NextResponse.json(
    { error: message, missingEnv: missing },
    { status: 503 }
  );
}

/** /api/run 用: dryRun でないときは Wiki 書き込み資格情報も必須 */
export function validateRunEnv(dryRun: boolean): NextResponse | null {
  const missingAi = missingOpenAiEnv();
  if (missingAi.length > 0) {
    return jsonEnvError(
      missingAi,
      "AI（OpenAI 互換）を使うには OPENAI_API_KEY が必要です"
    );
  }
  if (!dryRun) {
    const missingWiki = missingWikiWriteEnv();
    if (missingWiki.length > 0) {
      return jsonEnvError(
        missingWiki,
        "Wiki に反映するには WIKI_USERNAME と WIKI_PASSWORD を設定してください"
      );
    }
  }
  return null;
}

export function validateFactCheckEnv(): NextResponse | null {
  const missingAi = missingOpenAiEnv();
  if (missingAi.length > 0) {
    return jsonEnvError(
      missingAi,
      "ファクトチェックには OPENAI_API_KEY が必要です"
    );
  }
  return null;
}

export function validateWikiWriteEnv(): NextResponse | null {
  const missingWiki = missingWikiWriteEnv();
  if (missingWiki.length > 0) {
    return jsonEnvError(
      missingWiki,
      "Wiki への書き込みには WIKI_USERNAME と WIKI_PASSWORD を設定してください"
    );
  }
  return null;
}

export type EnvHealthSummary = {
  ok: boolean;
  openAi: { configured: boolean; missing: string[] };
  wikiWrite: { configured: boolean; missing: string[] };
};

export function serverEnvSummary(): EnvHealthSummary {
  const missingOpenAi = missingOpenAiEnv();
  const missingWiki = missingWikiWriteEnv();
  return {
    ok: missingOpenAi.length === 0 && missingWiki.length === 0,
    openAi: {
      configured: missingOpenAi.length === 0,
      missing: missingOpenAi,
    },
    wikiWrite: {
      configured: missingWiki.length === 0,
      missing: missingWiki,
    },
  };
}
