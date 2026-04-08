import {
  broadQueriesFromWikiTitle,
  normalizeTweetQueriesList,
  suggestTweetSearchBundle,
  type AiStreamOptions,
} from "@/lib/ai";
import {
  enrichWikiSearchHitsWithWikitext,
  fetchWikiWikitextPublic,
  mergeWikiSearchHitsByTitle,
  searchWikiPages,
  wikiTitlesLooselyEqual,
  type WikiRevision,
  type WikiSearchHit,
} from "@/lib/mediawiki";
import { getQueryBootstrapTweetMax, getTweetTotalLimit } from "@/lib/tweetLimits";
import { mergeTweetHitsById, orderTweetHitsDbPriorityRandom } from "@/lib/tweetsDb";
import {
  stripSinceUntilFromYahooQuery,
  tweetRangeLabelFromQueries,
} from "@/lib/yahooQuerySinceUntil";
import type { TweetHit } from "@/lib/yahoo-realtime";
import {
  resolveTweetSearchRange,
  type ResolvedTweetSearchRange,
} from "@/lib/tweetSearchDateRange";
import {
  enrichTweetHitsWithFxtwitter,
  isFxtwitterEnrichAllTweetHits,
  isFxtwitterMediaEnrichEnabled,
  tweetHitHasProfileAndTweetImages,
} from "@/lib/fxtwitter";
import { fetchYahooWebSearchForQueries } from "@/lib/yahooWebSearch";
import type { YahooWebSearchHit } from "@/lib/yahooWebSearch";
import { mapPool } from "@/lib/concurrency";
import type { PipelineRunLog, Proposal } from "@/lib/types";
import {
  getEnv,
  getSearchConcurrency,
  wrapAiError,
  WIKI_CONTEXT_MAX_PAGES,
} from "./pipelineEnv";
import {
  fetchSearchBundleForQuery,
  type TweetSearchRangeResolved,
} from "./pipelineSearchBundle";

export type GatheredProposalEvidence = {
  apiUrl: string;
  current: WikiRevision;
  queries: string[];
  querySource: PipelineRunLog["querySource"];
  tweetQueryUsed: string;
  tweetQueriesUsed: string[];
  tweetSearchRangeLabel: string;
  tweetSearchRangeSource: NonNullable<
    PipelineRunLog["tweetSearchRangeSource"]
  >;
  yahooErr?: string;
  dbErr?: string;
  wikiErr?: string;
  tweets: TweetHit[];
  wikiHitsForAi: WikiSearchHit[];
  yahooHits: TweetHit[];
  dbHits: TweetHit[];
  cap: number;
  /** Yahoo!ウェブ検索（ツイート検索クエリから。YouTube・ニコニコ等の SERP に含まれる場合あり） */
  yahooWebSearchHits: YahooWebSearchHit[];
  yahooWebSearchErr?: string;
};

/**
 * ページ名のみ検索でブートストラップ用ツイートを取得（検索クエリ生成の参考）。FxTwitter 補完なし。
 */
export async function fetchBootstrapTweetHitsForProposal(
  proposal: Proposal,
  onProgress?: (m: string) => void
): Promise<TweetHit[] | undefined> {
  const apiUrl = getEnv("WIKI_API_URL", "https://hikamers.net/api.php");
  const cap = getTweetTotalLimit();
  const manualDate =
    Boolean(proposal.tweetSince?.trim()) || Boolean(proposal.tweetUntil?.trim());
  onProgress?.(
    `ページ名「${proposal.wikiTitle}」だけでツイートを取得し、検索クエリ生成の参考にします（DB 優先マージ・上限 ${cap} 件は記事生成と同じ）…`
  );
  try {
    let bootstrapManualRange: TweetSearchRangeResolved | undefined;
    if (manualDate) {
      const r = resolveTweetSearchRange(
        proposal.tweetSince,
        proposal.tweetUntil
      );
      if (
        r.ok &&
        (r.sinceSec != null ||
          r.untilSec != null ||
          r.sinceDb != null ||
          r.untilDb != null)
      ) {
        bootstrapManualRange = {
          sinceSec: r.sinceSec,
          untilSec: r.untilSec,
          sinceDb: r.sinceDb,
          untilDb: r.untilDb,
        };
      }
    }
    const b = await fetchSearchBundleForQuery(
      apiUrl,
      proposal.wikiTitle,
      proposal.wikiTitle,
      bootstrapManualRange
    );
    let merged = mergeTweetHitsById(b.dbHits, b.yahooHits);
    if (merged.length > 0) {
      merged = orderTweetHitsDbPriorityRandom(merged, b.dbHits, cap);
    }
    if (merged.length > 0) {
      onProgress?.(
        `（検索クエリ用の参考ツイート: ${merged.length} 件取得。検索クエリ AI には先頭最大 ${getQueryBootstrapTweetMax()} 件まで（HIKAMER_QUERY_BOOTSTRAP_TWEET_MAX）。FxTwitter 補完は検索ワード段階では行いません）`
      );
    }
    return merged.length > 0 ? merged : undefined;
  } catch (e) {
    onProgress?.(
      `（ページ名の先行ツイート取得をスキップ: ${e instanceof Error ? e.message : String(e)}）`
    );
    return undefined;
  }
}

/** 証拠 API の「ブートストラップのみ」フェーズ用（Wiki 本文取得なし） */
export async function fetchBootstrapEvidenceOnly(
  proposal: Proposal,
  onProgress?: (m: string) => void
): Promise<{ bootstrapTweets: TweetHit[] | undefined; cap: number }> {
  const cap = getTweetTotalLimit();
  const bootstrapTweets = await fetchBootstrapTweetHitsForProposal(
    proposal,
    onProgress
  );
  return { bootstrapTweets, cap };
}

export async function gatherProposalEvidence(
  proposal: Proposal,
  onProgress: ((m: string) => void) | undefined,
  suggestAiStreamOpts: AiStreamOptions | undefined
): Promise<GatheredProposalEvidence> {
  const apiUrl = getEnv("WIKI_API_URL", "https://hikamers.net/api.php");
  onProgress?.("Wiki の現在の記事を取得しています…");
  const current = await fetchWikiWikitextPublic(apiUrl, proposal.wikiTitle);

  const manualDate =
    Boolean(proposal.tweetSince?.trim()) || Boolean(proposal.tweetUntil?.trim());

  const userTweetQuery = proposal.tweetQuery?.trim();
  const querySource: PipelineRunLog["querySource"] = userTweetQuery
    ? "user"
    : "ai";

  const loadBootstrapTweetsForSuggest = async (): Promise<
    TweetHit[] | undefined
  > => fetchBootstrapTweetHitsForProposal(proposal, onProgress);

  let bootstrapTweets: TweetHit[] | undefined;
  if (!userTweetQuery) {
    bootstrapTweets = await loadBootstrapTweetsForSuggest();
  }

  let queries: string[];

  if (userTweetQuery) {
    onProgress?.("登録された検索クエリを読み込んでいます…");
    queries = normalizeTweetQueriesList(
      userTweetQuery.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    );
    if (queries.length === 0) {
      onProgress?.("AI が検索クエリを生成しています（下にストリーミング表示）…");
      try {
        if (bootstrapTweets === undefined) {
          bootstrapTweets = await loadBootstrapTweetsForSuggest();
        }
        const bundle = await suggestTweetSearchBundle(
          proposal.instruction,
          proposal.wikiTitle,
          current.wikitext,
          suggestAiStreamOpts,
          bootstrapTweets
        );
        queries = normalizeTweetQueriesList(bundle.queries);
      } catch (e) {
        wrapAiError("検索クエリ生成", e);
      }
    }
  } else {
    onProgress?.("AI が検索クエリを生成しています（下にストリーミング表示）…");
    try {
      const bundle = await suggestTweetSearchBundle(
        proposal.instruction,
        proposal.wikiTitle,
        current.wikitext,
        suggestAiStreamOpts,
        bootstrapTweets
      );
      queries = normalizeTweetQueriesList(bundle.queries);
    } catch (e) {
      wrapAiError("検索クエリ生成", e);
    }
  }

  if (queries.length === 0) {
    queries = normalizeTweetQueriesList([proposal.wikiTitle]);
  }
  queries = normalizeTweetQueriesList([
    ...queries,
    ...broadQueriesFromWikiTitle(proposal.wikiTitle),
  ]);

  let rangeResolved!: Extract<ResolvedTweetSearchRange, { ok: true }>;
  let tweetSearchRangeSource: NonNullable<
    PipelineRunLog["tweetSearchRangeSource"]
  >;

  if (manualDate) {
    const r = resolveTweetSearchRange(proposal.tweetSince, proposal.tweetUntil);
    if (!r.ok) {
      throw new Error(r.error);
    }
    rangeResolved = r;
    tweetSearchRangeSource = "manual";
  } else {
    rangeResolved = tweetRangeLabelFromQueries(queries);
    tweetSearchRangeSource = "query";
  }

  if (rangeResolved.label !== "（指定なし）") {
    onProgress?.(`ツイート検索の期間: ${rangeResolved.label}`);
  }

  const manualTweetRange: TweetSearchRangeResolved | undefined =
    manualDate &&
    (rangeResolved.sinceSec != null ||
      rangeResolved.untilSec != null ||
      rangeResolved.sinceDb != null ||
      rangeResolved.untilDb != null)
      ? {
          sinceSec: rangeResolved.sinceSec,
          untilSec: rangeResolved.untilSec,
          sinceDb: rangeResolved.sinceDb,
          untilDb: rangeResolved.untilDb,
        }
      : undefined;

  const tweetSearchRangeLabel = rangeResolved.label;

  onProgress?.(
    `検索クエリ ${queries.length} 件: ${queries.map((q) => `「${q}」`).join("、")}`
  );

  const tweetQueryUsed = queries.join(" | ");

  const searchable = queries.filter((q) => {
    const t = q.trim();
    return t.length > 0 && !t.startsWith("(");
  });

  const yahooErrParts: string[] = [];
  const dbErrParts: string[] = [];
  const wikiErrParts: string[] = [];

  const searchConc = getSearchConcurrency();
  onProgress?.(
    `取得: ページ名「${proposal.wikiTitle}」＋ クエリ ${searchable.length} 件（クエリは同時 ${searchConc} 件まで・各クエリ内は DB / Wiki / Yahoo 並列）`
  );

  const evidenceSearchResults = await Promise.all([
    (async (): Promise<{ hits: WikiSearchHit[]; err?: string }> => {
      try {
        const titleHits = await searchWikiPages(apiUrl, proposal.wikiTitle, 25);
        return {
          hits: titleHits.filter(
            (hit) => !wikiTitlesLooselyEqual(hit.title, proposal.wikiTitle)
          ),
        };
      } catch (e) {
        return {
          hits: [],
          err: `title:${e instanceof Error ? e.message : String(e)}`,
        };
      }
    })(),
    mapPool(searchable, searchConc, (q) =>
      fetchSearchBundleForQuery(apiUrl, proposal.wikiTitle, q, manualTweetRange)
    ),
  ]);
  const titleWikiPart = evidenceSearchResults[0];
  const queryBundles = evidenceSearchResults[1];

  let wikiHitsMerged = mergeWikiSearchHitsByTitle([], titleWikiPart.hits);
  if (titleWikiPart.err) wikiErrParts.push(titleWikiPart.err);

  let yahooHits: TweetHit[] = [];
  let dbHits: TweetHit[] = [];

  for (const b of queryBundles) {
    dbHits = mergeTweetHitsById(dbHits, b.dbHits);
    yahooHits = mergeTweetHitsById(yahooHits, b.yahooHits);
    wikiHitsMerged = mergeWikiSearchHitsByTitle(wikiHitsMerged, b.wikiHits);
    if (b.dbErr) dbErrParts.push(b.dbErr);
    if (b.wikiErr) wikiErrParts.push(b.wikiErr);
    if (b.yahooErr) yahooErrParts.push(b.yahooErr);
  }

  if (searchable.length === 0) {
    onProgress?.("（有効な検索クエリがなく、ツイート検索をスキップしました）");
  }
  const yahooErr = yahooErrParts.length ? yahooErrParts.join("; ") : undefined;
  const dbErr = dbErrParts.length ? dbErrParts.join("; ") : undefined;
  const wikiErr =
    wikiErrParts.length > 0 ? wikiErrParts.join("; ") : undefined;

  const webSearchPromise = fetchYahooWebSearchForQueries(searchable, {
    onProgress,
  });

  let wikiHitsForAi = wikiHitsMerged.slice(0, WIKI_CONTEXT_MAX_PAGES);
  if (wikiHitsForAi.length > 0) {
    onProgress?.(
      `Wiki 内検索の関連 ${wikiHitsForAi.length} ページの本文（wikitext）を取得しています…`
    );
    wikiHitsForAi = await enrichWikiSearchHitsWithWikitext(apiUrl, wikiHitsForAi, {
      concurrency: getSearchConcurrency(),
    });
  }

  const yahooWebBundle = await webSearchPromise;

  const cap = getTweetTotalLimit();
  const merged = mergeTweetHitsById(dbHits, yahooHits);
  const capped = orderTweetHitsDbPriorityRandom(merged, dbHits, cap);
  if (capped.length > 0 && isFxtwitterMediaEnrichEnabled()) {
    const enrichAll = isFxtwitterEnrichAllTweetHits();
    const eligible = enrichAll
      ? capped.length
      : capped.filter(tweetHitHasProfileAndTweetImages).length;
    if (eligible > 0) {
      onProgress?.(
        enrichAll
          ? `ツイート ${capped.length} 件について画像・プロフィールを FxTwitter API で補完しています（全件並列）…`
          : `ツイート ${eligible} 件（全 ${capped.length} 件中・プロフィール画像と投稿画像の両方がある行のみ）を FxTwitter API で補完しています（並列）…`
      );
    }
  }
  const tweets = await enrichTweetHitsWithFxtwitter(capped);

  return {
    apiUrl,
    current,
    queries,
    querySource,
    tweetQueryUsed,
    tweetQueriesUsed: queries,
    tweetSearchRangeLabel,
    tweetSearchRangeSource,
    yahooErr,
    dbErr,
    wikiErr,
    tweets,
    wikiHitsForAi,
    yahooHits,
    dbHits,
    cap,
    yahooWebSearchHits: yahooWebBundle.hits,
    yahooWebSearchErr: yahooWebBundle.error,
  };
}
