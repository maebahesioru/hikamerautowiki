/**
 * Yahoo リアルタイム用: 英数字のみの単語は X の screen_name とみなし ID: を付与
 * （裸のままだと全文検索になりヒットが偏る）
 * DB の `searchTweetsFromDatabase` には渡さず、本文キーワード検索を優先する（pipeline は生クエリを渡す）。
 */
export function normalizeLikelyTwitterUsernameForApi(q: string): string {
  const t = q.trim();
  if (!t) return t;
  if (/^ID:/i.test(t)) return t;
  if (t.startsWith("@")) return t;
  if (/^[A-Za-z0-9_]{2,15}$/.test(t)) {
    return `ID:${t}`;
  }
  return t;
}

/** MediaWiki の list=search 用（ID: / @ は意味が違うので外す） */
export function wikiSearchQueryForMediaWiki(q: string): string {
  const t = q.trim();
  if (!t) return t;
  if (/^ID:/i.test(t)) return t.slice(3).trim();
  if (t.startsWith("@")) return t.slice(1).trim();
  return t;
}
