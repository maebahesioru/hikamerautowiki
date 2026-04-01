/**
 * FxTwitter / FixTweet Status API（api.fxtwitter.com）
 * https://github.com/FxEmbed/FxEmbed/wiki/Status-Fetch-API
 *
 * 認証不要。メディア URL は X CDN（pbs.twimg.com 等）の直リンクで、DB / Yahoo の
 * パースより一貫しやすい。
 */

import { fetchWithRetry } from "@/lib/httpRetry";
import type { TweetHit } from "@/lib/yahoo-realtime";

const API_BASE = "https://api.fxtwitter.com";

const DEFAULT_UA =
  "hikamerautowiki/0.1 (+https://github.com/FxEmbed/FxEmbed/wiki/Status-Fetch-API)";

function headers(): Record<string, string> {
  return {
    Accept: "application/json",
    "User-Agent": process.env.FXTWITTER_USER_AGENT ?? DEFAULT_UA,
  };
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length > 0 ? s : undefined;
}

/** TweetHit の `tweetImageUrls` と同じく静止画のみ（動画サムネは含めない） */
function extractPhotoUrlsFromMedia(media: unknown): string[] {
  const out: string[] = [];
  if (!media || typeof media !== "object") return out;
  const m = media as Record<string, unknown>;

  const pushPhoto = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    const o = item as Record<string, unknown>;
    if (o.type !== "photo") return;
    const u = str(o.url);
    if (u) out.push(u);
  };

  const photos = m.photos;
  if (Array.isArray(photos)) {
    for (const p of photos) pushPhoto(p);
  }

  const all = m.all;
  if (Array.isArray(all)) {
    for (const item of all) pushPhoto(item);
  }

  const mosaic = m.mosaic;
  if (mosaic && typeof mosaic === "object") {
    const formats = (mosaic as { formats?: { jpeg?: string; webp?: string } })
      .formats;
    const u = str(formats?.jpeg) ?? str(formats?.webp);
    if (u) out.push(u);
  }

  return [...new Set(out)];
}

export type FxtwitterMediaFields = {
  tweetImageUrls?: string[];
  userProfileImageUrl?: string;
  userProfileBannerUrl?: string;
};

/**
 * 1 件のツイート ID について FxTwitter からメディア・プロフィール画像を取得。
 * 取得できない（404 / 非公開 / 障害）時は `null`。
 */
export async function fetchFxtwitterMediaFields(
  tweetId: string
): Promise<FxtwitterMediaFields | null> {
  const id = tweetId.trim();
  if (!/^\d+$/.test(id)) return null;

  let res: Response;
  try {
    res = await fetchWithRetry(
      `${API_BASE}/status/${encodeURIComponent(id)}`,
      { method: "GET", headers: headers(), cache: "no-store" },
      { maxAttempts: 3 }
    );
  } catch {
    return null;
  }

  if (!res.ok) return null;

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return null;
  }

  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  if (root.code !== 200) return null;

  const tweet = root.tweet;
  if (!tweet || typeof tweet !== "object") return null;
  const t = tweet as Record<string, unknown>;

  const author = t.author;
  let userProfileImageUrl: string | undefined;
  let userProfileBannerUrl: string | undefined;
  if (author && typeof author === "object") {
    const a = author as Record<string, unknown>;
    userProfileImageUrl = str(a.avatar_url);
    userProfileBannerUrl = str(a.banner_url);
  }

  const tweetImageUrls = extractPhotoUrlsFromMedia(t.media);
  const imgs = tweetImageUrls.length > 0 ? tweetImageUrls : undefined;

  if (!imgs && !userProfileImageUrl && !userProfileBannerUrl) {
    return null;
  }

  return {
    ...(imgs ? { tweetImageUrls: imgs } : {}),
    ...(userProfileImageUrl ? { userProfileImageUrl } : {}),
    ...(userProfileBannerUrl ? { userProfileBannerUrl } : {}),
  };
}

/** `FXTWITTER_MEDIA_ENRICH=0` のときは DB/Yahoo の画像のまま（API を叩かない） */
export function isFxtwitterMediaEnrichEnabled(): boolean {
  return process.env.FXTWITTER_MEDIA_ENRICH !== "0";
}

/**
 * `FXTWITTER_MEDIA_ENRICH_ALL=1` のときは全ツイート ID で FxTwitter を叩く（旧挙動）。
 * 未設定時は、DB/Yahoo でプロフィール画像と投稿画像の両方が取れている行だけ叩き、
 * それ以外は HTTP を省略して速くする。
 */
export function isFxtwitterEnrichAllTweetHits(): boolean {
  return process.env.FXTWITTER_MEDIA_ENRICH_ALL === "1";
}

/** プロフィール画像と投稿静止画の両方が既にあるときだけ FxTwitter 補完の対象にする */
export function tweetHitHasProfileAndTweetImages(hit: TweetHit): boolean {
  const hasProfile = Boolean(hit.userProfileImageUrl?.trim());
  const hasTweetImages = (hit.tweetImageUrls?.length ?? 0) > 0;
  return hasProfile && hasTweetImages;
}

/**
 * DB / Yahoo で集めた `TweetHit` に、FxTwitter の画像・アイコンを上書き補完する。
 * 既定ではプロフィール画像と投稿画像の両方が既にある行だけ API を叩く（`FXTWITTER_MEDIA_ENRICH_ALL=1` で全件）。
 * 各 ID での取得に失敗した場合は元のフィールドを維持する。対象件は Promise.all で並列。
 */
export async function enrichTweetHitsWithFxtwitter(
  hits: readonly TweetHit[]
): Promise<TweetHit[]> {
  if (!isFxtwitterMediaEnrichEnabled()) {
    return [...hits];
  }
  if (hits.length === 0) return [];

  return Promise.all(
    hits.map(async (hit) => {
      if (
        !isFxtwitterEnrichAllTweetHits() &&
        !tweetHitHasProfileAndTweetImages(hit)
      ) {
        return hit;
      }
      const extra = await fetchFxtwitterMediaFields(hit.id);
      if (!extra) return hit;

      return {
        ...hit,
        ...(extra.tweetImageUrls?.length
          ? { tweetImageUrls: extra.tweetImageUrls }
          : {}),
        ...(extra.userProfileImageUrl
          ? { userProfileImageUrl: extra.userProfileImageUrl }
          : {}),
        ...(extra.userProfileBannerUrl
          ? { userProfileBannerUrl: extra.userProfileBannerUrl }
          : {}),
      };
    })
  );
}
