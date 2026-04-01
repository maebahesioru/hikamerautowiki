/** AI に渡す Wiki 内検索ヒットの上限（ユニークページ数） */
export const WIKI_CONTEXT_MAX_PAGES = 40;

/**
 * 検索クエリごとのバンドル（DB+Wiki+Yahoo）の同時実行数の既定。
 * 不安定なら `HIKAMER_SEARCH_CONCURRENCY=2`。
 */
const DEFAULT_SEARCH_CONCURRENCY = 4;

export function getEnv(name: string, fallback?: string): string {
  const raw = process.env[name];
  const v = raw?.trim();
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`環境変数 ${name} が未設定です`);
}

/** OpenAI 互換 API 呼び出し失敗時に、クライアントで区別しやすいメッセージにする */
export function wrapAiError(phase: string, cause: unknown): never {
  const msg = cause instanceof Error ? cause.message : String(cause);
  throw new Error(`AI（${phase}）エラー: ${msg}`);
}

export function getSearchConcurrency(): number {
  const raw = process.env.HIKAMER_SEARCH_CONCURRENCY?.trim();
  if (!raw) return DEFAULT_SEARCH_CONCURRENCY;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_SEARCH_CONCURRENCY;
  return Math.min(Math.floor(n), 16);
}
