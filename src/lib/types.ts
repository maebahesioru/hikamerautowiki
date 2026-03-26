export type ProposalStatus =
  | "draft"
  | "running"
  | "done"
  | "error"
  | "preview_only";

export type Proposal = {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** MediaWiki のページ名（例: メインページ） */
  wikiTitle: string;
  /** 人間からの指示（追記・修正の意図） */
  instruction: string;
  /** X 検索用クエリ（空なら AI が instruction から推測） */
  tweetQuery?: string;
  status: ProposalStatus;
  lastError?: string;
  /** 直近の実行ログ（プレビュー用テキストなど） */
  lastRunSummary?: string;
  lastPreviewWikitext?: string;
};

export type RunOptions = {
  dryRun: boolean;
};
