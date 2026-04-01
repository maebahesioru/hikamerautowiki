import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  FactCheckReport,
  FactCheckRunLog,
  PipelineRunLog,
} from "@/lib/types";
import type { WikiOutlineSection } from "@/lib/wikitextSections";
import { apiClientHeaders } from "@/lib/apiClientHeaders";
import { appendRunHistory, loadRunHistory, truncateSummary } from "@/lib/runHistory";
import { isAbortError } from "@/app/home/homeAbort";
import { consumeRunSseStream } from "@/app/home/homeRunSse";

export type RunFactCheckFromFormDeps = {
  wikiTitle: string;
  instruction: string;
  factCheckSectionIndex: number | null;
  factCheckOutline: WikiOutlineSection[] | null;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setRunKind: Dispatch<SetStateAction<"edit" | "factcheck" | null>>;
  setShareSnapshot: Dispatch<
    SetStateAction<
      import("@/app/home/homeTypes").ShareSnapshot | null
    >
  >;
  setLastRunLog: Dispatch<SetStateAction<PipelineRunLog | null>>;
  setFactCheckReport: Dispatch<SetStateAction<FactCheckReport | null>>;
  setFactCheckLog: Dispatch<SetStateAction<FactCheckRunLog | null>>;
  setProgressLines: Dispatch<SetStateAction<string[]>>;
  setAiStreamChunks: Dispatch<SetStateAction<Record<string, string>>>;
  setRunHistory: Dispatch<
    SetStateAction<import("@/lib/runHistory").RunHistoryEntry[]>
  >;
  runAbortRef: MutableRefObject<AbortController | null>;
};

export async function runFactCheckFromForm(
  deps: RunFactCheckFromFormDeps
): Promise<void> {
  const {
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
  } = deps;

  if (!wikiTitle.trim()) {
    setMessage("ページを検索して、一覧から対象を選んでください");
    return;
  }
  let focusWikitext: string | undefined;
  if (
    factCheckSectionIndex !== null &&
    factCheckOutline &&
    factCheckOutline[factCheckSectionIndex]
  ) {
    focusWikitext = factCheckOutline[factCheckSectionIndex].wikitext;
  }

  const ac = new AbortController();
  runAbortRef.current = ac;
  const signal = ac.signal;

  setLoading(true);
  setRunKind("factcheck");
  setMessage(null);
  setShareSnapshot(null);
  setLastRunLog(null);
  setFactCheckReport(null);
  setFactCheckLog(null);
  setProgressLines(["ファクトチェックを実行しています（サーバーから進捗を受信中）…"]);
  setAiStreamChunks({});

  try {
    const runR = await fetch("/api/fact-check", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiClientHeaders() },
      body: JSON.stringify({
        wikiTitle,
        instruction: instruction.trim() || "（指示なし）",
        stream: true,
        focusWikitext,
      }),
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
          : "ファクトチェックに失敗しました"
      );
      return;
    }
    if (runData.log) {
      setFactCheckLog(runData.log as FactCheckRunLog);
    }
    if (runData.report) {
      setFactCheckReport(runData.report);
    }
    setLastRunLog(null);
    const fcTitle = wikiTitle.trim();
    setShareSnapshot({ kind: "factcheck", wikiTitle: fcTitle });
    appendRunHistory({
      kind: "factcheck",
      pageLabel: fcTitle,
      summary: truncateSummary(
        runData.report?.summary?.trim() || "ファクトチェック完了（Wiki は未更新）"
      ),
    });
    setRunHistory(loadRunHistory());
    setMessage(
      "ファクトチェックが完了しました（Wiki は更新していません）。下に結果を表示します。"
    );
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
