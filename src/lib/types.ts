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
  /** Yahoo リアルタイム検索用クエリ（空なら AI が instruction から推測） */
  tweetQuery?: string;
  /** 上級: 手動で期間を固定（API 用）。未指定なら AI が任意で付与（付けないこともある） */
  tweetSince?: string;
  /** 上級: 手動で期間を固定（API 用） */
  tweetUntil?: string;
  /** true のとき「このタイトルに本文が無いこと」を必須にしてから作成（新規記事） */
  createNewArticle?: boolean;
  status: ProposalStatus;
  lastError?: string;
  /** 直近の実行ログ（プレビュー用テキストなど） */
  lastRunSummary?: string;
  lastPreviewWikitext?: string;
};

export type RunOptions = {
  dryRun: boolean;
};

/** 直近実行の画面ログ用（パイプラインが API 経由で返す） */
export type PipelineRunLog = {
  querySource: "user" | "ai";
  /** 互換・表示用（複数クエリを区切った 1 文字列） */
  tweetQueryUsed: string;
  /** 実際に検索に使ったクエリ（複数） */
  tweetQueriesUsed: string[];
  /** ツイート検索に適用した期間の説明 */
  tweetSearchRangeLabel?: string;
  /** 手動（proposal）か、検索語の since:/until: か */
  tweetSearchRangeSource?: "manual" | "query";
  /** 編集対象が新規作成か既存ページか */
  wikiTarget?: "new" | "existing";
  yahooCount: number;
  dbCount: number;
  mergedTweetCount: number;
  cap: number;
  yahooError?: string;
  dbError?: string;
  /** list=search で集めた関連ページ（編集対象ページ除く、ユニーク件数） */
  wikiSearchHitCount?: number;
  wikiSearchError?: string;
  /** Yahoo!ウェブ検索（HTML 解析）で集めたヒット数 */
  yahooWebSearchHitCount?: number;
  yahooWebSearchError?: string;
  aiStrategy: "full" | "patch" | "refuse";
  aiPatchCount: number;
  /** strategy が refuse のとき AI が説明した見送り理由（notesForHuman） */
  aiNotesForHuman?: string;
};

/** ファクトチェック API の結果（Wiki は更新しない） */
export type FactCheckItem = {
  claim: string;
  verdict: "supported" | "weak" | "contradicted" | "unknown";
  notes: string;
  /** 参照した根拠の短いメモ（ツイート id・ページ名など） */
  sources?: string[];
};

export type FactCheckReport = {
  /** 全体の要約（日本語） */
  summary: string;
  items: FactCheckItem[];
};

/** ファクトチェック実行のメタ情報（画面ログ用） */
export type FactCheckRunLog = {
  querySource: "user" | "ai";
  tweetQueryUsed: string;
  tweetQueriesUsed: string[];
  tweetSearchRangeLabel?: string;
  tweetSearchRangeSource?: "manual" | "query";
  yahooCount: number;
  dbCount: number;
  mergedTweetCount: number;
  cap: number;
  yahooError?: string;
  dbError?: string;
  wikiSearchHitCount?: number;
  wikiSearchError?: string;
  yahooWebSearchHitCount?: number;
  yahooWebSearchError?: string;
};
