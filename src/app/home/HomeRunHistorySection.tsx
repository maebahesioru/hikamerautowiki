"use client";

import { clearRunHistory } from "@/lib/runHistory";
import type { RunHistoryEntry } from "@/lib/runHistory";
import type { Dispatch, SetStateAction } from "react";

type Props = {
  runHistory: RunHistoryEntry[];
  setRunHistory: Dispatch<SetStateAction<RunHistoryEntry[]>>;
};

export function HomeRunHistorySection({ runHistory, setRunHistory }: Props) {
  return (
        <section
          className="mt-10 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40"
          aria-labelledby="run-history-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h2
              id="run-history-heading"
              className="text-lg font-medium text-zinc-900 dark:text-zinc-100"
            >
              実行履歴
            </h2>
            {runHistory.length > 0 ? (
              <button
                type="button"
                className="text-xs text-zinc-500 underline decoration-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    window.confirm("このブラウザに保存した実行履歴をすべて削除しますか？")
                  ) {
                    clearRunHistory();
                    setRunHistory([]);
                  }
                }}
              >
                履歴をすべて消去
              </button>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            編集反映・新規記事・ファクトチェック・リダイレクトが成功したときだけ記録します（このブラウザの
            localStorage に保存）。
          </p>
          {runHistory.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
              まだありません。
            </p>
          ) : (
            <ol className="mt-4 space-y-3 border-t border-zinc-100 pt-4 dark:border-zinc-800">
              {runHistory.map((h) => (
                <li
                  key={h.id}
                  className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-950/50"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <time dateTime={h.at}>
                      {new Date(h.at).toLocaleString("ja-JP", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </time>
                    <span
                      className={`rounded px-1.5 py-0.5 font-medium ${
                        h.kind === "edit"
                          ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                          : h.kind === "create"
                            ? "bg-teal-100 text-teal-950 dark:bg-teal-900/40 dark:text-teal-100"
                            : h.kind === "factcheck"
                              ? "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100"
                              : "bg-violet-100 text-violet-950 dark:bg-violet-900/40 dark:text-violet-100"
                      }`}
                    >
                      {h.kind === "edit"
                        ? "編集反映"
                        : h.kind === "create"
                          ? "新規記事"
                          : h.kind === "factcheck"
                            ? "ファクトチェック"
                            : "リダイレクト"}
                    </span>
                  </div>
                  <p className="mt-1.5 font-medium text-zinc-900 dark:text-zinc-100">
                    {h.pageLabel}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                    {h.summary}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </section>
  );
}
