"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {
  FactCheckReport,
  FactCheckRunLog,
  PipelineRunLog,
} from "@/lib/types";
import type { WikiOutlineSection } from "@/lib/wikitextSections";
import { loadRunHistory, type RunHistoryEntry } from "@/lib/runHistory";
import type { WikiSearchHit } from "@/app/home/homeTypes";
import type { ShareSnapshot } from "@/app/home/homeTypes";
import { buildXShareText } from "@/app/home/homeWikiShare";
import { runEditPipelineFromForm } from "@/app/home/runEditPipeline";
import { runFactCheckFromForm } from "@/app/home/runFactCheckFromForm";
import {
  runRedirectWikiSearchAction,
  runWikiSearchAction,
  submitWikiRedirectAction,
} from "@/app/home/homeWikiActions";
import { useFactCheckOutline } from "@/app/home/useFactCheckOutline";
import { HomePageHeader } from "@/app/home/HomePageHeader";
import { HomeMessageAndShare } from "@/app/home/HomeMessageAndShare";
import { HomeNewProposalSection } from "@/app/home/HomeNewProposalSection";
import { HomeEditRunLogSection } from "@/app/home/HomeEditRunLogSection";
import { HomeFactCheckResultSections } from "@/app/home/HomeFactCheckResultSections";
import { HomeRunHistorySection } from "@/app/home/HomeRunHistorySection";
import { HomeDevTodoSection } from "@/app/home/HomeDevTodoSection";

export default function Home() {
  const [wikiTitle, setWikiTitle] = useState("");
  /** 新規記事のみ: 人物は `ヒカマーwiki:チラシの裏/` 付与 */
  const [createSubjectKind, setCreateSubjectKind] = useState<
    "person" | "other" | null
  >(null);
  const [wikiSearchInput, setWikiSearchInput] = useState("");
  const [wikiSearchResults, setWikiSearchResults] = useState<WikiSearchHit[]>([]);
  const [wikiSearchLoading, setWikiSearchLoading] = useState(false);
  const [wikiSearchError, setWikiSearchError] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastRunLog, setLastRunLog] = useState<PipelineRunLog | null>(null);
  /** ファクトチェックのみ実行時の結果（Wiki 反映とは別） */
  const [factCheckReport, setFactCheckReport] = useState<FactCheckReport | null>(
    null
  );
  const [factCheckLog, setFactCheckLog] = useState<FactCheckRunLog | null>(null);
  /** 記事編集 / ファクトチェック / リダイレクト（AI なし） */
  const [toolMode, setToolMode] = useState<
    "edit" | "create" | "factcheck" | "redirect"
  >("edit");
  /** リダイレクト: 移動元ページ名（手入力） */
  const [redirectSourceTitle, setRedirectSourceTitle] = useState("");
  const [redirectSearchInput, setRedirectSearchInput] = useState("");
  const [redirectSearchResults, setRedirectSearchResults] = useState<
    WikiSearchHit[]
  >([]);
  const [redirectSearchLoading, setRedirectSearchLoading] = useState(false);
  const [redirectSearchError, setRedirectSearchError] = useState<string | null>(
    null
  );
  /** リダイレクト: 移動先（検索で選んだページ名） */
  const [redirectTargetTitle, setRedirectTargetTitle] = useState("");
  /** 実行中パイプライン種別（ストリーム表示の切り分け） */
  const [runKind, setRunKind] = useState<"edit" | "factcheck" | null>(null);
  /** null = 未読込。配列は API 取得済み（空なら見出しなし） */
  const [factCheckOutline, setFactCheckOutline] = useState<
    WikiOutlineSection[] | null
  >(null);
  const [factCheckOutlineLoading, setFactCheckOutlineLoading] = useState(false);
  const [factCheckOutlineError, setFactCheckOutlineError] = useState<
    string | null
  >(null);
  /** null = ページ全文。数値 = outline のインデックス */
  const [factCheckSectionIndex, setFactCheckSectionIndex] = useState<
    number | null
  >(null);
  const [progressLines, setProgressLines] = useState<string[]>([]);
  /** suggest_queries / compose_wikitext のトークン表示 */
  const [aiStreamChunks, setAiStreamChunks] = useState<Record<string, string>>(
    {}
  );
  /** パイプライン実行の fetch を中断 */
  const runAbortRef = useRef<AbortController | null>(null);
  /** ストリーミング中「停止」へフォーカス（キーボード操作） */
  const stopRunButtonRef = useRef<HTMLButtonElement>(null);
  const prevLoadingForFocusRef = useRef(false);
  /** 編集 / ファクトチェック / リダイレクトが成功した直後のみ（X 共有ボタン用） */
  const [shareSnapshot, setShareSnapshot] = useState<ShareSnapshot | null>(
    null
  );
  /** X 共有文のコピー結果メッセージ */
  const [shareCopyHint, setShareCopyHint] = useState<string | null>(null);
  /** localStorage の実行成功履歴 */
  const [runHistory, setRunHistory] = useState<RunHistoryEntry[]>([]);
  /** 記事編集・新規: Wiki へアップロードする添付画像 */
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachmentInputKey, setAttachmentInputKey] = useState(0);

  useFactCheckOutline({
    toolMode,
    wikiTitle,
    setFactCheckOutline,
    setFactCheckOutlineLoading,
    setFactCheckOutlineError,
    setFactCheckSectionIndex,
  });

  useEffect(() => {
    setRunHistory(loadRunHistory());
  }, []);

  useEffect(() => {
    if (toolMode !== "edit" && toolMode !== "create") {
      setAttachedFiles([]);
      setAttachmentInputKey((k) => k + 1);
    }
  }, [toolMode]);

  useEffect(() => {
    if (!loading) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [loading]);

  /** 実行開始時に「停止」へフォーカス（スクリーンリーダー・キーボード） */
  useEffect(() => {
    if (
      loading &&
      !prevLoadingForFocusRef.current &&
      (toolMode === "edit" ||
        toolMode === "create" ||
        toolMode === "factcheck")
    ) {
      queueMicrotask(() => stopRunButtonRef.current?.focus());
    }
    prevLoadingForFocusRef.current = loading;
  }, [loading, toolMode]);

  /** ファクトチェック以外に切り替えたとき目次状態を捨てる */
  useEffect(() => {
    if (toolMode !== "factcheck") {
      setFactCheckOutline(null);
      setFactCheckOutlineError(null);
      setFactCheckSectionIndex(null);
    }
  }, [toolMode]);

  const hasAnyAiStreamChunk = useMemo(
    () =>
      Boolean(
        aiStreamChunks.suggest_queries_reasoning ||
          aiStreamChunks.suggest_queries ||
          (runKind === "edit" &&
            (aiStreamChunks.compose_wikitext_reasoning ||
              aiStreamChunks.compose_wikitext)) ||
          (runKind === "factcheck" &&
            (aiStreamChunks.fact_check_reasoning || aiStreamChunks.fact_check))
      ),
    [aiStreamChunks, runKind]
  );

  /** 進捗に AI フェーズが出たあとでも、まだトークンが 1 つも届いていないときパネルを出す */
  const streamPhaseLikely = useMemo(
    () =>
      loading &&
      (toolMode === "edit" ||
        toolMode === "create" ||
        toolMode === "factcheck") &&
      progressLines.some((l) =>
        /AI が wikitext|検索クエリを生成|ファクトチェックを実行/.test(l)
      ),
    [loading, toolMode, progressLines]
  );

  const showAiStreamPanel = hasAnyAiStreamChunk || streamPhaseLikely;

  function stopRun() {
    runAbortRef.current?.abort();
  }

  async function copyShareTextToClipboard() {
    if (!shareSnapshot) return;
    const text = buildXShareText(shareSnapshot);
    try {
      await navigator.clipboard.writeText(text);
      setShareCopyHint("コピーしました");
      window.setTimeout(() => setShareCopyHint(null), 2500);
    } catch {
      setShareCopyHint(
        "コピーできませんでした（ブラウザのクリップボード許可を確認してください）"
      );
      window.setTimeout(() => setShareCopyHint(null), 4000);
    }
  }

  async function runFromForm() {
    await runEditPipelineFromForm({
      toolMode,
      createSubjectKind,
      wikiTitle,
      instruction,
      attachedFiles,
      setMessage,
      setLoading,
      setRunKind,
      setShareSnapshot,
      setLastRunLog,
      setFactCheckReport,
      setFactCheckLog,
      setProgressLines,
      setAiStreamChunks,
      setWikiTitle,
      setCreateSubjectKind,
      setWikiSearchInput,
      setWikiSearchResults,
      setWikiSearchError,
      setInstruction,
      setAttachedFiles,
      setAttachmentInputKey,
      setRunHistory,
      runAbortRef,
    });
  }

  async function runFactCheckFromFormHandler() {
    await runFactCheckFromForm({
      wikiTitle,
      instruction,
      factCheckSectionIndex,
      factCheckOutline,
      setMessage,
      setLoading,
      setRunKind,
      setShareSnapshot,
      setLastRunLog,
      setFactCheckReport,
      setFactCheckLog,
      setProgressLines,
      setAiStreamChunks,
      setRunHistory,
      runAbortRef,
    });
  }

  function runWikiSearch(e?: FormEvent) {
    void runWikiSearchAction({
      wikiSearchInput,
      setWikiSearchLoading,
      setWikiSearchError,
      setWikiSearchResults,
      e,
    });
  }

  function runRedirectWikiSearch(e?: FormEvent) {
    void runRedirectWikiSearchAction({
      redirectSearchInput,
      setRedirectSearchLoading,
      setRedirectSearchError,
      setRedirectSearchResults,
      e,
    });
  }

  function submitRedirect() {
    void submitWikiRedirectAction({
      redirectSourceTitle,
      redirectTargetTitle,
      setLoading,
      setMessage,
      setShareSnapshot,
      setRunHistory,
    });
  }

  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <HomePageHeader />
        <HomeMessageAndShare
          message={message}
          shareSnapshot={shareSnapshot}
          shareCopyHint={shareCopyHint}
          onCopyShareText={copyShareTextToClipboard}
          onCloseShare={() => {
            setShareSnapshot(null);
            setShareCopyHint(null);
          }}
        />
        <HomeNewProposalSection
          toolMode={toolMode}
          setToolMode={setToolMode}
          wikiTitle={wikiTitle}
          setWikiTitle={setWikiTitle}
          createSubjectKind={createSubjectKind}
          setCreateSubjectKind={setCreateSubjectKind}
          wikiSearchInput={wikiSearchInput}
          setWikiSearchInput={setWikiSearchInput}
          wikiSearchResults={wikiSearchResults}
          setWikiSearchResults={setWikiSearchResults}
          wikiSearchLoading={wikiSearchLoading}
          wikiSearchError={wikiSearchError}
          setWikiSearchError={setWikiSearchError}
          redirectSourceTitle={redirectSourceTitle}
          setRedirectSourceTitle={setRedirectSourceTitle}
          redirectSearchInput={redirectSearchInput}
          setRedirectSearchInput={setRedirectSearchInput}
          redirectSearchResults={redirectSearchResults}
          setRedirectSearchResults={setRedirectSearchResults}
          redirectSearchLoading={redirectSearchLoading}
          redirectSearchError={redirectSearchError}
          setRedirectSearchError={setRedirectSearchError}
          redirectTargetTitle={redirectTargetTitle}
          setRedirectTargetTitle={setRedirectTargetTitle}
          runWikiSearch={runWikiSearch}
          runRedirectWikiSearch={runRedirectWikiSearch}
          instruction={instruction}
          setInstruction={setInstruction}
          factCheckOutlineLoading={factCheckOutlineLoading}
          factCheckOutlineError={factCheckOutlineError}
          factCheckOutline={factCheckOutline}
          factCheckSectionIndex={factCheckSectionIndex}
          setFactCheckSectionIndex={setFactCheckSectionIndex}
          attachedFiles={attachedFiles}
          attachmentInputKey={attachmentInputKey}
          setAttachedFiles={setAttachedFiles}
          setAttachmentInputKey={setAttachmentInputKey}
          loading={loading}
          runFromForm={runFromForm}
          runFactCheckFromForm={runFactCheckFromFormHandler}
          submitRedirect={submitRedirect}
          stopRun={stopRun}
          stopRunButtonRef={stopRunButtonRef}
          progressLines={progressLines}
          showAiStreamPanel={showAiStreamPanel}
          streamPhaseLikely={streamPhaseLikely}
          hasAnyAiStreamChunk={hasAnyAiStreamChunk}
          aiStreamChunks={aiStreamChunks}
          runKind={runKind}
        />
        <HomeEditRunLogSection toolMode={toolMode} lastRunLog={lastRunLog} />
        <HomeFactCheckResultSections
          toolMode={toolMode}
          factCheckReport={factCheckReport}
          factCheckLog={factCheckLog}
        />
        <HomeRunHistorySection
          runHistory={runHistory}
          setRunHistory={setRunHistory}
        />
        <HomeDevTodoSection />
      </div>
    </div>
  );
}
