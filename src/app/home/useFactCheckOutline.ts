import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { WikiOutlineSection } from "@/lib/wikitextSections";
import { apiClientHeaders } from "@/lib/apiClientHeaders";

type Params = {
  toolMode: "edit" | "create" | "factcheck" | "redirect";
  wikiTitle: string;
  setFactCheckOutline: Dispatch<
    SetStateAction<WikiOutlineSection[] | null>
  >;
  setFactCheckOutlineLoading: Dispatch<SetStateAction<boolean>>;
  setFactCheckOutlineError: Dispatch<SetStateAction<string | null>>;
  setFactCheckSectionIndex: Dispatch<SetStateAction<number | null>>;
};

export function useFactCheckOutline({
  toolMode,
  wikiTitle,
  setFactCheckOutline,
  setFactCheckOutlineLoading,
  setFactCheckOutlineError,
  setFactCheckSectionIndex,
}: Params) {
  useEffect(() => {
    if (toolMode !== "factcheck") {
      return;
    }
    if (!wikiTitle.trim()) {
      setFactCheckOutline(null);
      setFactCheckOutlineError(null);
      setFactCheckOutlineLoading(false);
      setFactCheckSectionIndex(null);
      return;
    }
    let cancelled = false;
    setFactCheckOutlineLoading(true);
    setFactCheckOutlineError(null);
    setFactCheckSectionIndex(null);

    void (async () => {
      try {
        const r = await fetch(
          `/api/wiki/outline?title=${encodeURIComponent(wikiTitle.trim())}`,
          { headers: { ...apiClientHeaders() } }
        );
        const raw = await r.text();
        let data: {
          ok?: boolean;
          missing?: boolean;
          sections?: WikiOutlineSection[];
          error?: string;
        } = {};
        if (raw.trim()) {
          try {
            data = JSON.parse(raw) as typeof data;
          } catch {
            if (!cancelled) {
              setFactCheckOutlineError("目次の応答を解釈できませんでした");
              setFactCheckOutline(null);
            }
            return;
          }
        }
        if (!r.ok) {
          if (!cancelled) {
            setFactCheckOutlineError(
              typeof data.error === "string"
                ? data.error
                : "目次の取得に失敗しました"
            );
            setFactCheckOutline(null);
          }
          return;
        }
        if (!data.ok) {
          if (!cancelled) {
            setFactCheckOutlineError("目次の取得に失敗しました");
            setFactCheckOutline(null);
          }
          return;
        }
        if (data.missing) {
          if (!cancelled) {
            setFactCheckOutline(null);
            setFactCheckOutlineError(
              "ページが見つかりません（未作成または削除済み）"
            );
          }
          return;
        }
        if (!cancelled) {
          setFactCheckOutline(data.sections ?? []);
          setFactCheckOutlineError(null);
        }
      } catch {
        if (!cancelled) {
          setFactCheckOutlineError("通信エラーが発生しました");
          setFactCheckOutline(null);
        }
      } finally {
        if (!cancelled) {
          setFactCheckOutlineLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [wikiTitle, toolMode]);
}
