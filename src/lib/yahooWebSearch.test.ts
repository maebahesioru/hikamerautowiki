import { describe, expect, it } from "vitest";
import { parseYahooWebSearchHtml } from "./yahooWebSearch";

const FIXTURE = `<div id="web"><h2>ウェブ</h2><ol><li><a href="https://example.com/page" rel="noreferrer">Title <b>One</b></a><div>Snippet line for one.</div><em>https://example.com</em></li><li><a href="https://search.yahoo.co.jp/clear.gif" rel="noreferrer">bad</a><div>x</div></li><li><a href="https://youtube.com/watch?v=abc" rel="noreferrer">動画</a><div>Desc</div><em>youtube.com</em></li></ol></div>`;

describe("parseYahooWebSearchHtml", () => {
  it("parses titles, urls, snippets and skips clear.gif", () => {
    const hits = parseYahooWebSearchHtml(FIXTURE);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toEqual({
      url: "https://example.com/page",
      title: "Title One",
      snippet: "Snippet line for one.",
    });
    expect(hits[1]?.url).toBe("https://youtube.com/watch?v=abc");
    expect(hits[1]?.title).toBe("動画");
    expect(hits[1]?.snippet).toBe("Desc");
  });
});
