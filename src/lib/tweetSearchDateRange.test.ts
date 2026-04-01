import { describe, expect, it } from "vitest";
import { resolveTweetSearchRange } from "./tweetSearchDateRange";

describe("resolveTweetSearchRange", () => {
  it("両方空ならフィルタなし", () => {
    const r = resolveTweetSearchRange("", undefined);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.label).toBe("（指定なし）");
  });

  it("開始が終了より後ならエラー", () => {
    const r = resolveTweetSearchRange("2025-12-31", "2025-01-01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/前に/);
  });

  it("不正な日付文字列ならエラー", () => {
    const r = resolveTweetSearchRange("not-a-date", undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/読み取れません/);
  });

  it("YYYY-MM-DD のみなら ok と期間ラベル", () => {
    const r = resolveTweetSearchRange("2024-06-01", "2024-06-01");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sinceSec).toBeDefined();
      expect(r.untilSec).toBeDefined();
      expect(r.sinceSec!).toBeLessThanOrEqual(r.untilSec!);
      expect(r.label.length).toBeGreaterThan(0);
    }
  });
});
