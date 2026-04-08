import { describe, expect, it } from "vitest";
import {
  embedTwimgBracketLinksAsImg,
  expandMediaRefsInWikitext,
  expandTweetRefsInWikitext,
  fixMisusedFileNamespaceForExternalUrls,
} from "@/lib/tweetPrompt";

describe("expandMediaRefsInWikitext", () => {
  const map = new Map([
    ["M1", "https://pbs.twimg.com/a.png"],
    ["M3", "https://pbs.twimg.com/c.jpg"],
  ]);

  it("replaces | image = Mn with URL", () => {
    const w = "{{Infobox|\n| image = M3\n}}";
    expect(expandMediaRefsInWikitext(w, map)).toBe(
      "{{Infobox|\n| image = https://pbs.twimg.com/c.jpg\n}}"
    );
  });

  it("replaces {{MREF:n}} with URL", () => {
    expect(expandMediaRefsInWikitext("x {{MREF:3}} y", map)).toBe(
      "x https://pbs.twimg.com/c.jpg y"
    );
    expect(expandMediaRefsInWikitext("{{MREF:M3}}", map)).toBe(
      "https://pbs.twimg.com/c.jpg"
    );
  });

  it("leaves unknown refs", () => {
    expect(expandMediaRefsInWikitext("| image = M9", map)).toBe("| image = M9");
  });
});

describe("expandTweetRefsInWikitext", () => {
  const mw1 = "[https://x.com/i/status/111 ツイート]";
  const mw2 = "[https://x.com/i/status/222 ツイート]";
  const map = new Map([
    ["T1", "111"],
    ["T2", "222"],
  ]);

  it("replaces [tweet:Tn] with MediaWiki external link", () => {
    expect(expandTweetRefsInWikitext(`x [tweet:T1] y`, map)).toBe(`x ${mw1} y`);
  });

  it("replaces bare tweet:Tn with MediaWiki external link", () => {
    expect(expandTweetRefsInWikitext("出典 tweet:T2", map)).toBe(`出典 ${mw2}`);
  });

  it("replaces compact t:Tn with MediaWiki external link", () => {
    expect(expandTweetRefsInWikitext("x t:T1 y", map)).toBe(`x ${mw1} y`);
  });

  it("leaves unknown T refs", () => {
    expect(expandTweetRefsInWikitext("[tweet:T9]", map)).toBe("[tweet:T9]");
  });

  it("normalizes tweet:numeric id to labeled link without T map", () => {
    expect(expandTweetRefsInWikitext("x tweet:1952670718006841843 y", new Map())).toBe(
      "x [https://x.com/i/status/1952670718006841843 ツイート] y"
    );
  });

  it("normalizes [tweet:https://…status/…] to canonical URL + label", () => {
    expect(
      expandTweetRefsInWikitext(
        "[tweet:https://twitter.com/foo/status/1952670718006841843]",
        new Map()
      )
    ).toBe("[https://x.com/i/status/1952670718006841843 ツイート]");
  });

  it("fixes <https://… without closing > to MediaWiki link", () => {
    expect(
      expandTweetRefsInWikitext(
        "<https://x.com/i/web/status/2037355865062449518。 千葉",
        new Map()
      )
    ).toBe("[https://x.com/i/status/2037355865062449518 ツイート]。 千葉");
  });
});

describe("fixMisusedFileNamespaceForExternalUrls", () => {
  it("turns [[File:https://...|size|caption]] into external link", () => {
    const input =
      '[[File:https://pbs.twimg.com/media/GxozmN6aUAA6npt.jpg?name=orig|250px|番組ロゴ]]';
    expect(fixMisusedFileNamespaceForExternalUrls(input)).toBe(
      "[https://pbs.twimg.com/media/GxozmN6aUAA6npt.jpg?name=orig 番組ロゴ]"
    );
  });

  it("leaves real File: names alone", () => {
    expect(fixMisusedFileNamespaceForExternalUrls("[[File:Foo.png|thumb]]")).toBe(
      "[[File:Foo.png|thumb]]"
    );
  });
});

describe("embedTwimgBracketLinksAsImg", () => {
  it("replaces pbs.twimg bracket link with img only when HIKAMER_TWIMG_BRACKET_TO_IMG=1", () => {
    const prev = process.env.HIKAMER_TWIMG_BRACKET_TO_IMG;
    process.env.HIKAMER_TWIMG_BRACKET_TO_IMG = "1";
    try {
      const input =
        "[https://pbs.twimg.com/media/GxozmN6aUAA6npt.jpg?name=orig 番組ロゴ]";
      expect(embedTwimgBracketLinksAsImg(input)).toBe(
        '<img src="https://pbs.twimg.com/media/GxozmN6aUAA6npt.jpg?name=orig" alt="番組ロゴ" style="max-width:250px; height:auto;" />'
      );
    } finally {
      if (prev === undefined) delete process.env.HIKAMER_TWIMG_BRACKET_TO_IMG;
      else process.env.HIKAMER_TWIMG_BRACKET_TO_IMG = prev;
    }
  });

  it("skips by default (opt-in only)", () => {
    const prev = process.env.HIKAMER_TWIMG_BRACKET_TO_IMG;
    delete process.env.HIKAMER_TWIMG_BRACKET_TO_IMG;
    try {
      expect(embedTwimgBracketLinksAsImg("[https://pbs.twimg.com/x  y]")).toBe(
        "[https://pbs.twimg.com/x  y]"
      );
    } finally {
      if (prev === undefined) delete process.env.HIKAMER_TWIMG_BRACKET_TO_IMG;
      else process.env.HIKAMER_TWIMG_BRACKET_TO_IMG = prev;
    }
  });
});
