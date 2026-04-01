import { mergeTweetHitFields, type TweetHit } from "@/lib/yahoo-realtime";
import { getPool, queryWithRetry } from "@/lib/postgres";

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

function formatDbDate(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (v instanceof Date) return v.toISOString();
  return str(v);
}

/** `新しいフォルダー/lib/postgres.ts` と同じ: `/pic/profile_images…` を pbs.twimg.com に展開 */
function convertProfileImageUrl(url: string): string {
  const t = url.trim();
  if (!t) return t;
  if (t.startsWith("/pic/profile_images")) {
    const decoded = decodeURIComponent(t.replace("/pic/", ""));
    const highRes = decoded
      .replace(/_bigger\.(jpg|png|webp)$/i, "_400x400.$1")
      .replace(/_normal\.(jpg|png|webp)$/i, "_400x400.$1");
    return `https://pbs.twimg.com/${highRes}`;
  }
  if (t.startsWith("https://")) return t;
  if (t.startsWith("http://")) return t.replace(/^http:\/\//i, "https://");
  return t;
}

function normalizeHttpsUrl(url: string): string {
  const t = url.trim();
  if (t.startsWith("http://")) return t.replace(/^http:\/\//i, "https://");
  return t;
}

/** `新しいフォルダー` の `tweets` スキーマと揃えた拡張 SELECT（カラムが無い DB ではエラーになる） */
function rowToTweetHit(r: Record<string, unknown>): TweetHit | null {
  const id = r.id != null ? String(r.id).trim() : "";
  const text = (r.display_text != null ? String(r.display_text) : "").replace(
    /\\n/g,
    "\n"
  );
  if (!id || !text) return null;

  const hit: TweetHit = {
    id,
    text,
    displayName: str(r.user_name),
    authorId: str(r.user_id),
    createdAt: formatDbDate(r.created_at),
    replyCount: num(r.reply_count),
    rtCount: num(r.rt_count),
    qtCount: num(r.qt_count),
    likesCount: num(r.likes_count),
    viewCount: num(r.view_count),
    bookmarkCount: num(r.bookmark_count),
    mediaType: str(r.media_type),
    inReplyToScreenName: str(r.in_reply_to_screen_name),
    quotedTweetText:
      r.quoted_tweet_text != null
        ? String(r.quoted_tweet_text).replace(/\\n/g, "\n")
        : undefined,
    userDescription:
      r.user_description != null
        ? String(r.user_description).replace(/\\n/g, "\n")
        : undefined,
    userFollowersCount: num(r.user_followers_count),
    userFollowingCount: num(r.user_following_count),
    userTweetCount: num(r.user_tweet_count),
    userCreatedAt: formatDbDate(r.user_created_at),
    userLocation: str(r.user_location),
  };
  const ver = r.user_verified;
  if (ver != null && String(ver).trim() !== "") {
    hit.userVerified =
      typeof ver === "boolean" ? ver : String(ver).trim();
  }
  const av = str(r.user_profile_image_url);
  if (av) hit.userProfileImageUrl = convertProfileImageUrl(av);
  const ban = str(r.user_profile_banner_url);
  if (ban) hit.userProfileBannerUrl = normalizeHttpsUrl(ban);
  const timgs = parseDbMediaImageUrls(r.media);
  if (timgs.length > 0) hit.tweetImageUrls = timgs;
  return hit;
}

function isNonImageVideoUrl(u: string): boolean {
  return /\.(mp4|webm|m3u8)(\?|$)/i.test(u);
}

/** オブジェクト配列（Yahoo 風・API 風）から静止画 URL のみ */
function imageUrlsFromMediaObjectArray(arr: unknown[]): string[] {
  const out: string[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const typ = String(o.type ?? o.media_type ?? "").toLowerCase();
    if (typ.includes("video") || typ.includes("gif") || typ === "animatedgif")
      continue;
    if (
      typ &&
      typ !== "image" &&
      typ !== "photo" &&
      !typ.includes("image")
    ) {
      continue;
    }
    const u = str(o.mediaUrl ?? o.media_url ?? o.url);
    if (!u || isNonImageVideoUrl(u)) continue;
    out.push(u);
  }
  return out;
}

/**
 * `新しいフォルダー/app/search/utils.ts` の `extractMediaUrls` と同系統。
 * JSON 配列・Python 風 1 行・mediaUrl 埋め込みなどに対応。
 */
function extractUrlsFromLooseMediaString(mediaStr: string): string[] {
  if (!mediaStr || mediaStr === "なし") return [];
  const urls: string[] = [];
  try {
    if (mediaStr.startsWith("[") && mediaStr.endsWith("]")) {
      const parsed = JSON.parse(mediaStr) as unknown;
      if (Array.isArray(parsed)) {
        for (const x of parsed) {
          if (typeof x === "string" && x.startsWith("http")) urls.push(x);
        }
        if (urls.length > 0) return urls;
      }
    }
  } catch {
    /* fall through */
  }
  if (mediaStr.startsWith("{") || mediaStr.startsWith("{'")) {
    const mediaUrlMatch = mediaStr.match(/'mediaUrl':\s*'([^']+)'/);
    if (mediaUrlMatch?.[1]?.startsWith("http")) urls.push(mediaUrlMatch[1]);
    const expandedMatch = mediaStr.match(/'expandedUrl':\s*'([^']+)'/);
    if (
      expandedMatch?.[1]?.startsWith("http") &&
      !urls.includes(expandedMatch[1])
    ) {
      urls.push(expandedMatch[1]);
    }
    const urlMatch = mediaStr.match(/'url':\s*'([^']+)'/);
    if (urlMatch?.[1]?.startsWith("http") && !urls.includes(urlMatch[1])) {
      urls.push(urlMatch[1]);
    }
    if (urls.length > 0) return urls;
  }
  for (const m of mediaStr.matchAll(/'mediaUrl':\s*'([^']+)'/g)) {
    if (m[1].startsWith("http")) urls.push(m[1]);
  }
  if (urls.length > 0) return urls;
  for (const m of mediaStr.matchAll(/'expandedUrl':\s*'([^']+)'/g)) {
    if (m[1].startsWith("http")) urls.push(m[1]);
  }
  if (urls.length > 0) return urls;

  // JSON.stringify や API 由来のダブルクォート形式（'mediaUrl' では取れない場合）
  for (const m of mediaStr.matchAll(/"mediaUrl":\s*"([^"]+)"/g)) {
    if (m[1].startsWith("http")) urls.push(m[1]);
  }
  for (const m of mediaStr.matchAll(/"expandedUrl":\s*"([^"]+)"/g)) {
    if (m[1].startsWith("http") && !urls.includes(m[1])) urls.push(m[1]);
  }
  for (const m of mediaStr.matchAll(/"url":\s*"([^"]+)"/g)) {
    if (m[1].startsWith("http") && !urls.includes(m[1])) urls.push(m[1]);
  }
  if (urls.length > 0) return urls;

  // Yahoo 風のサムネ（静止画。上で取れなかったときのみ）
  for (const m of mediaStr.matchAll(/'thumbnailImageUrl':\s*'([^']+)'/g)) {
    if (m[1].startsWith("http")) urls.push(m[1]);
  }
  for (const m of mediaStr.matchAll(/"thumbnailImageUrl":\s*"([^"]+)"/g)) {
    if (m[1].startsWith("http") && !urls.includes(m[1])) urls.push(m[1]);
  }
  if (urls.length > 0) return urls;

  if (mediaStr.includes("http")) {
    return mediaStr
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u.startsWith("http"));
  }
  return [];
}

/** DB の `media`（text / json / jsonb / 混在テキスト）から静止画 URL のみ */
function parseDbMediaImageUrls(raw: unknown): string[] {
  if (raw == null) return [];

  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    if (typeof raw[0] === "string") {
      return [
        ...new Set(
          (raw as string[]).filter(
            (u) => typeof u === "string" && u.startsWith("http") && !isNonImageVideoUrl(u)
          )
        ),
      ];
    }
    return [...new Set(imageUrlsFromMediaObjectArray(raw))];
  }

  if (typeof raw === "object") {
    return [...new Set(imageUrlsFromMediaObjectArray([raw]))];
  }

  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s || s === "なし") return [];
    try {
      return parseDbMediaImageUrls(JSON.parse(s) as unknown);
    } catch {
      const loose = extractUrlsFromLooseMediaString(s);
      return [
        ...new Set(loose.filter((u) => !isNonImageVideoUrl(u))),
      ];
    }
  }

  return [];
}

/** マージ・Map キー用。前後空白のみ除去（同一ツイートが別キー扱いになるのを防ぐ）。 */
function tweetIdMergeKey(id: string | undefined): string | undefined {
  if (id === undefined || typeof id !== "string") return undefined;
  const t = id.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * 複数ソースのツイートを id でマージ（同一 id は第 1 引数側を優先。既定は DB → Yahoo）。
 * キーは trim 済みの id。値に保存する `TweetHit.id` も正規化キーに揃える。
 */
export function mergeTweetHitsById(
  preferFirst: TweetHit[],
  preferSecond: TweetHit[]
): TweetHit[] {
  const m = new Map<string, TweetHit>();
  for (const h of preferFirst) {
    const k = tweetIdMergeKey(h.id);
    if (k) m.set(k, { ...h, id: k });
  }
  for (const h of preferSecond) {
    const k = tweetIdMergeKey(h.id);
    if (!k) continue;
    const existing = m.get(k);
    if (!existing) m.set(k, { ...h, id: k });
    else m.set(k, mergeTweetHitFields(existing, h));
  }
  return [...m.values()];
}

/**
 * 単一ソース内の重複 id を除去（先勝ち）。DB / Yahoo の各レスポンスに同一 id が複数あっても 1 件にまとめる。
 */
export function dedupeTweetHitsById(hits: TweetHit[]): TweetHit[] {
  return mergeTweetHitsById(hits, []);
}

function shuffleInPlace<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = t;
  }
}

/**
 * `mergeTweetHitsById` 後の配列を、**DB に一度でも現れた id を先頭側**にまとめ、
 * 各グループ内は Fisher–Yates でシャッフルしたうえで先頭から `cap` 件にする。
 * Yahoo のみの id は DB 群の後ろに並ぶ（DB 優先・群内はランダム）。
 */
export function orderTweetHitsDbPriorityRandom(
  merged: readonly TweetHit[],
  dbHits: readonly TweetHit[],
  cap: number
): TweetHit[] {
  const dbId = new Set<string>();
  for (const h of dbHits) {
    const k = tweetIdMergeKey(h.id);
    if (k) dbId.add(k);
  }
  const dbPart: TweetHit[] = [];
  const yahooPart: TweetHit[] = [];
  for (const h of merged) {
    const k = tweetIdMergeKey(h.id);
    if (k && dbId.has(k)) dbPart.push(h);
    else yahooPart.push(h);
  }
  shuffleInPlace(dbPart);
  shuffleInPlace(yahooPart);
  const n = Math.max(0, cap);
  return [...dbPart, ...yahooPart].slice(0, n);
}

export type SearchTweetsDbOptions = {
  /** `created_at` がこの時刻以上（含む） */
  since?: Date;
  /** `created_at` がこの時刻以下（含む） */
  until?: Date;
};

/**
 * 新しいフォルダーと同じ PostgreSQL の `tweets` テーブルを検索。
 * DATABASE_URL 未設定時は空配列を返す。
 *
 * 条件に合致する行は **件数上限なしで全件**返す（メモリ・時間に注意）。
 * 並びは保証しない（パイプライン側で DB 優先ランダム＋全体 cap を適用）。
 *
 * クエリは空白区切りを AND とみなし、`ID:screen_name` は user_id 一致、
 * `-語` は本文に含まない条件、それ以外は display_text に部分一致（大小無視）。
 */
export async function searchTweetsFromDatabase(
  query: string,
  options?: SearchTweetsDbOptions
): Promise<TweetHit[]> {
  const pool = getPool();
  if (!pool) return [];

  const raw = query.trim();
  if (!raw || raw.startsWith("(")) return [];

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const where: string[] = ["display_text IS NOT NULL", "display_text <> ''"];
  const params: unknown[] = [];
  let n = 1;

  for (const t of tokens) {
    if (/^ID:/i.test(t)) {
      const uid = t.slice(3).trim();
      if (uid) {
        where.push(`LOWER(user_id) = LOWER($${n})`);
        params.push(uid);
        n++;
      }
      continue;
    }
    if (t.startsWith("-") && t.length > 1) {
      const ex = t.slice(1);
      where.push(`strpos(lower(display_text), lower($${n})) = 0`);
      params.push(ex);
      n++;
      continue;
    }
    where.push(`strpos(lower(display_text), lower($${n})) > 0`);
    params.push(t);
    n++;
  }

  if (options?.since) {
    where.push(`created_at >= $${n}`);
    params.push(options.since);
    n++;
  }
  if (options?.until) {
    where.push(`created_at <= $${n}`);
    params.push(options.until);
    n++;
  }

  const sql = `
    SELECT
      id::text AS id,
      created_at,
      display_text,
      reply_count,
      rt_count,
      qt_count,
      likes_count,
      view_count,
      bookmark_count,
      media_type,
      in_reply_to_screen_name,
      quoted_tweet_text,
      user_id,
      user_name,
      user_description,
      user_followers_count,
      user_following_count,
      user_tweet_count,
      user_created_at,
      user_verified,
      user_location,
      user_profile_image_url,
      user_profile_banner_url,
      media
    FROM tweets
    WHERE ${where.join(" AND ")}
  `;

  const { rows } = await queryWithRetry<Record<string, unknown>>(pool, sql, params);

  const mapped = rows
    .map((r) => rowToTweetHit(r))
    .filter((h): h is TweetHit => h != null);
  return dedupeTweetHitsById(mapped);
}
