import type { PipelineRunLog } from "@/lib/types";

const STORAGE_KEY = "hikamer_run_history_v1";
const MAX_ENTRIES = 80;

export type RunHistoryEntry = {
  id: string;
  /** ISO 8601 */
  at: string;
  kind: "edit" | "create" | "factcheck" | "redirect";
  /** ページ名または「移動元 → 移動先」 */
  pageLabel: string;
  /** 1 行の要約 */
  summary: string;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

function isValidEntry(x: unknown): x is RunHistoryEntry {
  if (!isRecord(x)) return false;
  if (typeof x.id !== "string" || x.id.length === 0) return false;
  if (typeof x.at !== "string") return false;
  if (
    x.kind !== "edit" &&
    x.kind !== "create" &&
    x.kind !== "factcheck" &&
    x.kind !== "redirect"
  ) {
    return false;
  }
  if (typeof x.pageLabel !== "string") return false;
  if (typeof x.summary !== "string") return false;
  return true;
}

export function loadRunHistory(): RunHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

export function appendRunHistory(
  entry: Omit<RunHistoryEntry, "id" | "at"> & { id?: string; at?: string }
): void {
  if (typeof window === "undefined") return;
  const id = entry.id ?? crypto.randomUUID();
  const at = entry.at ?? new Date().toISOString();
  const full: RunHistoryEntry = {
    id,
    at,
    kind: entry.kind,
    pageLabel: entry.pageLabel,
    summary: entry.summary,
  };
  const next = [full, ...loadRunHistory()].slice(0, MAX_ENTRIES);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function clearRunHistory(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

/** 編集反映成功時のログから短い説明 */
export function summarizeEditLog(log: PipelineRunLog | undefined): string {
  if (!log) return "Wiki に反映";
  if (log.aiStrategy === "patch") {
    return `Wiki に反映（部分パッチ ${log.aiPatchCount} 件）`;
  }
  if (log.aiStrategy === "full") {
    return "Wiki に反映（全文置換）";
  }
  if (log.aiStrategy === "refuse") {
    return "見送り（Wiki は未更新）";
  }
  return "Wiki に反映";
}

export function truncateSummary(s: string, max = 180): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}
