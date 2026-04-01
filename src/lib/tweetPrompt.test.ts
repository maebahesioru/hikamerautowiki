import { describe, expect, it } from "vitest";
import {
  embedTwimgBracketLinksAsImg,
  expandMediaRefsInWikitext,
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
