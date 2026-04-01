import {
  resolveTweetSearchRange,
  type ResolvedTweetSearchRange,
} from "@/lib/tweetSearchDateRange";

/**
 * Yahoo 検索語 `p` 用。
 * `since:` / `until:` を検索語から取り除き、HTTP の since/until 相当に渡す値へ変換する。
 */

function tokenToDateInput(tok: string): string | undefined {
  const t = tok.trim();
  if (!t) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{10}$/.test(t)) {
    return new Date(Number(t) * 1000).toISOString().slice(0, 10);
  }
  if (/^\d{13}$/.test(t)) {
    return new Date(Number(t)).toISOString().slice(0, 10);
  }
  return undefined;
}

export function stripSinceUntilFromYahooQuery(q: string): {
  cleaned: string;
  sinceForResolve?: string;
  untilForResolve?: string;
} {
  let sinceForResolve: string | undefined;
  let untilForResolve: string | undefined;

  const sinceRe = /\bsince:([^\s]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = sinceRe.exec(q)) !== null) {
    const v = tokenToDateInput(m[1] ?? "");
    if (v) sinceForResolve = v;
  }
  const untilRe = /\buntil:([^\s]+)/gi;
  while ((m = untilRe.exec(q)) !== null) {
    const v = tokenToDateInput(m[1] ?? "");
    if (v) untilForResolve = v;
  }

  let s = q
    .replace(/\bsince:([^\s]+)/gi, " ")
    .replace(/\buntil:([^\s]+)/gi, " ");
  s = s.replace(/\s+/g, " ").trim();

  return {
    cleaned: s,
    sinceForResolve,
    untilForResolve,
  };
}

/** ログ用: 複数クエリに含まれる since:/until: を要約したラベル */
export function tweetRangeLabelFromQueries(
  queries: string[]
): Extract<ResolvedTweetSearchRange, { ok: true }> {
  const labels: string[] = [];
  for (const q of queries) {
    const { sinceForResolve, untilForResolve } = stripSinceUntilFromYahooQuery(q);
    const r = resolveTweetSearchRange(sinceForResolve, untilForResolve);
    if (r.ok && r.label !== "（指定なし）") {
      labels.push(r.label);
    }
  }
  if (labels.length === 0) {
    return { ok: true, label: "（指定なし）" };
  }
  const uniq = [...new Set(labels)];
  return {
    ok: true,
    label: uniq.length === 1 ? uniq[0]! : uniq.join("； "),
  };
}
