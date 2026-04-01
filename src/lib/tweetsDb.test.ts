import { describe, expect, it } from "vitest";
import type { TweetHit } from "@/lib/yahoo-realtime";
import { mergeTweetHitsById, orderTweetHitsDbPriorityRandom } from "@/lib/tweetsDb";

function hit(id: string, text: string): TweetHit {
  return { id, text };
}

describe("orderTweetHitsDbPriorityRandom", () => {
  it("DB id を先にまとめ、cap 件に切る", () => {
    const dbHits = [hit("a", "1"), hit("b", "2")];
    const yahooHits = [hit("c", "3"), hit("d", "4"), hit("e", "5")];
    const merged = mergeTweetHitsById(dbHits, yahooHits);
    const out = orderTweetHitsDbPriorityRandom(merged, dbHits, 3);
    expect(out).toHaveLength(3);
    const ids = out.map((t) => t.id);
    expect(ids.slice(0, 2).sort()).toEqual(["a", "b"]);
    expect(["c", "d", "e"]).toContain(ids[2]);
  });
});
