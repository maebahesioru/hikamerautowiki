import { Pool, type QueryResult, type QueryResultRow } from "pg";
import { backoffMs, humanizeSqlError, sleep } from "@/lib/httpRetry";

let pool: Pool | null = null;

const QUERY_MAX_ATTEMPTS = 4;

export function getPool(): Pool | null {
  const cs = process.env.DATABASE_URL?.trim();
  if (!cs) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: cs,
      /** mapPool で同時クエリ数を抑える前提。多すぎるとリモート DB がタイムアウトしやすい */
      max: 8,
      idleTimeoutMillis: 30_000,
      /** 混雑時の待ちを許容（既定はパイプラインの HIKAMER_SEARCH_CONCURRENCY と併用） */
      connectionTimeoutMillis: 45_000,
    });
    pool.on("error", (err) => {
      console.error("[postgres]", err);
    });
  }
  return pool;
}

/** 一時的障害として再試行する pg / ネットワークエラー */
function isRetryablePgError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const any = err as { code?: string };
  const code = typeof any.code === "string" ? any.code : "";
  if (code.startsWith("08")) return true;
  if (["57P01", "57P02", "57P03", "53300", "40001", "40P01"].includes(code)) {
    return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (
    /ECONNRESET|ETIMEDOUT|EPIPE|ECONNREFUSED|socket hang up|Connection terminated|read ETIMEDOUT|timeout/i.test(
      msg
    )
  ) {
    return true;
  }
  return false;
}

/**
 * `pool.query` のラッパー。接続・一時障害時は指数バックオフで再試行し、失敗時はユーザー向け文言に寄せる。
 */
export async function queryWithRetry<T extends QueryResultRow = QueryResultRow>(
  pool: Pool,
  text: string,
  params?: unknown[],
  maxAttempts = QUERY_MAX_ATTEMPTS
): Promise<QueryResult<T>> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await pool.query<T>(text, params);
    } catch (e) {
      if (isRetryablePgError(e) && attempt < maxAttempts - 1) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw new Error(humanizeSqlError(e));
    }
  }
  throw new Error(
    "ツイートデータベースの検索に失敗しました。しばらく待ってから再試行してください。"
  );
}
