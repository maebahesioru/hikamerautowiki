import type { MutableRefObject } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { PipelineRunLog } from "@/lib/types";
import { apiClientHeaders } from "@/lib/apiClientHeaders";
import {
  appendRunHistory,
  loadRunHistory,
  summarizeEditLog,
} from "@/lib/runHistory";
import { filesToAttachedImagesPayload } from "@/app/home/homeAttachment";
import { resolveNewArticleWikiTitle } from "@/app/home/homeWikiShare";
import { consumeRunSseStream } from "@/app/home/homeRunSse";
import { isAbortError } from "@/app/home/homeAbort";

export type RunEditPipelineDeps = {
  toolMode: "edit" | "create" | "factcheck" | "redirect";
  createSubjectKind: "person" | "other" | null;
  wikiTitle: string;
  instruction: string;
  attachedFiles: File[];
  setMessage: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setRunKind: Dispatch<SetStateAction<"edit" | "factcheck" | null>>;
  setShareSnapshot: Dispatch<SetStateAction<import("@/app/home/homeTypes").ShareSnapshot | null>>;
  setLastRunLog: Dispatch<SetStateAction<PipelineRunLog | null>>;
  setFactCheckReport: Dispatch<SetStateAction<import("@/lib/types").FactCheckReport | null>>;
  setFactCheckLog: Dispatch<SetStateAction<import("@/lib/types").FactCheckRunLog | null>>;
  setProgressLines: Dispatch<SetStateAction<string[]>>;
  setAiStreamChunks: Dispatch<SetStateAction<Record<string, string>>>;
  setWikiTitle: Dispatch<SetStateAction<string>>;
  setCreateSubjectKind: Dispatch<SetStateAction<"person" | "other" | null>>;
  setWikiSearchInput: Dispatch<SetStateAction<string>>;
  setWikiSearchResults: Dispatch<SetStateAction<import("@/app/home/homeTypes").WikiSearchHit[]>>;
  setWikiSearchError: Dispatch<SetStateAction<string | null>>;
  setInstruction: Dispatch<SetStateAction<string>>;
  setAttachedFiles: Dispatch<SetStateAction<File[]>>;
  setAttachmentInputKey: Dispatch<SetStateAction<number>>;
  setRunHistory: Dispatch<SetStateAction<import("@/lib/runHistory").RunHistoryEntry[]>>;
  runAbortRef: MutableRefObject<AbortController | null>;
};

export async function runEditPipelineFromForm(
  deps: RunEditPipelineDeps
): Promise<void> {
  const {
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
  } = deps;

const isCreate = toolMode === "create";
if (isCreate && createSubjectKind === null) {
  setMessage("記事の種類（人物 / 人物以外）を選んでください");
  return;
}
if (!wikiTitle.trim()) {
  setMessage(
    toolMode === "create"
      ? "新規記事のページ名を入力してください"
      : "ページを検索して、一覧から対象を選んでください"
  );
  return;
}
if (!isCreate && !instruction.trim()) {
  setMessage("指示（追記・修正の内容）を入力してください");
  return;
}
const effectiveWikiTitle =
  isCreate && createSubjectKind != null
    ? resolveNewArticleWikiTitle(wikiTitle, createSubjectKind)
    : wikiTitle.trim();
if (isCreate && !effectiveWikiTitle) {
  setMessage("有効なページ名を入力してください");
  return;
}

const ac = new AbortController();
runAbortRef.current = ac;
const signal = ac.signal;

setLoading(true);
setRunKind("edit");
setMessage(null);
setShareSnapshot(null);
setLastRunLog(null);
setFactCheckReport(null);
setFactCheckLog(null);
setProgressLines(["パイプラインを実行しています（サーバーから進捗を受信中）…"]);
setAiStreamChunks({});
try {
  let attachedPayload:
    | { name: string; dataBase64: string; mimeType: string }[]
    | undefined;
  if (toolMode === "edit" || toolMode === "create") {
    if (attachedFiles.length > 0) {
      try {
        attachedPayload = await filesToAttachedImagesPayload(attachedFiles);
      } catch (err) {
        setMessage(
          err instanceof Error ? err.message : String(err)
        );
        setLoading(false);
        return;
      }
    }
  }

  const runPayloadBase: Record<string, unknown> = {
    wikiTitle: effectiveWikiTitle,
    instruction: instruction.trim(),
    dryRun: false,
    stream: true,
    ...(isCreate ? { createNew: true } : {}),
    ...(attachedPayload ? { attachedImages: attachedPayload } : {}),
  };

  const runR = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...apiClientHeaders() },
    body: JSON.stringify(runPayloadBase),
    signal,
  });

  if (!runR.ok) {
    const errText = await runR.text();
    let detail = "サーバーがエラーを返しました";
    if (errText.trim()) {
      try {
        const errJson = JSON.parse(errText) as {
          error?: unknown;
          missingEnv?: string[];
        };
        if (typeof errJson.error === "string") detail = errJson.error;
        else if (errJson.error != null) detail = JSON.stringify(errJson.error);
        if (Array.isArray(errJson.missingEnv) && errJson.missingEnv.length > 0) {
          detail += `（未設定: ${errJson.missingEnv.join(", ")}）`;
        }
      } catch {
        detail = errText.slice(0, 500);
      }
    }
    setMessage(`エラーが発生しました: ${detail}`);
    return;
  }

  const reader = runR.body?.getReader();
  if (!reader) {
    setProgressLines([]);
    setMessage("ストリームを読み取れませんでした");
    return;
  }

  const runData = await consumeRunSseStream(
    reader,
    (msg) => {
      setProgressLines((prev) => [...prev, msg]);
    },
    (phase, delta) => {
      setAiStreamChunks((prev) => ({
        ...prev,
        [phase]: (prev[phase] ?? "") + delta,
      }));
    }
  );

  if (!runData.ok) {
    setMessage(
      runData.error
        ? `エラーが発生しました: ${runData.error}`
        : "実行に失敗しました（エラー内容を取得できませんでした）"
    );
    return;
  }
  if (runData.log) {
    setLastRunLog(runData.log);
  }
  setFactCheckLog(null);
  setFactCheckReport(null);
  if (runData.applied === true) {
    const appliedTitle = isCreate ? effectiveWikiTitle : wikiTitle.trim();
    const logSummary = summarizeEditLog(runData.log as PipelineRunLog);
    if (isCreate) {
      setShareSnapshot({ kind: "create", wikiTitle: appliedTitle });
      appendRunHistory({
        kind: "create",
        pageLabel: appliedTitle,
        summary: `新規記事: ${logSummary}`,
      });
    } else {
      setShareSnapshot({ kind: "edit", wikiTitle: appliedTitle });
      appendRunHistory({
        kind: "edit",
        pageLabel: appliedTitle,
        summary: logSummary,
      });
    }
    setRunHistory(loadRunHistory());
  }
  setMessage(
    runData.applied === true
      ? "Wiki に反映しました"
      : runData.log?.aiStrategy === "refuse"
        ? [
            "AI が編集を見送りました。Wiki は更新していません。",
            "",
            "【見送りの理由】",
            runData.log.aiNotesForHuman?.trim() ||
              "（理由テキストがありません。直近の実行ログを参照してください。）",
          ].join("\n")
        : runData.proposal?.lastError
          ? `エラーが発生しました: ${runData.proposal.lastError}`
          : "反映はスキップされました（エラー内容を確認）"
  );
  setWikiTitle("");
  setCreateSubjectKind(null);
  setWikiSearchInput("");
  setWikiSearchResults([]);
  setWikiSearchError(null);
  setInstruction("");
  setAttachedFiles([]);
  setAttachmentInputKey((k) => k + 1);
} catch (e) {
  if (isAbortError(e)) {
    setMessage("実行をキャンセルしました");
    setProgressLines((prev) => [...prev, "（キャンセルしました）"]);
    return;
  }
  setMessage(
    e instanceof Error
      ? `エラーが発生しました: ${e.message}`
      : "通信エラーが発生しました"
  );
} finally {
  runAbortRef.current = null;
  setLoading(false);
  setRunKind(null);
}
}
