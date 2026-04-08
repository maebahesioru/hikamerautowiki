import {
  factCheckWithOpenAI,
  type AiStreamOptions,
} from "@/lib/ai";
import { formatTokenUsageForProgressLine } from "@/lib/openaiUsage";
import { getComposeTweetMax } from "@/lib/tweetLimits";
import type {
  FactCheckReport,
  FactCheckRunLog,
  Proposal,
} from "@/lib/types";
import { wrapAiError } from "./pipelineEnv";
import { gatherProposalEvidence } from "./pipelineGather";

export type FactCheckPipelineResult = {
  report: FactCheckReport;
  tweetQueryUsed: string;
  tweetQueriesUsed: string[];
  tweetCount: number;
  log: FactCheckRunLog;
};

/**
 * ツイート・Wiki 内検索を取得したうえで、wikitext のファクトチェックのみ行う（MediaWiki には書き込まない）。
 */
export async function runFactCheckPipeline(
  proposal: Proposal,
  options: {
    /** 空でページ全文。指定時はこの抜粋を主に検証し、ページ全文は文脈として渡す */
    focusWikitext?: string;
    onProgress?: (message: string) => void;
    onAiStream?: (
      phase:
        | "suggest_queries"
        | "suggest_queries_reasoning"
        | "fact_check"
        | "fact_check_reasoning",
      delta: string
    ) => void;
  }
): Promise<FactCheckPipelineResult> {
  const onProgress = options.onProgress;
  const onAiStream = options.onAiStream;
  const suggestAiStreamOpts: AiStreamOptions | undefined =
    onAiStream || onProgress
      ? {
          ...(onAiStream
            ? {
                onStreamDelta: (d: string) => onAiStream("suggest_queries", d),
                onReasoningStreamDelta: (d: string) =>
                  onAiStream("suggest_queries_reasoning", d),
              }
            : onProgress
              ? { onStreamDelta: () => {} }
              : {}),
          onTokenUsage: (u) =>
            onProgress?.(
              formatTokenUsageForProgressLine(u, "検索クエリ生成")
            ),
          ...(onProgress
            ? {
                onAwaitingHttpResponse: () =>
                  onProgress(
                    "検索クエリ用 AI: リクエスト送信中（応答ヘッダ待ち。長いと数分）…"
                  ),
                onHttpResponseReady: () =>
                  onProgress(
                    "検索クエリ用 AI: 応答ストリーム受信中…"
                  ),
              }
            : {}),
        }
      : undefined;

  const g = await gatherProposalEvidence(
    proposal,
    onProgress,
    suggestAiStreamOpts
  );
  const {
    queries,
    querySource,
    tweetQueryUsed,
    tweetSearchRangeLabel,
    tweetSearchRangeSource,
    yahooErr,
    dbErr,
    wikiErr,
    tweets,
    wikiHitsForAi,
    yahooWebSearchHits,
    yahooWebSearchErr,
    yahooHits,
    dbHits,
    cap,
    current,
  } = g;

  const composeTweetMax = getComposeTweetMax();
  const tweetsForAi = tweets.slice(0, composeTweetMax);
  onProgress?.(
    `参照: ツイート ${tweets.length} 件（上限 ${cap}）、うちファクトチェック AI には先頭 ${tweetsForAi.length} 件まで（HIKAMER_COMPOSE_TWEET_MAX=${composeTweetMax}）${tweets.length > composeTweetMax ? `。以降 ${tweets.length - composeTweetMax} 件は含めません` : ""}。Wiki 関連ページ ${wikiHitsForAi.length} 件。Yahoo!ウェブ検索 ${yahooWebSearchHits.length} 件${yahooWebSearchErr ? "（一部失敗）" : ""}。AI がファクトチェックを実行しています（下にストリーミング表示）…`
  );

  try {
    const report = await factCheckWithOpenAI(
      {
        wikiTitle: proposal.wikiTitle,
        instruction: proposal.instruction,
        currentWikitext: current.wikitext,
        tweets: tweetsForAi,
        wikiSearchHits: wikiHitsForAi,
        yahooWebSearchHits,
        focusWikitext: options.focusWikitext?.trim() || undefined,
      },
      onAiStream || onProgress
        ? {
            ...(onAiStream
              ? {
                  onStreamDelta: (d: string) => onAiStream("fact_check", d),
                  onReasoningStreamDelta: (d: string) =>
                    onAiStream("fact_check_reasoning", d),
                }
              : onProgress
                ? { onStreamDelta: () => {} }
                : {}),
            onTokenUsage: (u) =>
              onProgress?.(
                formatTokenUsageForProgressLine(u, "ファクトチェック")
              ),
            ...(onProgress
              ? {
                  onAwaitingHttpResponse: () =>
                    onProgress(
                      "ファクトチェック AI: リクエスト送信中（応答ヘッダ待ち）…"
                    ),
                  onHttpResponseReady: () =>
                    onProgress(
                      "ファクトチェック AI: 応答ストリーム受信中…"
                    ),
                }
              : {}),
          }
        : undefined
    );

    const log: FactCheckRunLog = {
      querySource,
      tweetQueryUsed,
      tweetQueriesUsed: queries,
      tweetSearchRangeLabel,
      tweetSearchRangeSource,
      yahooCount: yahooHits.length,
      dbCount: dbHits.length,
      mergedTweetCount: tweets.length,
      cap,
      yahooError: yahooErr,
      dbError: dbErr,
      wikiSearchHitCount: wikiHitsForAi.length,
      wikiSearchError: wikiErr,
      yahooWebSearchHitCount: yahooWebSearchHits.length,
      yahooWebSearchError: yahooWebSearchErr,
    };

    return {
      report,
      tweetQueryUsed,
      tweetQueriesUsed: queries,
      tweetCount: tweets.length,
      log,
    };
  } catch (e) {
    wrapAiError("ファクトチェック", e);
  }
}
