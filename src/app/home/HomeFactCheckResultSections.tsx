"use client";

import type { FactCheckReport, FactCheckRunLog } from "@/lib/types";

type Props = {
  toolMode: "edit" | "create" | "factcheck" | "redirect";
  factCheckReport: FactCheckReport | null;
  factCheckLog: FactCheckRunLog | null;
};

export function HomeFactCheckResultSections({
  toolMode,
  factCheckReport,
  factCheckLog,
}: Props) {
  return (
    <>
          {toolMode === "factcheck" && factCheckReport ? (
            <section
              className="mt-8 rounded-2xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20"
              aria-labelledby="factcheck-heading"
            >
              <h2
                id="factcheck-heading"
                className="text-lg font-medium text-amber-950 dark:text-amber-100"
              >
                ファクトチェック結果
              </h2>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-zinc-800 dark:text-zinc-200">
                {factCheckReport.summary}
              </p>
              {factCheckReport.items.length > 0 ? (
                <ul className="mt-4 space-y-4">
                  {factCheckReport.items.map((it, idx) => (
                    <li
                      key={`${idx}-${it.claim.slice(0, 40)}`}
                      className="rounded-lg border border-amber-200/80 bg-white px-4 py-3 text-sm dark:border-amber-900/50 dark:bg-zinc-900/60"
                    >
                      <p className="font-medium text-zinc-900 dark:text-zinc-100">
                        {it.claim}
                      </p>
                      <p className="mt-1">
                        <span
                          className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                            it.verdict === "supported"
                              ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                              : it.verdict === "weak"
                                ? "bg-amber-100 text-amber-950 dark:bg-amber-900/40 dark:text-amber-100"
                                : it.verdict === "contradicted"
                                  ? "bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100"
                                  : "bg-zinc-200 text-zinc-800 dark:bg-zinc-700 dark:text-zinc-100"
                          }`}
                        >
                          {it.verdict}
                        </span>
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                        {it.notes}
                      </p>
                      {it.sources && it.sources.length > 0 ? (
                        <p className="mt-2 font-mono text-xs text-zinc-600 dark:text-zinc-400">
                          {it.sources.join(" · ")}
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                  （items が空です）
                </p>
              )}
            </section>
          ) : null}
      
          {toolMode === "factcheck" && factCheckLog ? (
            <section
              className="mt-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40"
              aria-labelledby="factcheck-log-heading"
            >
              <h2
                id="factcheck-log-heading"
                className="text-lg font-medium text-zinc-900 dark:text-zinc-100"
              >
                ファクトチェックの参照ログ
              </h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                    使用したクエリ
                  </dt>
                  <dd className="min-w-0 text-zinc-900 dark:text-zinc-100">
                    {factCheckLog.tweetQueriesUsed?.length ? (
                      <ul className="list-disc space-y-1 pl-5 font-mono text-xs sm:text-sm">
                        {factCheckLog.tweetQueriesUsed.map((q) => (
                          <li key={q} className="break-all">
                            {q}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="break-all font-mono text-xs sm:text-sm">
                        {factCheckLog.tweetQueryUsed || "（空）"}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                    AI に渡したツイート
                  </dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">
                    {factCheckLog.mergedTweetCount} 件（上限 {factCheckLog.cap} 件）
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                    Wiki 内検索（関連ページ）
                  </dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">
                    {factCheckLog.wikiSearchHitCount != null
                      ? `${factCheckLog.wikiSearchHitCount} ページ`
                      : "—"}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
                  <dt className="shrink-0 font-medium text-zinc-600 dark:text-zinc-400">
                    Yahoo!ウェブ検索
                  </dt>
                  <dd className="text-zinc-900 dark:text-zinc-100">
                    {factCheckLog.yahooWebSearchHitCount != null
                      ? `${factCheckLog.yahooWebSearchHitCount} 件`
                      : "—"}
                    {factCheckLog.yahooWebSearchError ? (
                      <span className="ml-2 text-amber-800 dark:text-amber-200">
                        （取得エラー: {factCheckLog.yahooWebSearchError}）
                      </span>
                    ) : null}
                  </dd>
                </div>
              </dl>
            </section>
          ) : null}
    </>
  );
}
