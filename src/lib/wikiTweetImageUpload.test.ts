import { describe, expect, it } from "vitest";
import { extractPbsTwimgUrls } from "@/lib/wikiTweetImageUpload";

describe("extractPbsTwimgUrls", () => {
  it("collects unique URLs longest-first", () => {
    const w = `
| image = https://pbs.twimg.com/a/x.jpg?y=1
[[File:https://pbs.twimg.com/a/x.jpg?y=1|thumb]]
`;
    const u = extractPbsTwimgUrls(w);
    expect(u.length).toBe(1);
    expect(u[0]).toContain("pbs.twimg.com");
  });
});
