/**
 * OpenAI 互換 / Gemini ゲートウェイの chat/completions `usage` を正規化してサーバーログに出す。
 */

export type NormalizedTokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  return null;
}

/**
 * `usage` オブジェクトの各種キー名に対応（prompt_tokens / input_tokens など）。
 */
export function normalizeChatCompletionUsage(raw: unknown): NormalizedTokenUsage {
  if (!raw || typeof raw !== "object") {
    return { inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const u = raw as Record<string, unknown>;
  const inputTokens =
    num(u.prompt_tokens) ??
    num(u.input_tokens) ??
    num(u.prompt_token_count) ??
    null;
  const outputTokens =
    num(u.completion_tokens) ??
    num(u.output_tokens) ??
    num(u.completion_token_count) ??
    null;
  let totalTokens = num(u.total_tokens) ?? num(u.total_token_count) ?? null;
  if (totalTokens == null && inputTokens != null && outputTokens != null) {
    totalTokens = inputTokens + outputTokens;
  }
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * 成功時も必ずサーバーログにトークン量を残す（usage が無いゲートウェイも明示）。
 * 正規化済み usage を返す（UI 進捗用にも使う）。
 */
export function logOpenAiTokenUsage(
  model: string,
  usageRaw: unknown,
  label: string
): NormalizedTokenUsage {
  const u = normalizeChatCompletionUsage(usageRaw);
  const hasAny =
    u.inputTokens != null || u.outputTokens != null || u.totalTokens != null;
  if (!hasAny) {
    console.log(
      `[hikamer][openai] ${label} model=${model} Input_tokens=? Output_tokens=? Total_tokens=? (usage なし)`
    );
    return u;
  }
  console.log(
    `[hikamer][openai] ${label} model=${model} Input_tokens=${u.inputTokens ?? "?"} Output_tokens=${u.outputTokens ?? "?"} Total_tokens=${u.totalTokens ?? "?"}`
  );
  return u;
}

const fmtTok = (n: number | null) => (n != null ? String(n) : "?");

/** 進捗欄に出す 1 行（SSE progress に載せる） */
export function formatTokenUsageForProgressLine(
  u: NormalizedTokenUsage,
  stepLabel: string
): string {
  return `[トークン・${stepLabel}] Input ${fmtTok(u.inputTokens)} / Output ${fmtTok(u.outputTokens)} / Total ${fmtTok(u.totalTokens)}`;
}
