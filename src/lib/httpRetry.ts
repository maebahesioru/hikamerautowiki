/**
 * 外部 HTTP のリトライ（指数バックオフ + ジッター）とユーザー向け文言。
 * PostgreSQL（ツイート DB）の接続・クエリ失敗向け文言もここにまとめる。
 */

export type ExternalServiceKind = "openai" | "wiki" | "yahoo" | "sql";

const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_MS = 400;
const CAP_MS = 12_000;

function jitter(ms: number): number {
  return Math.floor(ms * (0.85 + Math.random() * 0.3));
}

export function backoffMs(attemptIndex: number): number {
  const raw = Math.min(CAP_MS, BASE_MS * 2 ** attemptIndex);
  return jitter(raw);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 同一リクエストの再試行に使う（404 はモデル不存在などで再試行しない） */
export function isRetryableHttpStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 429 ||
    (status >= 500 && status < 600)
  );
}

export type FetchRetryOptions = {
  maxAttempts?: number;
  retryOnStatus?: (status: number) => boolean;
  retryOnNetworkError?: boolean;
  /**
   * 1 回の fetch をこの時間で打ち切る（`AbortError` のときはリトライしない）。
   */
  timeoutMs?: number;
};

function isAbortError(e: unknown): boolean {
  if (e instanceof Error && e.name === "AbortError") return true;
  if (
    typeof DOMException !== "undefined" &&
    e instanceof DOMException &&
    e.name === "AbortError"
  ) {
    return true;
  }
  return false;
}

function mergeInitWithTimeout(
  init: RequestInit | undefined,
  timeoutMs: number
): RequestInit {
  const t = AbortSignal.timeout(timeoutMs);
  const user = init?.signal;
  const signal = user ? AbortSignal.any([user, t]) : t;
  return { ...init, signal };
}

/**
 * fetch のラッパー。リトライ可能なステータス / ネットワークエラー時にバックオフして再試行。
 * 最終試行の Response を返す（呼び出し側が !ok を処理）。
 */
export async function fetchWithRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: FetchRetryOptions
): Promise<Response> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryOnStatus =
    options?.retryOnStatus ?? isRetryableHttpStatus;
  const retryNet = options?.retryOnNetworkError ?? true;
  const timeoutMs = options?.timeoutMs;
  let lastNetworkError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const mergedInit =
        timeoutMs != null && timeoutMs > 0
          ? mergeInitWithTimeout(init, timeoutMs)
          : init;
      const res = await fetch(input, mergedInit);
      if (res.ok || !retryOnStatus(res.status) || attempt === maxAttempts - 1) {
        return res;
      }
      await res.text().catch(() => {});
      await sleep(backoffMs(attempt));
    } catch (e) {
      if (isAbortError(e)) {
        throw e;
      }
      lastNetworkError = e;
      if (!retryNet || attempt === maxAttempts - 1) {
        throw e;
      }
      await sleep(backoffMs(attempt));
    }
  }
  throw lastNetworkError ?? new Error("fetchWithRetry: 内部エラー");
}

export function humanizeNetworkError(kind: ExternalServiceKind): string {
  switch (kind) {
    case "openai":
      return "AI サービスに接続できませんでした。ネットワークやゲートウェイを確認するか、しばらく待ってから再試行してください。";
    case "wiki":
      return "Wiki に接続できませんでした。ネットワークを確認するか、しばらく待ってから再試行してください。";
    case "yahoo":
      return "Yahoo リアルタイム検索に接続できませんでした。ネットワークを確認するか、しばらく待ってから再試行してください。";
    case "sql":
      return "PostgreSQL（ツイート DB）に接続できませんでした。ネットワークを確認するか、しばらく待ってから再試行してください。";
    default:
      return "通信に失敗しました。しばらく待ってから再試行してください。";
  }
}

/**
 * `pg` の例外やクエリ失敗をユーザー向けに整理（HTTP ではないが同じ系統の文言）。
 */
export function humanizeSqlError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (
    /ECONNRESET|ETIMEDOUT|Connection|connect|ECONNREFUSED|57P|timeout|socket|PostgreSQL|08[0-9]{3}/i.test(
      raw
    )
  ) {
    return "PostgreSQL（ツイート DB）に一時的に接続できませんでした。しばらく待ってから再試行してください。";
  }
  if (/syntax error|42P01|relation .* does not exist/i.test(raw)) {
    return `データベースの検索に失敗しました（設定またはテーブルを確認してください）。 ${raw.slice(0, 160)}`;
  }
  return `ツイートデータベースの検索に失敗しました。しばらく待ってから再試行してください。`;
}

export function humanizeHttpError(
  kind: ExternalServiceKind,
  status: number,
  detail?: string
): string {
  const tail = detail?.trim()
    ? ` 詳細: ${detail.trim().slice(0, 160)}`
    : "";

  if (status === 429) {
    switch (kind) {
      case "openai":
        return "AI サービスが混雑しています（レート制限）。しばらく待ってから再試行してください。";
      case "wiki":
        return "Wiki が混雑しています（アクセス制限）。しばらく待ってから再試行してください。";
      case "yahoo":
        return "Yahoo リアルタイム検索が混雑しています。しばらく待ってから再試行してください。";
      case "sql":
        return "データベースへの接続が混雑しています。しばらく待ってから再試行してください。";
      default:
        return "サービスが混雑しています。しばらく待ってから再試行してください。";
    }
  }

  if (status >= 500 && status < 600) {
    switch (kind) {
      case "openai":
        return "AI サービス側で一時的な障害が発生しました（サーバーエラー）。しばらく待ってから再試行してください。";
      case "wiki":
        return "Wiki サーバー側で一時的な障害が発生しました。しばらく待ってから再試行してください。";
      case "yahoo":
        return "Yahoo リアルタイム検索側で一時的な障害が発生しました。しばらく待ってから再試行してください。";
      case "sql":
        return "PostgreSQL サーバー側で一時的な障害が発生しました。しばらく待ってから再試行してください。";
      default:
        return "サーバー側で一時的な障害が発生しました。しばらく待ってから再試行してください。";
    }
  }

  if (status === 408 || status === 502 || status === 503 || status === 504) {
    switch (kind) {
      case "openai":
        return "AI サービスが一時的に利用できません（タイムアウトまたは過負荷）。しばらく待ってから再試行してください。";
      case "wiki":
        return "Wiki が一時的に利用できません（タイムアウトまたは過負荷）。しばらく待ってから再試行してください。";
      case "yahoo":
        return "Yahoo リアルタイム検索が一時的に利用できません。しばらく待ってから再試行してください。";
      case "sql":
        return "データベースが一時的に利用できません（タイムアウトまたは過負荷）。しばらく待ってから再試行してください。";
      default:
        return "サービスが一時的に利用できません。しばらく待ってから再試行してください。";
    }
  }

  if (status === 404 && kind === "openai") {
    return "指定した AI モデルが見つかりませんでした（別モデルに切り替えます）。";
  }

  if (kind === "sql") {
    return `データベース周りのエラー（参照: HTTP ${status}）。${tail}`.trim();
  }

  return `通信エラーが発生しました（HTTP ${status}）。${tail}`.trim();
}
