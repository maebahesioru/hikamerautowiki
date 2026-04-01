import { describe, expect, it } from "vitest";
import {
  normalizeLikelyTwitterUsernameForApi,
  wikiSearchQueryForMediaWiki,
} from "./searchQueryNormalize";

describe("normalizeLikelyTwitterUsernameForApi", () => {
  it("空はそのまま", () => {
    expect(normalizeLikelyTwitterUsernameForApi("  ")).toBe("");
  });
  it("ID: はそのまま", () => {
    expect(normalizeLikelyTwitterUsernameForApi("ID:user")).toBe("ID:user");
  });
  it("@ はそのまま", () => {
    expect(normalizeLikelyTwitterUsernameForApi("@foo")).toBe("@foo");
  });
  it("英数字アンダーのみなら ID: を付与", () => {
    expect(normalizeLikelyTwitterUsernameForApi("elonmusk")).toBe(
      "ID:elonmusk"
    );
  });
  it("短すぎる単語は付与しない", () => {
    expect(normalizeLikelyTwitterUsernameForApi("a")).toBe("a");
  });
  it("日本語クエリはそのまま", () => {
    expect(normalizeLikelyTwitterUsernameForApi("ヒカマー")).toBe("ヒカマー");
  });
});

describe("wikiSearchQueryForMediaWiki", () => {
  it("ID: を外す", () => {
    expect(wikiSearchQueryForMediaWiki("ID:foo")).toBe("foo");
  });
  it("@ を外す", () => {
    expect(wikiSearchQueryForMediaWiki("@bar")).toBe("bar");
  });
  it("通常はトリムのみ", () => {
    expect(wikiSearchQueryForMediaWiki("  hello  ")).toBe("hello");
  });
});
