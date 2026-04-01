import type { TweetHit } from "@/lib/yahoo-realtime";

function normalizeWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * ISO 等の日時文字列をプロンプト用に整形（日本語・Asia/Tokyo）。
 * 解釈できないときは元文字列を返す。
 */
function formatPromptDateTime(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Tokyo",
  }).format(d);
}

/** user_id が無いときの重複排除キー（Yahoo 等） */
function accountKey(t: TweetHit): string {
  const id = t.authorId?.trim();
  if (id) return `id:${id}`;
  const n = t.displayName?.trim();
  if (n) return `name:${n}`;
  return `tweet:${t.id}`;
}

/** 画像 URL はプロンプトに出さず、参照番号 M1/M2… のみ割り当てる（トークン節約）。番号→URL は保存前に展開用に保持 */
function createMediaRefCounter() {
  let n = 1;
  const refToUrl = new Map<string, string>();
  return {
    nextIfUrl(url: string | undefined): string | null {
      if (!url?.trim()) return null;
      const id = `M${n++}`;
      refToUrl.set(id, url.trim());
      return id;
    },
    getRefToUrl(): ReadonlyMap<string, string> {
      return refToUrl;
    },
  };
}

export type TweetPromptParts = {
  prompt: string;
  /** M1 等 → 画像 URL（compose 後の wikitext で `| image = M1` 等を URL に置換する） */
  mediaRefToUrl: ReadonlyMap<string, string>;
};

/**
 * AI が出力した wikitext 内の参照番号を、保存前に実際の画像 URL へ置換する。
 * - `| image = M3` / `|image=M3`（大小無視）
 * - `{{MREF:3}}` または `{{MREF:M3}}`（本文にそのまま画像 URL を出す用）
 * マップに無い番号はそのまま残す。
 */
export function expandMediaRefsInWikitext(
  wikitext: string,
  mediaRefToUrl: ReadonlyMap<string, string>
): string {
  if (mediaRefToUrl.size === 0 || !wikitext) return wikitext;
  let out = wikitext;

  out = out.replace(/\{\{\s*MREF\s*:\s*M?(\d+)\s*\}\}/gi, (_, num: string) => {
    const key = `M${num}`;
    return mediaRefToUrl.get(key) ?? `{{MREF:${key}}}`;
  });

  out = out.replace(/\|\s*image\s*=\s*(M\d+)\b/gi, (full, ref: string) => {
    const url = mediaRefToUrl.get(ref);
    if (!url) return full;
    return `| image = ${url}`;
  });

  return out;
}

/**
 * `[[File:https://...]]` は MediaWiki では外部画像にならない（File: はローカルファイル名専用）。
 * 誤った出力を `[url キャプション]` 形式の外部リンクに直す。
 */
function pickCaptionFromFileParams(rest: string): string | undefined {
  const parts = rest
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^\d+px$/i.test(p)) continue;
    if (/^\d+x\d+px$/i.test(p)) continue;
    if (/^(thumb|frame|frameless|border|none)$/i.test(p)) continue;
    if (/^(left|right|center|baseline|middle|sub|super)$/i.test(p)) continue;
    return p;
  }
  return undefined;
}

export function fixMisusedFileNamespaceForExternalUrls(wikitext: string): string {
  if (!wikitext) return wikitext;
  return wikitext.replace(
    /\[\[File:(https?:\/\/[^|\]]+)(?:\|([^\]]*))?\]\]/gi,
    (full, url: string, rest: string | undefined) => {
      if (!rest?.trim()) return `[${url}]`;
      const cap = pickCaptionFromFileParams(rest);
      return cap ? `[${url} ${cap}]` : `[${url}]`;
    }
  );
}

function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * `[https://pbs.twimg.com/... ラベル]` は MediaWiki では**リンク**のみで画像は出ない。
 * オプションで `<img>` に置き換えられるが、**既定の MediaWiki は本文で生 HTML を解釈しない**
 * のでタグがそのままテキスト表示になる。**`HIKAMER_TWIMG_BRACKET_TO_IMG=1` のときだけ**実行し、
 * Wiki が img を許可する設定のときのみ使う。
 */
export function embedTwimgBracketLinksAsImg(wikitext: string): string {
  if (!wikitext || process.env.HIKAMER_TWIMG_BRACKET_TO_IMG !== "1") {
    return wikitext;
  }
  return wikitext.replace(
    /\[(https:\/\/pbs\.twimg\.com\/[^\s\]]+)(?:\s+([^\]]*))?\]/g,
    (full, url: string, caption: string | undefined) => {
      const alt = caption?.trim() ? escapeHtmlAttr(caption.trim()) : "";
      const src = escapeHtmlAttr(url);
      return `<img src="${src}" alt="${alt}" style="max-width:250px; height:auto;" />`;
    }
  );
}

/**
 * DB の拡張メタデータを活かしつつ、プロフィール等の重複を避けて AI に渡す本文を組み立てる。
 * - 同一 user_id（または表示名のみ）のアカウント情報は先頭に 1 回だけ
 * - 画像は参照番号 M1/M2… のみ（実 URL はプロンプトに含めない）
 * - 各ツイートに「画像: あり/なし」を明示
 * - `mediaRefToUrl` で M→URL を保持し、保存前に `expandMediaRefsInWikitext` で展開
 */
async function yieldToEventLoop(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function formatReferenceTweetsForPrompt(
  tweets: TweetHit[]
): Promise<TweetPromptParts> {
  const seenAccount = new Set<string>();
  const accountLines: string[] = [];
  const mediaRef = createMediaRefCounter();

  let accountPassIndex = 0;
  for (const t of tweets) {
    accountPassIndex++;
    if (accountPassIndex > 1 && accountPassIndex % 500 === 0) {
      await yieldToEventLoop();
    }
    const key = accountKey(t);
    if (seenAccount.has(key)) continue;
    const hasProfile =
      (t.userDescription != null && String(t.userDescription).trim() !== "") ||
      t.userFollowersCount != null ||
      t.userFollowingCount != null ||
      t.userTweetCount != null ||
      (t.userLocation != null && String(t.userLocation).trim() !== "") ||
      t.userVerified != null ||
      (t.userCreatedAt != null && String(t.userCreatedAt).trim() !== "") ||
      t.userProfileImageUrl != null ||
      t.userProfileBannerUrl != null;

    if (!hasProfile && !t.authorId && !t.displayName) continue;
    seenAccount.add(key);

    const iconRef = mediaRef.nextIfUrl(t.userProfileImageUrl);
    const bannerRef = mediaRef.nextIfUrl(t.userProfileBannerUrl);

    const parts: string[] = [];
    if (t.authorId?.trim()) parts.push(`user_id=${t.authorId.trim()}`);
    if (t.displayName?.trim()) parts.push(`表示名=${t.displayName.trim()}`);
    if (t.userDescription != null && String(t.userDescription).trim()) {
      parts.push(`プロフィール=${normalizeWs(String(t.userDescription))}`);
    }
    const fl = num(t.userFollowersCount);
    const fg = num(t.userFollowingCount);
    const tc = num(t.userTweetCount);
    if (fl != null) parts.push(`followers=${fl}`);
    if (fg != null) parts.push(`following=${fg}`);
    if (tc != null) parts.push(`ツイート数=${tc}`);
    if (t.userLocation != null && String(t.userLocation).trim()) {
      parts.push(`所在地=${normalizeWs(String(t.userLocation))}`);
    }
    const uca = formatPromptDateTime(
      t.userCreatedAt != null ? String(t.userCreatedAt) : undefined
    );
    if (uca) {
      parts.push(`アカウント作成=${uca}`);
    }
    if (t.userVerified != null && String(t.userVerified).trim() !== "") {
      parts.push(`認証=${String(t.userVerified).trim()}`);
    }
    parts.push(`アイコン=${iconRef ?? "なし"}`);
    parts.push(`ヘッダー=${bannerRef ?? "なし"}`);

    if (parts.length > 0) {
      accountLines.push(`- ${parts.join(" | ")}`);
    }
  }

  const header =
    "【参考ツイートの見方】同一アカウントのプロフィール・フォロワー数等は「アカウント一覧」に 1 回のみ。各ツイートは本文とメタ。添付画像・アイコン・ヘッダーは参照番号（M1 等）のみ示す（実 URL はこのプロンプトには含めない。トークン節約）。参照番号の付与順は (1) ツイートの並び順に現れる各アカウントの初出について、アイコン→ヘッダー、(2) その後にツイート 1 件目から順に、各ツイートの添付画像を枚数順（2 件目以降の同一アカウントはアイコン・ヘッダー用の番号を消費しない）。静止画のみ（動画・GIF は参照に含めない）。記事ではツイート id の出典を書く。**画像を閲覧可能に載せるには**、この Wiki では Infobox Person で `| image = M3` または `|image=M3`（番号は上の一覧と一致）と書くか、本文に `{{MREF:3}}`（M3 と同じ番号）と書く。Wiki 保存直前にサーバーがこれらを**実際の画像 URL**へ置換する。テンプレートが外部 URL の `image` に非対応なら、本文の `{{MREF:n}}` か外部リンク記法を使う。";

  const accountBlock =
    accountLines.length > 0
      ? [
          "",
          "【アカウント一覧（重複なし）】",
          ...accountLines,
          "",
        ].join("\n")
      : "";

  const tweetLines: string[] = [];
  for (let i = 0; i < tweets.length; i++) {
    if (i > 0 && i % 500 === 0) {
      await yieldToEventLoop();
    }
    const t = tweets[i]!;
    const label = t.displayName?.trim() ? ` ${t.displayName.trim()}` : "";
    const meta: string[] = [];
    const ca = formatPromptDateTime(
      t.createdAt != null ? String(t.createdAt) : undefined
    );
    if (ca) {
      meta.push(`時刻=${ca}`);
    }
    const r = num(t.replyCount);
    const rt = num(t.rtCount);
    const qt = num(t.qtCount);
    const lk = num(t.likesCount);
    const vw = num(t.viewCount);
    const bm = num(t.bookmarkCount);
    if (r != null) meta.push(`返信=${r}`);
    if (rt != null) meta.push(`RT=${rt}`);
    if (qt != null) meta.push(`引用RT=${qt}`);
    if (lk != null) meta.push(`いいね=${lk}`);
    if (vw != null) meta.push(`表示=${vw}`);
    if (bm != null) meta.push(`ブクマ=${bm}`);
    if (t.inReplyToScreenName != null && String(t.inReplyToScreenName).trim()) {
      meta.push(`返信先@${String(t.inReplyToScreenName).trim()}`);
    }
    if (t.quotedTweetText != null && String(t.quotedTweetText).trim()) {
      meta.push(`引用本文=${normalizeWs(String(t.quotedTweetText))}`);
    }

    const imgs = t.tweetImageUrls?.filter(Boolean) ?? [];
    const tweetRefs: string[] = [];
    for (let j = 0; j < imgs.length; j++) {
      const ref = mediaRef.nextIfUrl(imgs[j]);
      if (ref) tweetRefs.push(ref);
    }
    const hasTweetPhoto = tweetRefs.length > 0;
    meta.unshift(
      hasTweetPhoto
        ? `画像: あり（${tweetRefs.join(", ")}）`
        : "画像: なし"
    );

    const metaStr = meta.length > 0 ? ` (${meta.join(", ")})` : "";
    tweetLines.push(
      `${i + 1}. [tweet:${t.id}]${label}${metaStr}\n   ${t.text}`
    );
  }

  const prompt = [
    header,
    accountBlock,
    "【ツイート】",
    tweetLines.join("\n\n"),
  ].join("\n");

  return { prompt, mediaRefToUrl: mediaRef.getRefToUrl() };
}
