import {
  composeWikitextWithOpenAI,
  type AiStreamOptions,
  type ComposeResult,
} from "@/lib/ai";
import { formatTokenUsageForProgressLine } from "@/lib/openaiUsage";
import { editWikiPage, mediaWikiLogin } from "@/lib/mediawiki";
import {
  predictInlineWikiFilename,
  uploadInlineAttachmentsToWiki,
  type DecodedInlineAttachment,
  type PreUploadedWikiFile,
} from "@/lib/inlineAttachmentImages";
import { uploadPbsTwimgUrlsInWikitext } from "@/lib/wikiTweetImageUpload";
import type { PipelineRunLog, Proposal } from "@/lib/types";
import { loadWikitempForPrompt } from "@/lib/wikitemp";
import { getEnv, wrapAiError } from "./pipelineEnv";
import { gatherProposalEvidence } from "./pipelineGather";

export type PipelineResult = {
  proposal: Proposal;
  /** 互換用（複数クエリを区切った 1 文字列） */
  tweetQueryUsed: string;
  tweetQueriesUsed: string[];
  tweetCount: number;
  applied: boolean;
  log: PipelineRunLog;
};

export async function runProposalPipeline(
  proposal: Proposal,
  options: {
    dryRun: boolean;
    /** サーバーからクライアントへ進捗を流すときに使用 */
    onProgress?: (message: string) => void;
    /** AI のトークン生成を SSE で転送するとき（推論は *_reasoning フェーズ） */
    onAiStream?: (
      phase:
        | "suggest_queries"
        | "suggest_queries_reasoning"
        | "compose_wikitext"
        | "compose_wikitext_reasoning",
      delta: string
    ) => void;
    /** フォーム添付画像（API で検証済み。記事編集・新規のみ） */
    attachedImages?: DecodedInlineAttachment[];
  }
): Promise<PipelineResult> {
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

  if (proposal.createNewArticle) {
    const cur = g.current;
    const trimmed = (cur.wikitext ?? "").trim();
    if (!cur.missing && trimmed.length > 0) {
      throw new Error(
        "「新規記事作成」では実行できません: このタイトルのページには既に本文があります（またはリダイレクトのみです）。「記事を編集」で開いてください。"
      );
    }
  }

  const {
    apiUrl,
    current,
    queries,
    querySource,
    tweetQueryUsed,
    tweetSearchRangeLabel,
    tweetSearchRangeSource,
    yahooErr,
    dbErr,
    wikiErr,
    wikiHitsForAi,
    yahooHits,
    dbHits,
    cap,
  } = g;

  const tweets = g.tweets;

  let wikitempStyleExample: string | undefined;
  if (proposal.createNewArticle) {
    const wt = loadWikitempForPrompt();
    wikitempStyleExample = wt.trim() || undefined;
    if (wikitempStyleExample) {
      onProgress?.(
        "public/wikitemp.txt を体裁の参考として AI に渡します…"
      );
    } else {
      onProgress?.(
        "public/wikitemp.txt を読めませんでした（体裁の参考は省略）"
      );
    }
  }

  let attachmentWikiSession:
    | { jar: Map<string, string>; csrfToken: string }
    | undefined;
  let preUploadedWikiFiles: PreUploadedWikiFile[] | undefined;

  const inlineAtt = options.attachedImages;
  if (inlineAtt && inlineAtt.length > 0) {
    if (options.dryRun) {
      onProgress?.(
        "プレビュー: 添付画像は Wiki にアップロードしません。ファイル名は本番反映時と同じルールで AI に渡します…"
      );
      preUploadedWikiFiles = inlineAtt.map((it) => ({
        wikiFilename: predictInlineWikiFilename(
          it.data,
          it.originalName,
          it.mimeType
        ),
        originalName: it.originalName,
      }));
    } else {
      onProgress?.("フォーム添付画像を Wiki にアップロードしています…");
      const wikiUser = getEnv("WIKI_USERNAME");
      const wikiPass = getEnv("WIKI_PASSWORD");
      const login = await mediaWikiLogin(apiUrl, wikiUser, wikiPass);
      attachmentWikiSession = {
        jar: login.jar,
        csrfToken: login.csrfToken,
      };
      preUploadedWikiFiles = await uploadInlineAttachmentsToWiki(
        apiUrl,
        login.jar,
        login.csrfToken,
        inlineAtt,
        { onProgress }
      );
    }
  }

  onProgress?.(
    `参照: ツイート ${tweets.length} 件（上限 ${cap}）、Wiki 関連ページ ${wikiHitsForAi.length} 件。AI が wikitext を編集しています（下にストリーミング表示）…`
  );
  let composed: ComposeResult;
  try {
    composed = await composeWikitextWithOpenAI(
      {
        wikiTitle: proposal.wikiTitle,
        instruction: proposal.instruction,
        currentWikitext: current.wikitext,
        tweets,
        wikiSearchHits: wikiHitsForAi,
        ...(wikitempStyleExample
          ? { wikitempStyleExample }
          : {}),
        ...(preUploadedWikiFiles?.length
          ? { preUploadedWikiFiles }
          : {}),
        onProgress,
      },
      onAiStream || onProgress
        ? {
            ...(onAiStream
              ? {
                  onStreamDelta: (d: string) =>
                    onAiStream("compose_wikitext", d),
                  onReasoningStreamDelta: (d: string) =>
                    onAiStream("compose_wikitext_reasoning", d),
                }
              : {}),
            onTokenUsage: (u) =>
              onProgress?.(
                formatTokenUsageForProgressLine(u, "wikitext 編集")
              ),
          }
        : undefined
    );
  } catch (e) {
    wrapAiError("wikitext 編集", e);
  }

  const log: PipelineRunLog = {
    querySource,
    tweetQueryUsed,
    tweetQueriesUsed: queries,
    tweetSearchRangeLabel,
    tweetSearchRangeSource,
    wikiTarget: proposal.createNewArticle ? "new" : "existing",
    yahooCount: yahooHits.length,
    dbCount: dbHits.length,
    mergedTweetCount: tweets.length,
    cap,
    yahooError: yahooErr,
    dbError: dbErr,
    wikiSearchHitCount: wikiHitsForAi.length,
    wikiSearchError: wikiErr,
    aiStrategy: composed.strategyUsed,
    aiPatchCount: composed.patchCount,
    ...(composed.strategyUsed === "refuse"
      ? { aiNotesForHuman: composed.notesForHuman }
      : {}),
  };

  const summary = `[自動] ${composed.editSummary}`;

  const strategyLine =
    composed.strategyUsed === "refuse"
      ? "AI 編集: 見送り（refuse）"
      : composed.strategyUsed === "patch"
        ? `AI 編集: 部分（パッチ ${composed.patchCount} 件）`
        : "AI 編集: 全文";

  const humanNotesBlock =
    composed.strategyUsed === "refuse"
      ? ["【見送りの理由】", composed.notesForHuman].join("\n")
      : composed.notesForHuman;

  const next: Proposal = {
    ...proposal,
    updatedAt: new Date().toISOString(),
    lastRunSummary: [
      strategyLine,
      `クエリ: ${tweetQueryUsed}`,
      `ツイート検索の期間: ${tweetSearchRangeLabel ?? "（指定なし）"}（${tweetSearchRangeSource === "manual" ? "手動（proposal）" : "検索語 since:/until:"}）`,
      `DB: ${dbHits.length}件${dbErr ? ` (失敗: ${dbErr})` : ""}`,
      `Wiki 内検索: ${wikiHitsForAi.length}ページ（ユニーク・AI 参照用）${wikiErr ? ` (一部失敗: ${wikiErr})` : ""}`,
      `Yahoo: ${yahooHits.length}件${yahooErr ? ` (失敗: ${yahooErr})` : ""}`,
      `マージ後ツイート（合計上限 ${cap} 件まで・DB 優先のうえ群内ランダム順）: ${tweets.length}件`,
      "",
      humanNotesBlock,
    ].join("\n"),
    lastPreviewWikitext: composed.newWikitext,
    status: options.dryRun ? "preview_only" : "running",
    lastError: undefined,
  };

  if (options.dryRun) {
    onProgress?.("プレビューのみ（Wiki には反映していません）");
    return {
      proposal: next,
      tweetQueryUsed,
      tweetQueriesUsed: queries,
      tweetCount: tweets.length,
      applied: false,
      log,
    };
  }

  if (composed.strategyUsed === "refuse") {
    onProgress?.(
      "AI が編集を見送りました（Wiki は更新しません）。理由は進捗下の「見送りの理由」または完了メッセージを参照してください。"
    );
    return {
      proposal: {
        ...next,
        status: "done",
        updatedAt: new Date().toISOString(),
      },
      tweetQueryUsed,
      tweetQueriesUsed: queries,
      tweetCount: tweets.length,
      applied: false,
      log,
    };
  }

  const wikiUser = getEnv("WIKI_USERNAME");
  const wikiPass = getEnv("WIKI_PASSWORD");

  try {
    let jar: Map<string, string>;
    let csrfToken: string;
    if (attachmentWikiSession) {
      jar = attachmentWikiSession.jar;
      csrfToken = attachmentWikiSession.csrfToken;
    } else {
      onProgress?.("Wiki にログインしています…");
      const login = await mediaWikiLogin(apiUrl, wikiUser, wikiPass);
      jar = login.jar;
      csrfToken = login.csrfToken;
    }
    onProgress?.("pbs.twimg.com 画像をダウンロードして Wiki にアップロードしています…");
    const wikitextAfterUpload = await uploadPbsTwimgUrlsInWikitext(
      apiUrl,
      jar,
      csrfToken,
      composed.newWikitext,
      { onProgress }
    );
    onProgress?.(`「${proposal.wikiTitle}」を更新しています…`);
    await editWikiPage(
      apiUrl,
      jar,
      csrfToken,
      proposal.wikiTitle,
      wikitextAfterUpload,
      summary
    );
    onProgress?.("Wiki への反映が完了しました");
    return {
      proposal: {
        ...next,
        status: "done",
        updatedAt: new Date().toISOString(),
      },
      tweetQueryUsed,
      tweetQueriesUsed: queries,
      tweetCount: tweets.length,
      applied: true,
      log,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    onProgress?.(`Wiki への反映に失敗しました: ${msg}`);
    return {
      proposal: {
        ...next,
        status: "error",
        lastError: msg,
        updatedAt: new Date().toISOString(),
      },
      tweetQueryUsed,
      tweetQueriesUsed: queries,
      tweetCount: tweets.length,
      applied: false,
      log,
    };
  }
}
