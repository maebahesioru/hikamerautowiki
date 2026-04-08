/**
 * ブラウザから /api を叩くときに付けるヘッダー。
 * サーバーの `HIKAMER_API_SECRET` と同じ値を `NEXT_PUBLIC_HIKAMER_API_SECRET` に設定する
 * （公開 JS に埋まるため、IP 制限と併用推奨）。
 */
export function apiClientHeaders(): Record<string, string> {
  const s = process.env.NEXT_PUBLIC_HIKAMER_API_SECRET?.trim();
  if (!s) return {};
  return { "X-Hikamer-Api-Secret": s };
}
