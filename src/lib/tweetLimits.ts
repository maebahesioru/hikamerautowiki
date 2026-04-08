/** 環境変数未設定時の既定（README / .env.example と揃える） */
export const DEFAULT_HIKAMER_TWEET_TOTAL_LIMIT = 6000;

/** DB 優先で Yahoo とマージしたあとのツイート合計上限（既定は DEFAULT_HIKAMER_TWEET_TOTAL_LIMIT） */
export function getTweetTotalLimit(): number {
  return Math.min(
    Math.max(
      Number(
        process.env.HIKAMER_TOTAL_TWEET_LIMIT ?? DEFAULT_HIKAMER_TWEET_TOTAL_LIMIT
      ),
      1
    ),
    500_000
  );
}

/**
 * 検索クエリ生成 AI に渡す「ページ名ブートストラップ」ツイートの最大件数。
 * Gemini 直 API は 100 万トークン級でも、OpenAI 互換ゲートウェイはより低い実効上限・空応答になりやすい。
 * 既定は 6000（`HIKAMER_TOTAL_TWEET_LIMIT` と同じ）。ゲートウェイで空応答になるときだけ下げる。
 */
export const DEFAULT_HIKAMER_QUERY_BOOTSTRAP_TWEET_MAX = 6000;

export function getQueryBootstrapTweetMax(): number {
  const raw = process.env.HIKAMER_QUERY_BOOTSTRAP_TWEET_MAX?.trim();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_HIKAMER_QUERY_BOOTSTRAP_TWEET_MAX;
  if (!Number.isFinite(n)) return DEFAULT_HIKAMER_QUERY_BOOTSTRAP_TWEET_MAX;
  return Math.min(Math.max(n, 1), 50_000);
}

/** 検索クエリ生成 AI に載せる現在記事 wikitext の最大文字数（超過分は省略） */
export const DEFAULT_HIKAMER_QUERY_SUGGEST_WIKITEXT_MAX_CHARS = 100_000;

export function getQuerySuggestWikitextMaxChars(): number {
  const raw = process.env.HIKAMER_QUERY_SUGGEST_WIKITEXT_MAX_CHARS?.trim();
  const n = raw
    ? Number.parseInt(raw, 10)
    : DEFAULT_HIKAMER_QUERY_SUGGEST_WIKITEXT_MAX_CHARS;
  if (!Number.isFinite(n)) return DEFAULT_HIKAMER_QUERY_SUGGEST_WIKITEXT_MAX_CHARS;
  return Math.min(Math.max(n, 5000), 500_000);
}

/**
 * wikitext 編集・ファクトチェック AI に渡すツイートの最大件数（マージ後リストの先頭から `slice`）。
 * 先に Yahoo+DB 合計が `HIKAMER_TOTAL_TWEET_LIMIT` で切られるので、ここをそれより大きくしても増えない。
 * `formatReferenceTweetsForPrompt` は検索クエリ用ブートストラップより長く、件数が多いと ~90 万トークン超になりゲートウェイが completion_tokens=0 になりやすい。
 */
export const DEFAULT_HIKAMER_COMPOSE_TWEET_MAX = 6000;

export function getComposeTweetMax(): number {
  const raw = process.env.HIKAMER_COMPOSE_TWEET_MAX?.trim();
  const n = raw ? Number.parseInt(raw, 10) : DEFAULT_HIKAMER_COMPOSE_TWEET_MAX;
  if (!Number.isFinite(n)) return DEFAULT_HIKAMER_COMPOSE_TWEET_MAX;
  return Math.min(Math.max(n, 1), 50_000);
}
