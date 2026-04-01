/**
 * MediaWiki の節見出し（行頭の == … == 形式）を解析する。
 * テンプレート内の改行や複雑な入れ子は想定外（通常の記事本文向け）。
 */

export type WikiOutlineSection = {
  /** 2〜6（== 〜 ======） */
  level: number;
  /** 見出し表示用（マークアップは含まない） */
  title: string;
  /** 当該見出し行から、同レベル以上の次の見出し直前までの wikitext */
  wikitext: string;
};

type HeadingRow = { lineIndex: number; level: number; title: string };

function collectHeadings(lines: string[]): HeadingRow[] {
  const headings: HeadingRow[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^(\={2,6})\s*(.+?)\s*\1\s*$/.exec(line);
    if (m) {
      const level = m[1].length;
      headings.push({ lineIndex: i, level, title: m[2].trim() });
    }
  }
  return headings;
}

/** 見出しが 1 行もないときは空配列 */
export function parseWikiSectionOutline(wikitext: string): WikiOutlineSection[] {
  const lines = wikitext.split(/\r?\n/);
  const headings = collectHeadings(lines);
  if (headings.length === 0) return [];

  const out: WikiOutlineSection[] = [];
  for (let k = 0; k < headings.length; k++) {
    const h = headings[k];
    const start = h.lineIndex;
    let endLine = lines.length - 1;
    for (let j = k + 1; j < headings.length; j++) {
      if (headings[j].level <= h.level) {
        endLine = headings[j].lineIndex - 1;
        break;
      }
    }
    const slice = lines.slice(start, endLine + 1).join("\n");
    out.push({ level: h.level, title: h.title, wikitext: slice });
  }
  return out;
}
