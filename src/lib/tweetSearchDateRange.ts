/**
 * ツイート検索の期間指定（フォーム・API は読みやすい日付文字列、Yahoo は Unix 秒に変換）。
 * - `YYYY-MM-DD` … 開始はその日 0:00、終了はその日 23:59:59.999（ローカル時刻）
 * - それ以外 … `Date` で解釈できる ISO 風・日時文字列
 */

export type ResolvedTweetSearchRange =
  | {
      ok: true;
      /** Yahoo API `since` / `until`（秒） */
      sinceSec?: number;
      untilSec?: number;
      /** Postgres `created_at` 比較用 */
      sinceDb?: Date;
      untilDb?: Date;
      /** ログ・画面用 */
      label: string;
    }
  | { ok: false; error: string };

function parseSinceBound(s: string): Date | undefined {
  const t = s.trim();
  if (!t) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T00:00:00`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseUntilBound(s: string): Date | undefined {
  const t = s.trim();
  if (!t) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const d = new Date(`${t}T23:59:59.999`);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function formatLabel(since?: Date, until?: Date): string {
  if (!since && !until) return "（指定なし）";
  const ja = (d: Date) =>
    d.toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  if (since && until) return `${ja(since)} 〜 ${ja(until)}`;
  if (since) return `${ja(since)} 以降`;
  if (until) return `${ja(until)} まで`;
  return "（指定なし）";
}

/**
 * `tweetSince` / `tweetUntil` はフォームの `type="date"`（YYYY-MM-DD）や ISO 日時文字列。
 * 両方空ならフィルタなし。
 */
export function resolveTweetSearchRange(
  tweetSince?: string | null,
  tweetUntil?: string | null
): ResolvedTweetSearchRange {
  const rawA = tweetSince?.trim();
  const rawB = tweetUntil?.trim();
  if (!rawA && !rawB) {
    return { ok: true, label: "（指定なし）" };
  }

  const sinceDb = rawA ? parseSinceBound(rawA) : undefined;
  const untilDb = rawB ? parseUntilBound(rawB) : undefined;

  if (rawA && !sinceDb) {
    return { ok: false, error: `「この日時から」の形式が読み取れません: ${rawA}` };
  }
  if (rawB && !untilDb) {
    return { ok: false, error: `「この日時まで」の形式が読み取れません: ${rawB}` };
  }
  if (sinceDb && untilDb && sinceDb.getTime() > untilDb.getTime()) {
    return { ok: false, error: "開始日時は終了日時より前にしてください。" };
  }

  const sinceSec = sinceDb
    ? Math.floor(sinceDb.getTime() / 1000)
    : undefined;
  const untilSec = untilDb
    ? Math.floor(untilDb.getTime() / 1000)
    : undefined;

  return {
    ok: true,
    sinceSec,
    untilSec,
    sinceDb,
    untilDb,
    label: formatLabel(sinceDb, untilDb),
  };
}
