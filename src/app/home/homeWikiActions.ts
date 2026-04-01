import type { FormEvent } from "react";
import type { Dispatch, SetStateAction } from "react";
import { apiClientHeaders } from "@/lib/apiClientHeaders";
import { appendRunHistory, loadRunHistory } from "@/lib/runHistory";
import type { WikiSearchHit } from "@/app/home/homeTypes";
import { WIKI_SEARCH_CLIENT_TIMEOUT_MS } from "@/app/home/homeWikiShare";

export async function runWikiSearchAction(input: {
  wikiSearchInput: string;
  setWikiSearchLoading: Dispatch<SetStateAction<boolean>>;
  setWikiSearchError: Dispatch<SetStateAction<string | null>>;
  setWikiSearchResults: Dispatch<SetStateAction<WikiSearchHit[]>>;
  e?: FormEvent;
}) {
  const {
    wikiSearchInput,
    setWikiSearchLoading,
    setWikiSearchError,
    setWikiSearchResults,
    e,
  } = input;
  e?.preventDefault();
  const q = wikiSearchInput.trim();
  if (!q) {
    setWikiSearchError("検索語を入力してください");
    return;
  }
  setWikiSearchLoading(true);
  setWikiSearchError(null);
  setWikiSearchResults([]);
  try {
    const r = await fetch(`/api/wiki/search?q=${encodeURIComponent(q)}`, {
      headers: { ...apiClientHeaders() },
      signal: AbortSignal.timeout(WIKI_SEARCH_CLIENT_TIMEOUT_MS),
    });
    const raw = await r.text();
    let data: { results?: WikiSearchHit[]; error?: string } = {};
    if (raw.trim()) {
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        setWikiSearchError(
          `検索の応答を解釈できませんでした（HTTP ${r.status}）`
        );
        return;
      }
    }
    if (!r.ok) {
      setWikiSearchError(data.error ?? "検索に失敗しました");
      return;
    }
    setWikiSearchResults(data.results ?? []);
    if ((data.results ?? []).length === 0) {
      setWikiSearchError("該当するページが見つかりませんでした");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      setWikiSearchError(
        "検索がタイムアウトしました（Wiki または接続が応答しません）。しばらくしてから再試行してください。"
      );
      return;
    }
    setWikiSearchError("通信エラーが発生しました");
  } finally {
    setWikiSearchLoading(false);
  }
}

export async function runRedirectWikiSearchAction(input: {
  redirectSearchInput: string;
  setRedirectSearchLoading: Dispatch<SetStateAction<boolean>>;
  setRedirectSearchError: Dispatch<SetStateAction<string | null>>;
  setRedirectSearchResults: Dispatch<SetStateAction<WikiSearchHit[]>>;
  e?: FormEvent;
}) {
  const {
    redirectSearchInput,
    setRedirectSearchLoading,
    setRedirectSearchError,
    setRedirectSearchResults,
    e,
  } = input;
  e?.preventDefault();
  const q = redirectSearchInput.trim();
  if (!q) {
    setRedirectSearchError("検索語を入力してください");
    return;
  }
  setRedirectSearchLoading(true);
  setRedirectSearchError(null);
  setRedirectSearchResults([]);
  try {
    const r = await fetch(`/api/wiki/search?q=${encodeURIComponent(q)}`, {
      headers: { ...apiClientHeaders() },
      signal: AbortSignal.timeout(WIKI_SEARCH_CLIENT_TIMEOUT_MS),
    });
    const raw = await r.text();
    let data: { results?: WikiSearchHit[]; error?: string } = {};
    if (raw.trim()) {
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        setRedirectSearchError(
          `検索の応答を解釈できませんでした（HTTP ${r.status}）`
        );
        return;
      }
    }
    if (!r.ok) {
      setRedirectSearchError(data.error ?? "検索に失敗しました");
      return;
    }
    setRedirectSearchResults(data.results ?? []);
    if ((data.results ?? []).length === 0) {
      setRedirectSearchError("該当するページが見つかりませんでした");
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      setRedirectSearchError(
        "検索がタイムアウトしました（Wiki または接続が応答しません）。しばらくしてから再試行してください。"
      );
      return;
    }
    setRedirectSearchError("通信エラーが発生しました");
  } finally {
    setRedirectSearchLoading(false);
  }
}

export async function submitWikiRedirectAction(input: {
  redirectSourceTitle: string;
  redirectTargetTitle: string;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string | null>>;
  setShareSnapshot: Dispatch<
    SetStateAction<import("@/app/home/homeTypes").ShareSnapshot | null>
  >;
  setRunHistory: Dispatch<
    SetStateAction<import("@/lib/runHistory").RunHistoryEntry[]>
  >;
}) {
  const {
    redirectSourceTitle,
    redirectTargetTitle,
    setLoading,
    setMessage,
    setShareSnapshot,
    setRunHistory,
  } = input;
  const src = redirectSourceTitle.trim();
  const tgt = redirectTargetTitle.trim();
  if (!src) {
    setMessage("移動元のページ名を入力してください");
    return;
  }
  if (!tgt) {
    setMessage("移動先を検索して一覧から選んでください");
    return;
  }

  setLoading(true);
  setMessage(null);
  setShareSnapshot(null);
  try {
    const r = await fetch("/api/wiki/redirect", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...apiClientHeaders() },
      body: JSON.stringify({
        sourceTitle: src,
        targetTitle: tgt,
      }),
    });
    const raw = await r.text();
    let data: {
      ok?: boolean;
      error?: string;
      missingEnv?: string[];
      sourceTitle?: string;
      targetTitle?: string;
    } = {};
    if (raw.trim()) {
      try {
        data = JSON.parse(raw) as typeof data;
      } catch {
        setMessage(`エラーが発生しました（HTTP ${r.status}）`);
        return;
      }
    }
    if (!r.ok) {
      let detail = "リダイレクトの作成に失敗しました";
      if (typeof data.error === "string") {
        detail = data.error;
      } else if (data.error != null && typeof data.error === "object") {
        detail = JSON.stringify(data.error);
      }
      if (Array.isArray(data.missingEnv) && data.missingEnv.length > 0) {
        detail += `（未設定: ${data.missingEnv.join(", ")}）`;
      }
      setMessage(`エラー: ${detail}`);
      return;
    }
    if (data.ok === true && data.sourceTitle && data.targetTitle) {
      setShareSnapshot({
        kind: "redirect",
        wikiTitle: data.sourceTitle,
        targetTitle: data.targetTitle,
      });
      appendRunHistory({
        kind: "redirect",
        pageLabel: `${data.sourceTitle} → ${data.targetTitle}`,
        summary: "リダイレクトを作成して Wiki に反映",
      });
      setRunHistory(loadRunHistory());
      setMessage(
        `「${data.sourceTitle}」を「${data.targetTitle}」へリダイレクトしました（Wiki に反映済み）。`
      );
      return;
    }
    setMessage("応答を解釈できませんでした");
  } catch {
    setMessage("通信エラーが発生しました");
  } finally {
    setLoading(false);
  }
}
