/**
 * Yahoo!検索（search.yahoo.co.jp のウェブタブ）の HTML を解析。
 * 公式 JSON API は使わず、簡易版 SERP の構造に依存する（取得失敗時は空配列）。
 */

import {
  fetchWithRetry,
  humanizeHttpError,
  humanizeNetworkError,
} from "@/lib/httpRetry";

export type YahooWebSearchHit = {
  url: string;
  title: string;
  snippet: string;
};

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function headers(): Record<string, string> {
  return {
    "User-Agent": process.env.YAHOO_WEB_SEARCH_USER_AGENT ?? DEFAULT_UA,
    Accept: "text/html,application/xhtml+xml",
    Referer:
      process.env.YAHOO_WEB_SEARCH_REFERER ?? "https://search.yahoo.co.jp/",
  };
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&middot;/g, "·")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function stripTags(s: string): string {
  return decodeHtmlEntities(
    s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
  );
}

/** テスト・診断用: SERP HTML からウェブ結果を取り出す */
export function parseYahooWebSearchHtml(html: string): YahooWebSearchHit[] {
  const webOl = html.match(/<div id="web"[^>]*>[\s\S]*?<ol>([\s\S]*?)<\/ol>/i);
  if (!webOl) return [];
  const ol = webOl[1];
  const hits: YahooWebSearchHit[] = [];
  const liRe = /<li>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = liRe.exec(ol)) !== null) {
    const block = m[1];
    const a = block.match(
      /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!a) continue;
    const url = a[1];
    if (
      url.includes("search.yahoo.co.jp/clear.gif") ||
      /\/clear\.gif$/i.test(url)
    ) {
      continue;
    }
    const title = stripTags(a[2]);
    const div = block.match(/<div>([\s\S]*?)<\/div>/i);
    const snippet = div ? stripTags(div[1]) : "";
    hits.push({ url, title, snippet });
  }
  return hits;
}

function webSearchMaxQueries(): number {
  const raw = process.env.HIKAMER_WEB_SEARCH_MAX_QUERIES?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 3;
  if (!Number.isFinite(n)) return 3;
  return Math.min(Math.max(n, 1), 8);
}

function webSearchMaxTotalHits(): number {
  const raw = process.env.HIKAMER_WEB_SEARCH_MAX_HITS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 15;
  if (!Number.isFinite(n)) return 15;
  return Math.min(Math.max(n, 1), 40);
}

export function isYahooWebSearchEnabled(): boolean {
  return process.env.HIKAMER_YAHOO_WEB_SEARCH?.trim() !== "0";
}

/**
 * 1 クエリで Yahoo!ウェブ検索（HTML）を取得して解析する。
 */
export async function searchYahooWeb(
  query: string,
  opts?: { timeoutMs?: number }
): Promise<YahooWebSearchHit[]> {
  const q = query.trim();
  if (!q) return [];
  const u = new URL("https://search.yahoo.co.jp/search");
  u.searchParams.set("p", q);
  u.searchParams.set("ei", "UTF-8");
  let r: Response;
  try {
    r = await fetchWithRetry(
      u.toString(),
      { headers: headers() },
      { timeoutMs: opts?.timeoutMs ?? 28_000 }
    );
  } catch {
    throw new Error(humanizeNetworkError("yahoo"));
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(humanizeHttpError("yahoo", r.status, t));
  }
  const html = await r.text();
  return parseYahooWebSearchHtml(html);
}

export type YahooWebSearchBundle = {
  hits: YahooWebSearchHit[];
  error?: string;
};

/**
 * ツイート検索用クエリ（複数）の先頭から順にウェブ検索し、URL 単位で重複除去。
 */
export async function fetchYahooWebSearchForQueries(
  queries: readonly string[],
  options?: { onProgress?: (m: string) => void }
): Promise<YahooWebSearchBundle> {
  if (!isYahooWebSearchEnabled()) {
    return { hits: [] };
  }
  const maxQ = webSearchMaxQueries();
  const maxTotal = webSearchMaxTotalHits();
  const slice = queries.map((q) => q.trim()).filter(Boolean).slice(0, maxQ);
  if (slice.length === 0) {
    return { hits: [] };
  }

  const seen = new Set<string>();
  const out: YahooWebSearchHit[] = [];
  const errParts: string[] = [];

  for (let i = 0; i < slice.length; i++) {
    const q = slice[i]!;
    if (out.length >= maxTotal) break;
    try {
      options?.onProgress?.(
        `Yahoo!ウェブ検索（${i + 1}/${slice.length}）: 「${q.length > 48 ? `${q.slice(0, 48)}…` : q}」`
      );
      const batch = await searchYahooWeb(q);
      for (const h of batch) {
        if (out.length >= maxTotal) break;
        const key = h.url.replace(/#.*$/, "");
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(h);
      }
    } catch (e) {
      errParts.push(
        `${q.slice(0, 24)}:${e instanceof Error ? e.message : String(e)}`
      );
    }
  }

  return {
    hits: out,
    ...(errParts.length > 0 ? { error: errParts.join("; ") } : {}),
  };
}
