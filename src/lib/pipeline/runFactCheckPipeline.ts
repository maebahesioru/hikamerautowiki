import {
  factCheckWithOpenAI,
  type AiStreamOptions,
} from "@/lib/ai";
import { formatTokenUsageForProgressLine } from "@/lib/openaiUsage";
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
            : {}),
          onTokenUsage: (u) =>
            onProgress?.(
              formatTokenUsageForProgressLine(u, "検索クエリ生成")
            ),
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
    yahooHits,
    dbHits,
    cap,
    current,
  } = g;

  onProgress?.(
    `参照: ツイート ${tweets.length} 件（上限 ${cap}）、Wiki 関連ページ ${wikiHitsForAi.length} 件。AI がファクトチェックを実行しています（下にストリーミング表示）…`
  );

  try {
    const report = await factCheckWithOpenAI(
      {
        wikiTitle: proposal.wikiTitle,
        instruction: proposal.instruction,
        currentWikitext: current.wikitext,
        tweets,
        wikiSearchHits: wikiHitsForAi,
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
              : {}),
            onTokenUsage: (u) =>
              onProgress?.(
                formatTokenUsageForProgressLine(u, "ファクトチェック")
              ),
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
