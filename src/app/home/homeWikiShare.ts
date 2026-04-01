import type { ShareSnapshot } from "@/app/home/homeTypes";

/** ブラウザ側でも検索が無限待ちにならないよう、自前 API より少し長めに打ち切る */
export const WIKI_SEARCH_CLIENT_TIMEOUT_MS = 55_000;

/** 人物の新規記事は Project 名前空間の `ヒカマーwiki:チラシの裏/` 配下に作成 */
export const CHIRASHI_URA_PREFIX = "ヒカマーwiki:チラシの裏/";
/** 以前のプレフィックスで入力・貼り付けされた場合も解釈 */
export const LEGACY_CHIRASHI_PREFIX = "チラシの裏/";

export function wikiArticleBase(): string {
  const b = process.env.NEXT_PUBLIC_WIKI_ARTICLE_BASE?.trim();
  return b ? b.replace(/\/$/, "") : "https://hikamers.net/wiki";
}

export function wikiArticleUrl(title: string): string {
  const segment = title.trim().replace(/\s+/g, "_");
  return `${wikiArticleBase()}/${encodeURIComponent(segment)}`;
}

/** X 共有文末尾のクレジット（このアプリの公開 URL） */
export function xShareAppCreditLine(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  let origin = "https://hikamerautowiki.vercel.app";
  if (raw) {
    try {
      origin = new URL(raw).origin;
    } catch {
      /* keep default */
    }
  }
  return `by ヒカマーWiki自動編集AI(${origin})`;
}

export function buildXShareText(s: ShareSnapshot): string {
  const credit = `\n${xShareAppCreditLine()}`;
  switch (s.kind) {
    case "edit":
      return `ヒカマーwiki「${s.wikiTitle}」を更新しました\n${wikiArticleUrl(s.wikiTitle)}${credit}`;
    case "create":
      return `ヒカマーwikiに「${s.wikiTitle}」という新規記事を追加しました\n${wikiArticleUrl(s.wikiTitle)}${credit}`;
    case "factcheck":
      return `ヒカマーwiki「${s.wikiTitle}」をファクトチェックしました\n${wikiArticleUrl(s.wikiTitle)}${credit}`;
    case "redirect":
      return `ヒカマーwiki「${s.wikiTitle}」→「${s.targetTitle}」へリダイレクトを作成しました\n${wikiArticleUrl(s.wikiTitle)}\n${wikiArticleUrl(s.targetTitle)}${credit}`;
  }
}

export function openXShareIntent(text: string): void {
  const u = new URL("https://twitter.com/intent/tweet");
  u.searchParams.set("text", text);
  window.open(u.toString(), "_blank", "noopener,noreferrer");
}

export function resolveNewArticleWikiTitle(
  raw: string,
  kind: "person" | "other"
): string {
  const t = raw.trim();
  if (kind === "other") return t;
  let rest = t;
  if (rest.startsWith(CHIRASHI_URA_PREFIX)) {
    rest = rest.slice(CHIRASHI_URA_PREFIX.length).trim();
  } else if (rest.startsWith(LEGACY_CHIRASHI_PREFIX)) {
    rest = rest.slice(LEGACY_CHIRASHI_PREFIX.length).trim();
  }
  return rest ? `${CHIRASHI_URA_PREFIX}${rest}` : "";
}
