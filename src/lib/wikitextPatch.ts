/** oldText が haystack に出現する回数（重複しない走査） */
export function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let pos = 0;
  while ((pos = haystack.indexOf(needle, pos)) !== -1) {
    n++;
    pos += needle.length;
  }
  return n;
}

export type WikitextPatch = { oldText: string; newText: string };

/**
 * 順に適用。各 oldText は適用直前の文字列にちょうど 1 回だけ出現する必要がある。
 * newText に `$` が含まれても String#replace の置換参照にならないよう結合で適用する。
 */
export function applyWikitextPatches(
  current: string,
  patches: WikitextPatch[]
): string {
  let t = current;
  for (let i = 0; i < patches.length; i++) {
    const { oldText, newText } = patches[i];
    if (oldText.length === 0) {
      throw new Error(`パッチ ${i + 1}: oldText が空です`);
    }
    const c = countOccurrences(t, oldText);
    if (c === 0) {
      throw new Error(
        `パッチ ${i + 1}: oldText が現在の wikitext に見つかりません（先頭 80 文字: ${oldText.slice(0, 80)}…）`
      );
    }
    if (c > 1) {
      throw new Error(
        `パッチ ${i + 1}: oldText が ${c} 回出現するため一意に適用できません`
      );
    }
    const idx = t.indexOf(oldText);
    t = t.slice(0, idx) + newText + t.slice(idx + oldText.length);
  }
  return t;
}
