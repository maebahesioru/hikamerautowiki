import { describe, expect, it } from "vitest";
import {
  applyWikitextPatches,
  countOccurrences,
  type WikitextPatch,
} from "./wikitextPatch";

describe("countOccurrences", () => {
  it("空の needle は 0", () => {
    expect(countOccurrences("abc", "")).toBe(0);
  });
  it("重複しない走査で数える", () => {
    expect(countOccurrences("abab", "ab")).toBe(2);
    expect(countOccurrences("aaa", "aa")).toBe(1);
  });
});

describe("applyWikitextPatches", () => {
  it("1 件のパッチで置換", () => {
    expect(
      applyWikitextPatches("hello world", [
        { oldText: "world", newText: "wiki" },
      ])
    ).toBe("hello wiki");
  });
  it("順に複数パッチ", () => {
    const patches: WikitextPatch[] = [
      { oldText: "a", newText: "A" },
      { oldText: "A", newText: "B" },
    ];
    expect(applyWikitextPatches("a", patches)).toBe("B");
  });
  it("oldText が無いとエラー", () => {
    expect(() =>
      applyWikitextPatches("x", [{ oldText: "y", newText: "z" }])
    ).toThrow(/見つかりません/);
  });
  it("oldText が複数回出るとエラー", () => {
    expect(() =>
      applyWikitextPatches("aa", [{ oldText: "a", newText: "b" }])
    ).toThrow(/一意に適用できません/);
  });
  it("oldText が空だとエラー", () => {
    expect(() =>
      applyWikitextPatches("x", [{ oldText: "", newText: "y" }])
    ).toThrow(/oldText が空/);
  });
});
