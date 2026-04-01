/**
 * Yahoo リアルタイム検索 API（認証不要）
 * 仕様: ./yahoo-realtime-api.md（start 並列のみ、最大 10000 件相当）
 */

import {
  fetchWithRetry,
  humanizeHttpError,
  humanizeNetworkError,
} from "@/lib/httpRetry";
import { getTweetTotalLimit } from "@/lib/tweetLimits";

/** DB / Yahoo から集めたツイート（AI には `tweetPrompt` で重複を抑えて渡す） */
export type TweetHit = {
  id: string;
  text: string;
  /** 表示名（Yahoo: `name`、DB: `user_name`） */
  displayName?: string;
  authorId?: string;
  /** ISO 文字列または DB の生値 */
  createdAt?: string;
  replyCount?: number;
  rtCount?: number;
  qtCount?: number;
  likesCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  mediaType?: string;
  inReplyToScreenName?: string;
  quotedTweetText?: string;
  userDescription?: string;
  userFollowersCount?: number;
  userFollowingCount?: number;
  userTweetCount?: number;
  userCreatedAt?: string;
  userVerified?: string | boolean;
  userLocation?: string;
  /** ツイートに付く静止画のみ（動画・GIF は含めない） */
  tweetImageUrls?: string[];
  /** プロフィール画像（アイコン） */
  userProfileImageUrl?: string;
  /** プロフィールヘッダー（バナー） */
  userProfileBannerUrl?: string;
};

type YahooEntry = {
  id?: string;
  displayText?: string;
  displayTextBody?: string;
  userId?: string;
  /** プロフィール表示名（Yahoo 公式レスポンスの `name`） */
  name?: string;
  /** 応答に含まれる場合のみマップ */
  createdAt?: string;
  replyCount?: number;
  rtCount?: number;
  qtCount?: number;
  likesCount?: number;
  viewCount?: number;
  bookmarkCount?: number;
  mediaType?: string;
  inReplyToScreenName?: string;
  quotedTweetText?: string;
  profileImage?: string;
  profileBannerUrl?: string;
  media?: unknown;
  [key: string]: unknown;
};

type YahooPaginationResponse = {
  timeline?: {
    entry?: YahooEntry[];
  };
};

const API = "https://search.yahoo.co.jp/realtime/api/v1/pagination";

/** Yahoo 1 リクエストあたりの最大件数（API仕様） */
const PER_PAGE = 40;

/** `start` の上限 10000 件 → 250 ページ × 40 件（yahoo-realtime-api.md） */
const START_PARALLEL_PAGES = 250;

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function headers(): Record<string, string> {
  return {
    "User-Agent": process.env.YAHOO_REALTIME_USER_AGENT ?? DEFAULT_UA,
    Accept: "application/json, text/plain, */*",
    Referer:
      process.env.YAHOO_REALTIME_REFERER ??
      "https://search.yahoo.co.jp/realtime/search",
  };
}

/** X 風の `from:user` を Yahoo の `ID:user` に寄せる（yahoo-realtime-api.md 参照） */
export function normalizeQueryForYahoo(query: string): string {
  return query.replace(/\bfrom:/gi, "ID:");
}

function stripHighlight(displayTextBody: string): string {
  return displayTextBody.replace(/\tSTART\t([^\t]+)\tEND\t/g, "$1");
}

function entryText(e: YahooEntry): string {
  const plain = e.displayText?.trim();
  if (plain) return plain;
  const body = e.displayTextBody ?? "";
  return stripHighlight(body).trim();
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

/** Yahoo `media[]` のうち `type===image` のみ。`mediaUrl` を優先 */
function extractYahooTweetImageUrls(e: YahooEntry): string[] {
  const out: string[] = [];
  const raw = e.media;
  if (!Array.isArray(raw)) return out;
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const row = m as Record<string, unknown>;
    if (row.type !== "image") continue;
    const item = row.item;
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const u =
      str(it.mediaUrl) ?? str(it.metaImageUrl) ?? str(it.thumbnailImageUrl);
    if (u) out.push(u);
  }
  return [...new Set(out)];
}

/** 同一 id の TweetHit をマージ（DB 優先＋ Yahoo 等で不足分を補完） */
export function mergeTweetHitFields(a: TweetHit, b: TweetHit): TweetHit {
  const mergeUrls = (x?: string[], y?: string[]): string[] | undefined => {
    const xs = x?.filter(Boolean) ?? [];
    const ys = y?.filter(Boolean) ?? [];
    const u = [...new Set([...xs, ...ys])];
    return u.length > 0 ? u : undefined;
  };
  return {
    ...b,
    ...a,
    id: a.id,
    tweetImageUrls: mergeUrls(a.tweetImageUrls, b.tweetImageUrls),
    userProfileImageUrl: a.userProfileImageUrl ?? b.userProfileImageUrl,
    userProfileBannerUrl: a.userProfileBannerUrl ?? b.userProfileBannerUrl,
    text: a.text || b.text,
    displayName: a.displayName ?? b.displayName,
    authorId: a.authorId ?? b.authorId,
    createdAt: a.createdAt ?? b.createdAt,
    replyCount: a.replyCount ?? b.replyCount,
    rtCount: a.rtCount ?? b.rtCount,
    qtCount: a.qtCount ?? b.qtCount,
    likesCount: a.likesCount ?? b.likesCount,
    viewCount: a.viewCount ?? b.viewCount,
    bookmarkCount: a.bookmarkCount ?? b.bookmarkCount,
    mediaType: a.mediaType ?? b.mediaType,
    inReplyToScreenName: a.inReplyToScreenName ?? b.inReplyToScreenName,
    quotedTweetText: a.quotedTweetText ?? b.quotedTweetText,
    userDescription: a.userDescription ?? b.userDescription,
    userFollowersCount: a.userFollowersCount ?? b.userFollowersCount,
    userFollowingCount: a.userFollowingCount ?? b.userFollowingCount,
    userTweetCount: a.userTweetCount ?? b.userTweetCount,
    userCreatedAt: a.userCreatedAt ?? b.userCreatedAt,
    userVerified: a.userVerified ?? b.userVerified,
    userLocation: a.userLocation ?? b.userLocation,
  };
}

function mapEntries(entries: YahooEntry[]): TweetHit[] {
  return entries
    .filter((e): e is YahooEntry & { id: string } => typeof e.id === "string")
    .map((e) => {
      const hit: TweetHit = {
        id: e.id,
        text: entryText(e),
        displayName:
          typeof e.name === "string" && e.name.trim() ? e.name.trim() : undefined,
        authorId: str(e.userId),
      };
      const ca = str(e.createdAt);
      if (ca) hit.createdAt = ca;
      const rc = num(e.replyCount);
      if (rc != null) hit.replyCount = rc;
      const rt = num(e.rtCount);
      if (rt != null) hit.rtCount = rt;
      const qt = num(e.qtCount);
      if (qt != null) hit.qtCount = qt;
      const lk = num(e.likesCount);
      if (lk != null) hit.likesCount = lk;
      const vw = num(e.viewCount);
      if (vw != null) hit.viewCount = vw;
      const bm = num(e.bookmarkCount);
      if (bm != null) hit.bookmarkCount = bm;
      const mt = str(e.mediaType);
      if (mt) hit.mediaType = mt;
      const ir = str(e.inReplyToScreenName);
      if (ir) hit.inReplyToScreenName = ir;
      const qtxt = str(e.quotedTweetText);
      if (qtxt) hit.quotedTweetText = qtxt;
      const yahooImgs = extractYahooTweetImageUrls(e);
      if (yahooImgs.length > 0) hit.tweetImageUrls = yahooImgs;
      const av = str(e.profileImage);
      if (av) hit.userProfileImageUrl = av;
      const ban = str(e.profileBannerUrl);
      if (ban) hit.userProfileBannerUrl = ban;
      return hit;
    });
}

export type YahooRealtimeSearchOptions = {
  /** API の `since`（Unix 秒） */
  sinceSec?: number;
  /** API の `until`（Unix 秒） */
  untilSec?: number;
};

async function fetchEntryPage(
  q: string,
  start: number,
  time?: YahooRealtimeSearchOptions
): Promise<YahooEntry[]> {
  const params = new URLSearchParams({
    p: q,
    results: String(PER_PAGE),
    start: String(start),
  });
  if (time?.sinceSec != null) params.set("since", String(time.sinceSec));
  if (time?.untilSec != null) params.set("until", String(time.untilSec));
  let r: Response;
  try {
    r = await fetchWithRetry(`${API}?${params}`, { headers: headers() });
  } catch {
    throw new Error(humanizeNetworkError("yahoo"));
  }
  if (!r.ok) {
    const t = await r.text();
    throw new Error(humanizeHttpError("yahoo", r.status, t));
  }
  const data = (await r.json()) as YahooPaginationResponse;
  return data.timeline?.entry ?? [];
}

/**
 * 新着順（`md` 省略）。
 * `start=1,41,…,9961` を 250 本並列（最大 10000 件相当）。ID で重複排除。
 * `options` で `since` / `until`（Unix 秒）を渡すと API の期間絞り込みが付く。
 */
export async function searchYahooRealtimeTweets(
  query: string,
  options?: YahooRealtimeSearchOptions
): Promise<TweetHit[]> {
  const q = normalizeQueryForYahoo(query).trim();
  if (!q) return [];

  const byId = new Map<string, YahooEntry>();

  const starts = Array.from(
    { length: START_PARALLEL_PAGES },
    (_, i) => i * PER_PAGE + 1
  );
  const pages = await Promise.all(
    starts.map((start) => fetchEntryPage(q, start, options))
  );

  for (const e of pages.flat()) {
    const id =
      typeof e.id === "string" ? e.id.trim() : "";
    if (id && !byId.has(id)) byId.set(id, { ...e, id });
  }

  const cap = getTweetTotalLimit();
  return mapEntries([...byId.values()]).slice(0, cap);
}
