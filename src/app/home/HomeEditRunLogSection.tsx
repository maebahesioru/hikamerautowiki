"use client";

import type { PipelineRunLog } from "@/lib/types";

type Props = {
  toolMode: "edit" | "create" | "factcheck" | "redirect";
  lastRunLog: PipelineRunLog | null;
};

export function HomeEditRunLogSection({ toolMode, lastRunLog }: Props) {
  if (toolMode !== "edit" && toolMode !== "create") return null;
  if (!lastRunLog) return null;
  return (
          <section
            className="mt-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40"
            aria-labelledby="run-log-heading"
          >
            <h2
              id="run-log-heading"
              className="text-lg font-medium text-zinc-900 dark:text-zinc-100"
            >
              直近の実行ログ
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                  検索クエリの出所
                </dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {lastRunLog.querySource === "user"
                    ? "フォームで入力"
                    : "AI が指示から推測"}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                  使用したクエリ
                </dt>
                <dd className="min-w-0 text-zinc-900 dark:text-zinc-100">
                  {lastRunLog.tweetQueriesUsed &&
                  lastRunLog.tweetQueriesUsed.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5 font-mono text-xs sm:text-sm">
                      {lastRunLog.tweetQueriesUsed.map((q) => (
                        <li key={q} className="break-all">
                          {q}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="break-all font-mono text-xs sm:text-sm">
                      {lastRunLog.tweetQueryUsed || "（空）"}
                    </span>
                  )}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                  ツイート検索の期間
                </dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {lastRunLog.tweetSearchRangeLabel ?? "（指定なし）"}
                  {lastRunLog.tweetSearchRangeSource ? (
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                      （
                      {lastRunLog.tweetSearchRangeSource === "manual"
                        ? "手動（proposal）"
                        : "検索語 since:/until:"}
                      ）
                    </span>
                  ) : null}
                </dd>
              </div>
              {lastRunLog.wikiTarget ? (
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                    編集対象
                  </dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">
                    {lastRunLog.wikiTarget === "new"
                      ? "新規（空ページまたは未作成）"
                      : "既存ページ"}
                  </dd>
                </div>
              ) : null}
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                  ローカル DB
                </dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {lastRunLog.dbCount} 件
                  {lastRunLog.dbError ? (
                    <span className="ml-2 text-amber-800 dark:text-amber-200">
                      （取得エラー: {lastRunLog.dbError}）
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                  Wiki 内検索（関連ページ）
                </dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {lastRunLog.wikiSearchHitCount != null
                    ? `${lastRunLog.wikiSearchHitCount} ページ（スニペット）`
                    : "—"}
                  {lastRunLog.wikiSearchError ? (
                    <span className="ml-2 text-amber-800 dark:text-amber-200">
                      （取得エラー: {lastRunLog.wikiSearchError}）
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                  Yahoo リアルタイム
                </dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {lastRunLog.yahooCount} 件
                  {lastRunLog.yahooError ? (
                    <span className="ml-2 text-amber-800 dark:text-amber-200">
                      （取得エラー: {lastRunLog.yahooError}）
                    </span>
                  ) : null}
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                  AI に渡したツイート
                </dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {lastRunLog.mergedTweetCount} 件（上限 {lastRunLog.cap} 件）
                </dd>
              </div>
              <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                  AI 編集モード
                </dt>
                <dd className="text-zinc-900 dark:text-zinc-100">
                  {lastRunLog.aiStrategy === "refuse"
                    ? "見送り（refuse）"
                    : lastRunLog.aiStrategy === "patch"
                      ? `部分パッチ（${lastRunLog.aiPatchCount} 箇所）`
                      : "全文生成"}
                </dd>
              </div>
              {lastRunLog.aiStrategy === "refuse" &&
              lastRunLog.aiNotesForHuman ? (
                <div className="flex flex-col gap-1 sm:flex-row sm:gap-3">
                  <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400 sm:pt-0.5">
                    見送りの理由
                  </dt>
                  <dd className="min-w-0 whitespace-pre-wrap text-sm leading-relaxed text-zinc-900 dark:text-zinc-100">
                    {lastRunLog.aiNotesForHuman}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
  );
}
