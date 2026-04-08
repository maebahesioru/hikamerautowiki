import type { TweetHit } from "@/lib/yahoo-realtime";

export type WikiSearchHit = {
  title: string;
  snippet?: string;
  wikitext?: string;
};

/** 成功直後の X 共有用（ページ名を保持） */
export type ShareSnapshot =
  | { kind: "edit"; wikiTitle: string }
  | { kind: "create"; wikiTitle: string }
  | { kind: "factcheck"; wikiTitle: string }
  | { kind: "redirect"; wikiTitle: string; targetTitle: string };

export type RunStreamComplete = {
  type?: string;
  ok?: boolean;
  error?: string;
  applied?: boolean;
  log?: import("@/lib/types").PipelineRunLog;
  proposal?: import("@/lib/types").Proposal;
  report?: import("@/lib/types").FactCheckReport;
  /** /api/run/evidence の complete SSE */
  screenEnabled?: boolean;
  tweets?: TweetHit[];
  cap?: number;
  toxicityThreshold?: number;
  bootstrapOnly?: boolean;
  bootstrapTweets?: TweetHit[];
};
