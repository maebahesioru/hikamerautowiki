"use client";

import type { FormEvent, RefObject } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { WikiOutlineSection } from "@/lib/wikitextSections";
import {
  MAX_INLINE_ATTACHMENTS,
  MAX_INLINE_IMAGE_BYTES,
} from "@/lib/inlineAttachmentLimits";
import { resolveNewArticleWikiTitle } from "@/app/home/homeWikiShare";
import type { WikiSearchHit } from "@/app/home/homeTypes";

export type HomeNewProposalSectionProps = {
  toolMode: "edit" | "create" | "factcheck" | "redirect";
  setToolMode: Dispatch<
    SetStateAction<"edit" | "create" | "factcheck" | "redirect">
  >;
  wikiTitle: string;
  setWikiTitle: Dispatch<SetStateAction<string>>;
  createSubjectKind: "person" | "other" | null;
  setCreateSubjectKind: Dispatch<
    SetStateAction<"person" | "other" | null>
  >;
  wikiSearchInput: string;
  setWikiSearchInput: Dispatch<SetStateAction<string>>;
  wikiSearchResults: WikiSearchHit[];
  setWikiSearchResults: Dispatch<SetStateAction<WikiSearchHit[]>>;
  wikiSearchLoading: boolean;
  wikiSearchError: string | null;
  setWikiSearchError: Dispatch<SetStateAction<string | null>>;
  redirectSourceTitle: string;
  setRedirectSourceTitle: Dispatch<SetStateAction<string>>;
  redirectSearchInput: string;
  setRedirectSearchInput: Dispatch<SetStateAction<string>>;
  redirectSearchResults: WikiSearchHit[];
  setRedirectSearchResults: Dispatch<SetStateAction<WikiSearchHit[]>>;
  redirectSearchLoading: boolean;
  redirectSearchError: string | null;
  setRedirectSearchError: Dispatch<SetStateAction<string | null>>;
  redirectTargetTitle: string;
  setRedirectTargetTitle: Dispatch<SetStateAction<string>>;
  runWikiSearch: (e?: FormEvent) => void;
  runRedirectWikiSearch: (e?: FormEvent) => void;
  instruction: string;
  setInstruction: Dispatch<SetStateAction<string>>;
  factCheckOutlineLoading: boolean;
  factCheckOutlineError: string | null;
  factCheckOutline: WikiOutlineSection[] | null;
  factCheckSectionIndex: number | null;
  setFactCheckSectionIndex: Dispatch<SetStateAction<number | null>>;
  attachedFiles: File[];
  attachmentInputKey: number;
  setAttachedFiles: Dispatch<SetStateAction<File[]>>;
  setAttachmentInputKey: Dispatch<SetStateAction<number>>;
  loading: boolean;
  runFromForm: () => void | Promise<void>;
  runFactCheckFromForm: () => void | Promise<void>;
  submitRedirect: () => void | Promise<void>;
  stopRun: () => void;
  stopRunButtonRef: RefObject<HTMLButtonElement | null>;
  progressLines: string[];
  showAiStreamPanel: boolean;
  streamPhaseLikely: boolean;
  hasAnyAiStreamChunk: boolean;
  aiStreamChunks: Record<string, string>;
  runKind: "edit" | "factcheck" | null;
};

export function HomeNewProposalSection(props: HomeNewProposalSectionProps) {
  const {
    toolMode,
    setToolMode,
    wikiTitle,
    setWikiTitle,
    createSubjectKind,
    setCreateSubjectKind,
    wikiSearchInput,
    setWikiSearchInput,
    wikiSearchResults,
    setWikiSearchResults,
    wikiSearchLoading,
    wikiSearchError,
    setWikiSearchError,
    redirectSourceTitle,
    setRedirectSourceTitle,
    redirectSearchInput,
    setRedirectSearchInput,
    redirectSearchResults,
    setRedirectSearchResults,
    redirectSearchLoading,
    redirectSearchError,
    setRedirectSearchError,
    redirectTargetTitle,
    setRedirectTargetTitle,
    runWikiSearch,
    runRedirectWikiSearch,
    instruction,
    setInstruction,
    factCheckOutlineLoading,
    factCheckOutlineError,
    factCheckOutline,
    factCheckSectionIndex,
    setFactCheckSectionIndex,
    attachedFiles,
    attachmentInputKey,
    setAttachedFiles,
    setAttachmentInputKey,
    loading,
    runFromForm,
    runFactCheckFromForm,
    submitRedirect,
    stopRun,
    stopRunButtonRef,
    progressLines,
    showAiStreamPanel,
    streamPhaseLikely,
    hasAnyAiStreamChunk,
    aiStreamChunks,
    runKind,
  } = props;
  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40">
      <h2 className="text-lg font-medium">新しい提案</h2>
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (toolMode === "edit" || toolMode === "create") {
            void runFromForm();
          }
        }}
      >
        <div
          className="grid grid-cols-2 gap-1.5 rounded-xl border border-zinc-200 p-1.5 dark:border-zinc-700 sm:grid-cols-4 sm:gap-1 sm:p-1"
          role="tablist"
          aria-label="作業モード"
        >
          <button
            type="button"
            role="tab"
            aria-selected={toolMode === "edit"}
            className={`flex min-h-11 w-full min-w-0 touch-manipulation items-center justify-center rounded-lg px-1.5 py-2 text-center text-[13px] font-medium leading-snug transition [-webkit-tap-highlight-color:transparent] sm:min-h-10 sm:px-3 sm:text-sm ${
              toolMode === "edit"
                ? "bg-emerald-600 text-white shadow-sm dark:bg-emerald-600"
                : "text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            }`}
            onClick={() => setToolMode("edit")}
          >
            記事を編集
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={toolMode === "create"}
            className={`flex min-h-11 w-full min-w-0 touch-manipulation items-center justify-center rounded-lg px-1.5 py-2 text-center text-[13px] font-medium leading-snug transition [-webkit-tap-highlight-color:transparent] sm:min-h-10 sm:px-3 sm:text-sm ${
              toolMode === "create"
                ? "bg-teal-600 text-white shadow-sm dark:bg-teal-600"
                : "text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            }`}
            onClick={() => {
              setToolMode("create");
              setWikiTitle("");
              setCreateSubjectKind(null);
              setWikiSearchInput("");
              setWikiSearchResults([]);
              setWikiSearchError(null);
            }}
          >
            新規記事
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={toolMode === "factcheck"}
            className={`flex min-h-11 w-full min-w-0 touch-manipulation items-center justify-center rounded-lg px-1.5 py-2 text-center text-[13px] font-medium leading-snug transition [-webkit-tap-highlight-color:transparent] sm:min-h-10 sm:px-3 sm:text-sm ${
              toolMode === "factcheck"
                ? "bg-amber-600 text-white shadow-sm dark:bg-amber-600"
                : "text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            }`}
            onClick={() => setToolMode("factcheck")}
          >
            ファクトチェック
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={toolMode === "redirect"}
            className={`flex min-h-11 w-full min-w-0 touch-manipulation items-center justify-center rounded-lg px-1.5 py-2 text-center text-[13px] font-medium leading-snug transition [-webkit-tap-highlight-color:transparent] sm:min-h-10 sm:px-3 sm:text-sm ${
              toolMode === "redirect"
                ? "bg-violet-600 text-white shadow-sm dark:bg-violet-600"
                : "text-zinc-600 hover:bg-zinc-100 active:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:active:bg-zinc-700"
            }`}
            onClick={() => setToolMode("redirect")}
          >
            リダイレクト
          </button>
        </div>

        {toolMode === "redirect" ? (
          <div className="space-y-4 rounded-xl border border-violet-200/90 bg-violet-50/35 p-4 dark:border-violet-900/50 dark:bg-violet-950/20">
            <div>
              <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                移動元（リダイレクトを置くページ名・手入力）
              </label>
              <input
                type="text"
                autoComplete="off"
                name="redirect-source-title"
                className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm outline-none ring-violet-500/30 focus:ring-2 dark:border-violet-800 dark:bg-zinc-950"
                placeholder="例: 旧ページ名（まだ無い名前でも新規作成されます）"
                value={redirectSourceTitle}
                onChange={(e) => setRedirectSourceTitle(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                移動先（キーワードで検索し、一覧から選択）
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  type="text"
                  inputMode="search"
                  autoComplete="off"
                  name="redirect-target-keyword"
                  className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm outline-none ring-violet-500/30 focus:ring-2 dark:border-violet-800 dark:bg-zinc-950"
                  placeholder="飛ばし先の記事を探す"
                  value={redirectSearchInput}
                  onChange={(e) => setRedirectSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void runRedirectWikiSearch();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={redirectSearchLoading}
                  onClick={() => void runRedirectWikiSearch()}
                  className="shrink-0 rounded-lg border border-violet-300 bg-violet-100 px-4 py-2 text-sm font-medium text-violet-950 hover:bg-violet-200 disabled:opacity-60 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100 dark:hover:bg-violet-900"
                >
                  {redirectSearchLoading ? "検索中…" : "ページを検索"}
                </button>
              </div>
              {redirectSearchError ? (
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  {redirectSearchError}
                </p>
              ) : null}
              {redirectSearchResults.length > 0 ? (
                <ul className="max-h-52 overflow-y-auto rounded-lg border border-violet-200 bg-white dark:border-violet-800 dark:bg-zinc-950/80">
                  {redirectSearchResults.map((hit) => (
                    <li
                      key={hit.title}
                      className="border-b border-violet-100 last:border-0 dark:border-violet-900/60"
                    >
                      <button
                        type="button"
                        aria-pressed={redirectTargetTitle === hit.title}
                        className={`w-full px-3 py-2.5 text-left text-sm hover:bg-violet-100 dark:hover:bg-violet-950/50 ${
                          redirectTargetTitle === hit.title
                            ? "bg-violet-200/80 dark:bg-violet-950/70"
                            : ""
                        }`}
                        onClick={() => {
                          setRedirectTargetTitle(hit.title);
                          setRedirectSearchError(null);
                        }}
                      >
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {hit.title}
                        </span>
                        {hit.snippet ? (
                          <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-400">
                            {hit.snippet}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {redirectTargetTitle ? (
                <p className="rounded-lg border border-violet-300 bg-violet-100/80 px-3 py-2 text-sm text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
                  <span className="font-medium">移動先:</span>{" "}
                  {redirectTargetTitle}
                  <button
                    type="button"
                    className="ml-3 text-xs underline decoration-violet-700/50 hover:decoration-violet-700"
                    onClick={() => setRedirectTargetTitle("")}
                  >
                    選択を解除
                  </button>
                </p>
              ) : null}
            </div>
          </div>
        ) : toolMode === "create" ? (
          <div className="space-y-3 rounded-xl border border-teal-200/90 bg-teal-50/40 p-4 dark:border-teal-900/50 dark:bg-teal-950/20">
            <fieldset>
              <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                記事の種類（必須）
              </legend>
              <div
                className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap"
                role="radiogroup"
                aria-label="記事の種類"
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                  <input
                    type="radio"
                    name="create-subject-kind"
                    className="h-4 w-4 border-zinc-300 text-teal-600 focus:ring-teal-500 dark:border-zinc-600 dark:bg-zinc-950"
                    checked={createSubjectKind === "person"}
                    onChange={() => setCreateSubjectKind("person")}
                  />
                  人物（ヒカマーwiki:チラシの裏/ に作成）
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
                  <input
                    type="radio"
                    name="create-subject-kind"
                    className="h-4 w-4 border-zinc-300 text-teal-600 focus:ring-teal-500 dark:border-zinc-600 dark:bg-zinc-950"
                    checked={createSubjectKind === "other"}
                    onChange={() => setCreateSubjectKind("other")}
                  />
                  人物以外
                </label>
              </div>
            </fieldset>
            <div>
              <label
                className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
                htmlFor="new-article-title"
              >
                {createSubjectKind === "person"
                  ? "ページ名（ヒカマーwiki:チラシの裏/ の下。見出しのみでよい）"
                  : "新規記事のページ名（手入力）"}
              </label>
              <input
                id="new-article-title"
                type="text"
                autoComplete="off"
                name="new-article-title"
                className="mt-1 w-full rounded-lg border border-teal-200 bg-white px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2 dark:border-teal-800 dark:bg-zinc-950"
                placeholder={
                  createSubjectKind === "person"
                    ? "例: 山田太郎"
                    : "例: 〇〇の出来事（2026年）"
                }
                value={wikiTitle}
                onChange={(e) => setWikiTitle(e.target.value)}
              />
            </div>
            {createSubjectKind === "person" &&
            wikiTitle.trim() &&
            resolveNewArticleWikiTitle(wikiTitle, "person") ? (
              <p className="rounded-lg border border-teal-300/80 bg-white/80 px-3 py-2 font-mono text-xs text-teal-950 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-100">
                作成されるページ名:{" "}
                {resolveNewArticleWikiTitle(wikiTitle, "person")}
              </p>
            ) : null}
            <p className="text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
              このタイトルに既に本文があるページでは実行できません（上書きしません）。一覧から選びたい場合は「記事を編集」を使ってください。
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Wiki ページ（キーワードで検索し、一覧から選択）
            </label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="text"
                inputMode="search"
                autoComplete="off"
                name="wiki-page-keyword"
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none ring-emerald-500/30 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950"
                placeholder="記事を探すキーワード"
                value={wikiSearchInput}
                onChange={(e) => setWikiSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void runWikiSearch();
                  }
                }}
              />
              <button
                type="button"
                disabled={wikiSearchLoading}
                onClick={() => void runWikiSearch()}
                className="shrink-0 rounded-lg border border-zinc-300 bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-200 disabled:opacity-60 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              >
                {wikiSearchLoading ? "検索中…" : "ページを検索"}
              </button>
            </div>
            {wikiSearchError ? (
              <p className="text-sm text-amber-800 dark:text-amber-200">
                {wikiSearchError}
              </p>
            ) : null}
            {wikiSearchResults.length > 0 ? (
              <ul className="max-h-52 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950/80">
                {wikiSearchResults.map((hit) => (
                  <li key={hit.title} className="border-b border-zinc-200 last:border-0 dark:border-zinc-700">
                    <button
                      type="button"
                      aria-pressed={wikiTitle === hit.title}
                      className={`w-full px-3 py-2.5 text-left text-sm hover:bg-emerald-50 dark:hover:bg-emerald-950/40 ${
                        wikiTitle === hit.title
                          ? "bg-emerald-100 dark:bg-emerald-950/50"
                          : ""
                      }`}
                      onClick={() => {
                        setWikiTitle(hit.title);
                        setWikiSearchError(null);
                      }}
                    >
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {hit.title}
                      </span>
                      {hit.snippet ? (
                        <span className="mt-0.5 block text-xs text-zinc-600 dark:text-zinc-400">
                          {hit.snippet}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {wikiTitle ? (
              <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
                <span className="font-medium">選択中:</span> {wikiTitle}
                <button
                  type="button"
                  className="ml-3 text-xs underline decoration-emerald-700/50 hover:decoration-emerald-700"
                  onClick={() => {
                    setWikiTitle("");
                  }}
                >
                  選択を解除
                </button>
              </p>
            ) : null}
          </div>
        )}

        {toolMode === "edit" || toolMode === "create" ? (
          <div>
            <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {toolMode === "create"
                ? "記事の内容の指示（任意）"
                : "指示（追記・修正の内容）"}
            </label>
            <textarea
              className={`mt-1 min-h-[120px] w-full rounded-lg border bg-white px-3 py-2 text-sm outline-none focus:ring-2 dark:bg-zinc-950 ${
                toolMode === "create"
                  ? "border-teal-300 ring-teal-500/30 dark:border-teal-800"
                  : "border-zinc-300 ring-emerald-500/30 dark:border-zinc-700"
              }`}
              placeholder={
                toolMode === "create"
                  ? "空でも実行できます。例: 概要・経緯・反応を節立てして書き、出典はツイートに合わせて脚注を付けて"
                  : "例: 最近の○○に関するツイートを要約して「時事」節に追記して"
              }
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>
        ) : null}

        {toolMode === "factcheck" ? (
          <div className="space-y-3 rounded-xl border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/50 dark:bg-amber-950/15">
            <div>
              <label className="block text-sm font-medium text-zinc-800 dark:text-zinc-200">
                観点・補足（任意）
              </label>
              <textarea
                className="mt-1 min-h-[88px] w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm outline-none ring-amber-500/30 focus:ring-2 dark:border-amber-800 dark:bg-zinc-950"
                placeholder="空でも実行できます。検証の観点を書くと反映されやすいです。"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
            </div>
            {wikiTitle && factCheckOutlineLoading ? (
              <p className="text-sm text-amber-900 dark:text-amber-200/90">
                目次を読み込み中…
              </p>
            ) : null}
            {factCheckOutlineError ? (
              <p className="text-sm text-red-600 dark:text-red-400">
                {factCheckOutlineError}
              </p>
            ) : null}
            {wikiTitle && factCheckOutline !== null && !factCheckOutlineLoading ? (
              <div>
                <label
                  className="block text-sm font-medium text-zinc-800 dark:text-zinc-200"
                  htmlFor="factcheck-section"
                >
                  検証する範囲
                </label>
                <select
                  id="factcheck-section"
                  className="mt-1 w-full max-w-xl rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none ring-amber-500/30 focus:ring-2 dark:border-amber-800 dark:bg-zinc-950 dark:text-zinc-100"
                  value={
                    factCheckSectionIndex === null
                      ? "full"
                      : String(factCheckSectionIndex)
                  }
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "full") {
                      setFactCheckSectionIndex(null);
                      return;
                    }
                    const i = Number.parseInt(v, 10);
                    if (
                      Number.isNaN(i) ||
                      !factCheckOutline ||
                      !factCheckOutline[i]
                    ) {
                      return;
                    }
                    setFactCheckSectionIndex(i);
                  }}
                >
                  <option value="full">ページ全体（全文を検証）</option>
                  {factCheckOutline.map((s, i) => (
                    <option
                      key={`${i}-${s.title.slice(0, 40)}`}
                      value={String(i)}
                    >
                      {"　".repeat(Math.max(0, s.level - 2))}
                      {s.title}
                    </option>
                  ))}
                </select>
                {factCheckOutline.length === 0 ? (
                  <p className="mt-1 text-xs text-amber-900 dark:text-amber-200/90">
                    このページには{" "}
                    <code className="rounded bg-amber-100 px-1 dark:bg-amber-950/80">
                      == 見出し ==
                    </code>{" "}
                    がありません。全文を対象に検証します。
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    見出し（
                    <code className="rounded bg-zinc-200/80 px-1 dark:bg-zinc-800">
                      ==
                    </code>
                    ）単位で範囲を絞れます。未選択は全文です。
                  </p>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {toolMode === "edit" || toolMode === "create" ? (
          <div
            className={`rounded-lg border px-3 py-2 text-xs dark:bg-zinc-900/40 ${
              toolMode === "create"
                ? "border-teal-200 bg-teal-50/50 dark:border-teal-900/50"
                : "border-zinc-200 bg-white dark:border-zinc-700"
            }`}
          >
            <label className="block font-medium text-zinc-800 dark:text-zinc-200">
              記事用の画像を添付（任意）
            </label>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
              JPEG / PNG / WebP / GIF、最大 {MAX_INLINE_ATTACHMENTS}{" "}
              枚・各 {MAX_INLINE_IMAGE_BYTES / (1024 * 1024)}MB。実行時に Wiki
              に先にアップロードし、AI が{" "}
              <code className="rounded bg-zinc-200/90 px-0.5 dark:bg-zinc-800">
                [[File:...]]
              </code>{" "}
              や Infobox の画像として参照します（ツイート画像のみに頼らず使えます）。
            </p>
            <input
              key={attachmentInputKey}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="mt-2 block w-full max-w-md text-[13px] text-zinc-800 file:mr-3 file:rounded file:border-0 file:bg-zinc-200 file:px-2 file:py-1 file:text-xs dark:text-zinc-200 dark:file:bg-zinc-700"
              onChange={(e) => {
                const list = e.target.files;
                setAttachedFiles(list?.length ? Array.from(list) : []);
              }}
            />
            {attachedFiles.length > 0 ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ul className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  {attachedFiles.map((f) => (
                    <li key={`${f.name}-${f.size}`}>
                      {f.name}（{(f.size / 1024).toFixed(0)} KB）
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  className="text-[11px] underline text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                  onClick={() => {
                    setAttachedFiles([]);
                    setAttachmentInputKey((k) => k + 1);
                  }}
                >
                  添付をクリア
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {toolMode === "edit" ? (
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
            >
              {loading
                ? "処理中（下に進捗を表示）…"
                : "提案して Wiki に反映"}
            </button>
          ) : toolMode === "create" ? (
            <button
              type="submit"
              disabled={loading || createSubjectKind === null}
              className="inline-flex items-center justify-center rounded-full bg-teal-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-60"
            >
              {loading
                ? "処理中（下に進捗を表示）…"
                : "新規記事を Wiki に反映"}
            </button>
          ) : toolMode === "factcheck" ? (
            <button
              type="button"
              disabled={
                loading ||
                factCheckOutlineLoading ||
                !wikiTitle.trim()
              }
              onClick={() => void runFactCheckFromForm()}
              className="inline-flex items-center justify-center rounded-full border border-amber-600 bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-900 shadow-sm transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-100 dark:hover:bg-amber-900/60"
            >
              {loading ? "処理中…" : "ファクトチェックを実行"}
            </button>
          ) : (
            <button
              type="button"
              disabled={
                loading ||
                !redirectSourceTitle.trim() ||
                !redirectTargetTitle.trim()
              }
              onClick={() => void submitRedirect()}
              className="inline-flex items-center justify-center rounded-full border border-violet-600 bg-violet-50 px-5 py-2.5 text-sm font-medium text-violet-950 shadow-sm transition hover:bg-violet-100 disabled:opacity-60 dark:border-violet-500 dark:bg-violet-950/40 dark:text-violet-100 dark:hover:bg-violet-900/50"
            >
              {loading ? "投稿中…" : "リダイレクトを作成"}
            </button>
          )}
          {loading &&
          (toolMode === "edit" ||
            toolMode === "create" ||
            toolMode === "factcheck") ? (
            <button
              ref={stopRunButtonRef}
              type="button"
              onClick={() => stopRun()}
              aria-label="実行を停止"
              className="inline-flex items-center justify-center rounded-full border border-zinc-400 bg-white px-4 py-2 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
            >
              停止
            </button>
          ) : null}
        </div>
        {loading &&
        (toolMode === "edit" ||
          toolMode === "create" ||
          toolMode === "factcheck") ? (
          <div
            className="mt-4 max-h-56 overflow-y-auto rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950/80"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-busy={loading}
            aria-label="実行の進行状況"
          >
            <p className="mb-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
              進行状況（タブを閉じると途中経過が失われる場合があります）
            </p>
            <p className="mb-2 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
              「ツイート取得」はサーバー側で Wiki 取得・検索クエリ（必要なら
              AI）・Yahoo/DB 検索・補完などをまとめて行うため、数十秒〜数分かかることがあります。下の行にサーバーから届いた現在の処理が追加されます。
            </p>
            <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
              {progressLines.map((line, i) => (
                <li key={`${i}-${line.slice(0, 48)}`} className="break-words">
                  {line}
                </li>
              ))}
            </ol>
            {showAiStreamPanel ? (
              <div
                className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-700"
                aria-live="polite"
              >
                <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  AI ストリーミング（上段: 推論トークン、下段: 本文・JSON。ゲートウェイが推論を流す場合のみ上段が埋まります）
                </p>
                {streamPhaseLikely && !hasAnyAiStreamChunk ? (
                  <p className="mb-3 rounded border border-dashed border-zinc-300 bg-zinc-100/80 px-2 py-2 text-[11px] text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900/60 dark:text-zinc-400">
                    応答ストリームを待っています…（ツイートが多い・記事が長い・モデルがバッファしていると、最初のトークンまで数十秒〜数分かかることがあります）
                  </p>
                ) : null}
                {aiStreamChunks.suggest_queries_reasoning ? (
                  <div className="mb-3">
                    <p className="mb-1 text-[11px] font-medium text-violet-600 dark:text-violet-400">
                      推論（検索クエリ生成）
                    </p>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded border border-violet-200 bg-violet-50/80 px-2 py-1.5 font-mono text-[11px] text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
                      {aiStreamChunks.suggest_queries_reasoning}
                    </pre>
                  </div>
                ) : null}
                {aiStreamChunks.suggest_queries ? (
                  <div className="mb-3">
                    <p className="mb-1 text-[11px] text-zinc-500">
                      検索クエリ生成（本文）
                    </p>
                    <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-200 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">
                      {aiStreamChunks.suggest_queries}
                    </pre>
                  </div>
                ) : null}
                {runKind === "edit" &&
                aiStreamChunks.compose_wikitext_reasoning ? (
                  <div className="mb-3">
                    <p className="mb-1 text-[11px] font-medium text-violet-600 dark:text-violet-400">
                      推論（wikitext 編集）
                    </p>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded border border-violet-200 bg-violet-50/80 px-2 py-1.5 font-mono text-[11px] text-violet-950 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-100">
                      {aiStreamChunks.compose_wikitext_reasoning}
                    </pre>
                  </div>
                ) : null}
                {runKind === "edit" && aiStreamChunks.compose_wikitext ? (
                  <div>
                    <p className="mb-1 text-[11px] text-zinc-500">
                      wikitext 編集（本文・JSON）
                    </p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-zinc-200 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-800 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200">
                      {aiStreamChunks.compose_wikitext}
                    </pre>
                  </div>
                ) : null}
                {runKind === "factcheck" &&
                aiStreamChunks.fact_check_reasoning ? (
                  <div className="mb-3">
                    <p className="mb-1 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      推論（ファクトチェック）
                    </p>
                    <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all rounded border border-amber-200 bg-amber-50/80 px-2 py-1.5 font-mono text-[11px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                      {aiStreamChunks.fact_check_reasoning}
                    </pre>
                  </div>
                ) : null}
                {runKind === "factcheck" && aiStreamChunks.fact_check ? (
                  <div>
                    <p className="mb-1 text-[11px] text-zinc-500">
                      ファクトチェック（JSON）
                    </p>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded border border-amber-200 bg-white px-2 py-1.5 font-mono text-[11px] text-zinc-800 dark:border-amber-800 dark:bg-zinc-900 dark:text-zinc-200">
                      {aiStreamChunks.fact_check}
                    </pre>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </form>
    </section>
  );
}
