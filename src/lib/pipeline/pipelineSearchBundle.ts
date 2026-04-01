import {
  mergeWikiSearchHitsByTitle,
  searchWikiPages,
  wikiTitlesLooselyEqual,
  type WikiSearchHit,
} from "@/lib/mediawiki";
import { mergeTweetHitsById, searchTweetsFromDatabase } from "@/lib/tweetsDb";
import {
  normalizeLikelyTwitterUsernameForApi,
  wikiSearchQueryForMediaWiki,
} from "@/lib/searchQueryNormalize";
import { stripSinceUntilFromYahooQuery } from "@/lib/yahooQuerySinceUntil";
import { searchYahooRealtimeTweets } from "@/lib/yahoo-realtime";
import type { TweetHit } from "@/lib/yahoo-realtime";
import { resolveTweetSearchRange } from "@/lib/tweetSearchDateRange";

export type TweetSearchRangeResolved = {
  sinceSec?: number;
  untilSec?: number;
  sinceDb?: Date;
  untilDb?: Date;
};

/** 1 クエリあたり DB / Wiki / Yahoo を並列で取り、結果だけ返す（パイプライン側で順にマージ）。 */
export async function fetchSearchBundleForQuery(
  apiUrl: string,
  wikiTitle: string,
  rawQuery: string,
  manualTweetRange?: TweetSearchRangeResolved
): Promise<{
  dbHits: TweetHit[];
  yahooHits: TweetHit[];
  wikiHits: WikiSearchHit[];
  dbErr?: string;
  wikiErr?: string;
  yahooErr?: string;
}> {
  const stripped = stripSinceUntilFromYahooQuery(rawQuery);
  const cleaned = stripped.cleaned.trim();
  const t = cleaned;
  const twitterQ = normalizeLikelyTwitterUsernameForApi(cleaned);
  const mwQ = wikiSearchQueryForMediaWiki(cleaned);

  let tweetRange: TweetSearchRangeResolved | undefined;
  if (manualTweetRange) {
    tweetRange = manualTweetRange;
  } else {
    const r = resolveTweetSearchRange(
      stripped.sinceForResolve,
      stripped.untilForResolve
    );
    if (
      r.ok &&
      (r.sinceDb != null ||
        r.untilDb != null ||
        r.sinceSec != null ||
        r.untilSec != null)
    ) {
      tweetRange = {
        sinceSec: r.sinceSec,
        untilSec: r.untilSec,
        sinceDb: r.sinceDb,
        untilDb: r.untilDb,
      };
    }
  }

  const dbOpts =
    tweetRange?.sinceDb != null || tweetRange?.untilDb != null
      ? {
          ...(tweetRange.sinceDb != null ? { since: tweetRange.sinceDb } : {}),
          ...(tweetRange.untilDb != null ? { until: tweetRange.untilDb } : {}),
        }
      : undefined;

  const yahooOpts =
    tweetRange?.sinceSec != null || tweetRange?.untilSec != null
      ? {
          ...(tweetRange.sinceSec != null ? { sinceSec: tweetRange.sinceSec } : {}),
          ...(tweetRange.untilSec != null ? { untilSec: tweetRange.untilSec } : {}),
        }
      : undefined;

  const [dbOut, wikiOut, yahooOut] = await Promise.all([
    searchTweetsFromDatabase(t, dbOpts)
      .then((h) => ({ ok: true as const, h }))
      .catch((e) => ({
        ok: false as const,
        msg: `${t}: ${e instanceof Error ? e.message : String(e)}`,
      })),
    mwQ.length > 0
      ? searchWikiPages(apiUrl, mwQ, 12)
          .then((wh) => ({ ok: true as const, wh }))
          .catch((e) => ({
            ok: false as const,
            msg: `${mwQ}: ${e instanceof Error ? e.message : String(e)}`,
          }))
      : Promise.resolve({ ok: true as const, wh: [] as WikiSearchHit[] }),
    searchYahooRealtimeTweets(twitterQ, yahooOpts)
      .then((h) => ({ ok: true as const, h }))
      .catch((e) => ({
        ok: false as const,
        msg: `${twitterQ}: ${e instanceof Error ? e.message : String(e)}`,
      })),
  ]);

  const dbHits = dbOut.ok ? dbOut.h : [];
  const dbErr = dbOut.ok ? undefined : dbOut.msg;

  let wikiHits: WikiSearchHit[] = [];
  let wikiErr: string | undefined;
  if (wikiOut.ok) {
    wikiHits = wikiOut.wh.filter(
      (hit) => !wikiTitlesLooselyEqual(hit.title, wikiTitle)
    );
  } else {
    wikiErr = wikiOut.msg;
  }

  const yahooHits = yahooOut.ok ? yahooOut.h : [];
  const yahooErr = yahooOut.ok ? undefined : yahooOut.msg;

  return { dbHits, yahooHits, wikiHits, dbErr, wikiErr, yahooErr };
}
