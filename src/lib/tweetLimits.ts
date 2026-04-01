/** 環境変数未設定時の既定（README / .env.example と揃える） */
export const DEFAULT_HIKAMER_TWEET_TOTAL_LIMIT = 10_000;

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
