import {
  chatCompletionNonStream,
  chatCompletionStream,
  OPENAI_MODELS,
  WIKI_COMPOSE_MODELS,
} from "@/lib/openaiCompat";
import type { NormalizedTokenUsage } from "@/lib/openaiUsage";
import type { FactCheckItem, FactCheckReport } from "@/lib/types";
import type { TweetHit } from "@/lib/yahoo-realtime";
import type { WikitextPatch } from "@/lib/wikitextPatch";
import { applyWikitextPatches } from "@/lib/wikitextPatch";
import {
  getQueryBootstrapTweetMax,
  getQuerySuggestWikitextMaxChars,
} from "@/lib/tweetLimits";
import {
  embedTwimgBracketLinksAsImg,
  expandMediaRefsInWikitext,
  expandTweetRefsInWikitext,
  fixMisusedFileNamespaceForExternalUrls,
  formatReferenceTweetsForPrompt,
} from "@/lib/tweetPrompt";

export type ComposeInput = {
  wikiTitle: string;
  instruction: string;
  currentWikitext: string;
  tweets: TweetHit[];
  /** Wiki 内検索の関連ページ（編集対象は含めない）。`wikitext` はパイプラインで本文取得済みのとき */
  wikiSearchHits?: Array<{ title: string; snippet?: string; wikitext?: string }>;
  /** Yahoo!ウェブ検索（search.yahoo.co.jp）のヒット。ツイート検索クエリに連動 */
  yahooWebSearchHits?: Array<{ title: string; url: string; snippet: string }>;
  /**
   * 新規記事などで `public/wikitemp.txt` から読んだ体裁サンプル。
   * 本文のコピー禁止・記法の参考のみ、と user プロンプトで明示する。
   */
  wikitempStyleExample?: string;
  /**
   * フォーム添付画像を Wiki に先にアップロード済みのとき（またはプレビュー時の予定ファイル名）。
   * 本文では `[[File:wikiFilename]]` や Infobox の `|image=` にそのまま使う。
   */
  preUploadedWikiFiles?: Array<{ wikiFilename: string; originalName: string }>;
  /** プロンプト整形・API 待ちの細かい進捗（SSE の progress に載せる） */
  onProgress?: (message: string) => void;
};

export type ComposeResult = {
  newWikitext: string;
  editSummary: string;
  notesForHuman: string;
  /** モデルが選んだ編集のしかた（refuse は Wiki を更新しない） */
  strategyUsed: "full" | "patch" | "refuse";
  patchCount: number;
};

function formatWikiSearchHitsForPrompt(
  wikiHits: Array<{ title: string; snippet?: string; wikitext?: string }>
): string {
  if (wikiHits.length === 0) {
    return "（Wiki 内検索で追加の関連ページはありません。）";
  }
  return wikiHits
    .map((h, i) => {
      const full = h.wikitext?.trim();
      if (full) {
        return [`${i + 1}. ${h.title}`, "```wiki", full, "```"].join("\n");
      }
      const snip = h.snippet?.trim();
      if (snip) {
        return `${i + 1}. ${h.title} — ${snip}（本文の取得に失敗したか空のためスニペットのみ）`;
      }
      return `${i + 1}. ${h.title}（本文・スニペットともなし）`;
    })
    .join("\n\n");
}

function formatYahooWebSearchForPrompt(
  hits: Array<{ title: string; url: string; snippet: string }>
): string {
  if (hits.length === 0) {
    return "（Yahoo!ウェブ検索の結果はありません。無効化しているか、取得に失敗した可能性があります。）";
  }
  return hits
    .map((h, i) => {
      const sn = h.snippet?.trim() ? `\n   ${h.snippet.trim()}` : "";
      return `${i + 1}. ${h.title}\n   ${h.url}${sn}`;
    })
    .join("\n\n");
}

function buildUnifiedUserPrompt(input: ComposeInput, tweetBlock: string): string {

  const wikiHits = input.wikiSearchHits ?? [];
  const wikiBlock = formatWikiSearchHitsForPrompt(wikiHits);
  const yahooWebBlock = formatYahooWebSearchForPrompt(
    input.yahooWebSearchHits ?? []
  );

  const styleExample = input.wikitempStyleExample?.trim();

  const lines: string[] = [
    `対象ページ名: ${input.wikiTitle}`,
    "",
    "【編集指示（人間）】",
    input.instruction,
    "",
    "【現在の wikitext】",
    "```wiki",
    input.currentWikitext || "（空・新規ページ扱い）",
    "```",
    "",
  ];

  const preUp = input.preUploadedWikiFiles ?? [];
  if (preUp.length > 0) {
    lines.push(
      "【フォームで添付され、既に（またはプレビュー時は予定どおり）Wiki に置かれた画像ファイル】",
      "次のファイル名は Wiki 上でそのまま File: として参照できる。URL を書かずに [[File:ファイル名]] または Infobox の |image=ファイル名（拡張子付き）を使う。",
      ...preUp.map(
        (f, i) =>
          `${i + 1}. ${f.wikiFilename}（元のファイル名: ${f.originalName}）`
      ),
      ""
    );
  }

  if (styleExample && styleExample.length > 0) {
    lines.push(
      "【新規記事の体裁・記法の参考（wikitemp.txt）】",
      "以下はこの Wiki に既にある別記事から取った wikitext の例である。題材・事実・人物は対象ページとは無関係。**本文をコピペして使わないこと。** Infobox、見出し（== ==）、脚注、カテゴリ、表や装飾の付け方・トーンの参考にだけ使う。",
      "**この Wiki の Infobox は `{{Infobox Person` で始まる（例どおり `|image=`・`|本名=`・`|職業=` など）。`{{Infobox YouTuber` や英語 Wikipedia 由来の Infobox 名は存在しない想定なので使わない。**",
      "```wiki",
      styleExample,
      "```",
      ""
    );
  }

  lines.push(
    "【Wiki 内検索で得た関連ページ（取得できた各ページの wikitext 全文。編集対象ページは除く）】",
    "他ページの本文をそのままコピーせず、必要なら要約・参照のみ。編集するのは上記「対象ページ名」の 1 ページのみ。",
    wikiBlock,
    "",
    "【Yahoo!ウェブ検索の結果（ツイート検索用クエリで取得。Wiki 外の一般サイト・動画配信などのリンクが含まれる場合あり）】",
    "検索結果の抜粋であり、鮮度・正確性は保証されない。出典に使うときは URL の内容を過信しない。編集対象は引き続き「対象ページ名」の 1 ページのみ。",
    yahooWebBlock,
    "",
    "【参考ツイートの記号（識別子）について】",
    "次のブロック内では、実ツイート id・画像 URL は載せず参照用の記号だけを使う。a1/a2…は【acct】の行と対応するアカウント識別子。【tw】各行は `1. a1 (t:T1 …)` のように、ツイート識別子 t:T1（T1 が 1 件目）は括弧内の英字 1 文字 t で示す。M1/M2…は画像の参照番号。ツイート行の a1 と【acct】の先頭列 a1 が同じアカウントを指す。記事に出典や画像を書くときは `t:Tn` または従来どおり `[tweet:Tn]` / `tweet:Tn`、画像は |image=M3 など（保存時にサーバーが X の投稿 URL・画像 URL に置換する）。",
    "**記事本文では a1 を出典マークに使わないこと**（サーバーは a→実 id に自動置換しない）。ツイートの出典は `t:Tn` または `[tweet:Tn]`（`tweet:Tn` も可）、画像は M 番号の形で書く。**【acct】/【tw】行にだけ現れる圧縮略号（例: b: f: g: s: r: q: i: など。s: はアカウントの投稿数、t: は【tw】のツイート識別のみ）**はプロンプト用の省略表記であり、記事の wikitext にそのまま貼り付けない。**",
    "",
    "【参考ツイート】",
    tweetBlock,
    "",
    "次の JSON で応答すること（キー名は固定）:",
    "- strategy: \"full\" / \"patch\" / \"refuse\" のいずれかひとつ。",
    "- strategy が refuse のとき: この実行では Wiki を更新しない。newWikitext は \"\" でよい（無視される）。patches は []。",
    "- **notesForHuman（refuse 時は必須・空にしない）**: 日本語で、人間が読んで納得できるように次を必ず含める。(1) **なぜ**今回は Wiki を更新しないか（例: 参考ツイート 0 件で時事の根拠が取れない、指示が曖昧で解釈が一意に定まらない、虚偽依頼のため拒否、など）。(2) **何が**不足しているか（ツイート・出典・指示の具体性など）。(3) **次に**ユーザーが取れる対策（検索クエリの追加、指示の具体化、など）。2〜8 文程度。参考ツイートが 0 件で時事・出典に依存する追記のときは refuse を強く推奨。",
    "- strategy が full のとき: newWikitext に編集後のページ全文を入れる。patches は空配列 []。",
    "- strategy が patch のとき: patches に { oldText, newText } の配列。各 oldText は上記「現在の wikitext」に含まれる部分文字列で、適用時にちょうど 1 回だけ出現するように選ぶ。上から順に適用される。newWikitext は空文字 \"\" でよい。",
    "- 現在の wikitext が空のとき: 新規本文を書くなら strategy: full。書かないなら refuse。patch は使わない。",
    "出典としてツイートを参照する場合は、記事末尾の箇条書きなどで `t:T1` または `[tweet:T1]` のように参考ブロックの T 番号で書く（本文の並びと一致。保存時に X のステータス URL に置換される）。直接 `tweet:数値ID` や `tweet:https://x.com/.../status/...` と書いても保存前に同じ URL 形式に直る。",
    "参考ツイートの画像を記事に載せるときは、Infobox Person の `|image=M3`（番号は参考ツイートブロックの M1/M2… と一致）と書くか、本文に `{{MREF:3}}`（M3 と同じ番号）と書く。保存時にサーバーが参照番号を画像 URL に置換する。",
    "",
    "【虚偽・根拠なき内容への対応（必須）】",
    "- 編集指示が「嘘を書く」「事実と無関係な内容を事実として書く」「出典のない中傷・デマ」「出典と矛盾する断定のみを求める」などのときは、それを記事本文に反映しない。",
    "- その場合は strategy は patch または full のどちらでもよいが、既存のトーンを保ち、問題のある依頼部分は反映しないか、中立的な表現に留める。",
    "- notesForHuman に、どの依頼を実行しなかったか・理由（出典不足・虚偽依頼の拒否など）を短く書く。",
    "- 事実の追加・変更は、可能な限り「現在の wikitext」「参考ツイート」「Wiki 内検索で得た関連ページの本文」「Yahoo!ウェブ検索の抜粋」のいずれかに裏付けがあるときに限る。裏付けがない主張は断定せず、推測である旨を書くか省略する。",
  );

  return lines.join("\n");
}

type UnifiedModelJson = {
  strategy?: string;
  newWikitext?: string;
  patches?: WikitextPatch[];
  editSummary?: string;
  notesForHuman?: string;
};

function parseUnifiedJson(raw: string): UnifiedModelJson {
  const trimmed = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("OpenAI 応答の形式が不正です（JSON を解析できませんでした）");
    parsed = JSON.parse(m[0]);
  }
  return parsed as UnifiedModelJson;
}

function normalizePatches(p: unknown): WikitextPatch[] {
  if (!Array.isArray(p)) return [];
  const out: WikitextPatch[] = [];
  for (const x of p) {
    if (
      x &&
      typeof (x as WikitextPatch).oldText === "string" &&
      typeof (x as WikitextPatch).newText === "string"
    ) {
      out.push({ oldText: (x as WikitextPatch).oldText, newText: (x as WikitextPatch).newText });
    }
  }
  return out;
}

export type AiStreamOptions = {
  /** トークン単位の生成表示用（ストリーミング API・本文） */
  onStreamDelta?: (delta: string) => void;
  /** 推論・思考トークン（対応 API のみ。ゲートウェイが reasoning_content 等を流す場合） */
  onReasoningStreamDelta?: (delta: string) => void;
  /** 各 chat/completions 完了時（ログ・UI 進捗のトークン行用） */
  onTokenUsage?: (usage: NormalizedTokenUsage) => void;
  /** `openaiCompat` の HTTP フェーズ（`ChatCompletionOptions` と同じ） */
  onAwaitingHttpResponse?: () => void;
  onHttpResponseReady?: () => void;
};

/**
 * 応答ヘッダ待ちが長いときだけ経過を出す（ヘッダ受信後は出さない＝生成中と誤解させない）。
 */
async function withStallProgress<T>(
  onProg: ((m: string) => void) | undefined,
  everyMs: number,
  /** true のとき経過メッセージを抑止（例: 応答ヘッダ受信後） */
  shouldSuppress: () => boolean,
  run: () => Promise<T>
): Promise<T> {
  if (!onProg) return run();
  let ticks = 0;
  const id = setInterval(() => {
    if (shouldSuppress()) return;
    ticks += 1;
    const sec = (ticks * everyMs) / 1000;
    onProg(
      `AI 応答待ち… ${sec} 秒経過（応答ヘッダがまだ返っていません。サーバー処理か混雑の可能性があります）`
    );
  }, everyMs);
  try {
    return await run();
  } finally {
    clearInterval(id);
  }
}

/**
 * 1 回の API 呼び出しで、モデルが full / patch / refuse を選び、
 * refuse 以外はサーバーでパッチ適用まで済ませた最終 newWikitext を返す。
 */
export async function composeWikitextWithOpenAI(
  input: ComposeInput,
  streamOptions?: AiStreamOptions
): Promise<ComposeResult> {
  const onProg = input.onProgress;
  onProg?.(
    "参考ツイート・Wiki 関連ページを 1 本のプロンプトに整形しています（件数が多いと数十秒〜数分かかることがあります）…"
  );
  const tweetParts =
    input.tweets.length === 0
      ? {
          prompt:
            "（参考ツイートは 0 件。時事・ツイート出典が必要な追記は行わず strategy: refuse を選べる。体裁・誤字などツイート不要の指示だけなら full / patch 可。）",
          mediaRefToUrl: new Map<string, string>(),
          tweetRefToId: new Map<string, string>(),
        }
      : await formatReferenceTweetsForPrompt(input.tweets);

  const finalize = (wikitext: string): string =>
    embedTwimgBracketLinksAsImg(
      fixMisusedFileNamespaceForExternalUrls(
        expandMediaRefsInWikitext(
          expandTweetRefsInWikitext(wikitext, tweetParts.tweetRefToId),
          tweetParts.mediaRefToUrl
        )
      )
    );

  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    {
      role: "system",
        content:
          "あなたは MediaWiki の記事編集アシスタントです。strategy は full / patch / refuse のいずれか。refuse は Wiki を更新しない選択。refuse のときは notesForHuman に、見送り理由を日本語で必ず具体的に説明する（なぜ・何が不足か・ユーザーが次にできること）。参考ツイートが 0 件で時事追記ができないときは refuse を選べる。ページ名・編集指示・現在の wikitext・Wiki 内検索の関連ページ本文（取得できたもの）・参考ツイートを踏まえ判断する。patch のときは oldText が現在の wikitext に一意に一致するよう細心の注意を払う。推測で事実を断定しない。Wiki 内の他ページは参照のみで、編集対象は常に「対象ページ名」の 1 ページのみ。編集指示が虚偽の内容の掲載・根拠のない中傷・出典と矛盾する断定のみを求めるものである場合は、それを本文に反映せず、notesForHuman に拒否理由を書く。この Wiki（ヒカマーwiki）では人物・動画投稿者の記事でも Infobox は「{{Infobox Person」で始める（public/wikitemp.txt の実例に従う）。「{{Infobox YouTuber」や英語 Wikipedia 由来の Infobox 名はこの Wiki では使わない。パラメータは wikitemp の例のとおり |image=・|本名=・|職業= などを使う。参考ツイートに画像参照番号があるときは Infobox Person の |image= に M3 参照を付けるか、本文に {{MREF:3}} と書ける（保存時にサーバーが URL に置換）。**ユーザーがフォームに添付した画像がプロンプトに列挙されている場合は、その Wiki ファイル名をそのまま |image= または [[File:...]] に使う（既にアップロード済み）。** **外部画像の URL を [[File:https://...]] と書かない**（File: は Wiki にアップロード済みのファイル名のみ）。X の画像 URL は [https://pbs.twimg.com/... 説明] か {{MREF:n}} でよい（File: 誤用は保存時に外部リンクに直る。角括弧を img にするのはサーバー設定で明示したときのみ。反映実行時は pbs.twimg.com の画像を Wiki にアップロードして File: に置き換える（ボットに upload 権限が必要。HIKAMER_UPLOAD_TWIMG=0 で無効）。次のキーだけを持つ JSON オブジェクトのみ返す: strategy, newWikitext, patches, editSummary, notesForHuman",
    },
    { role: "user", content: buildUnifiedUserPrompt(input, tweetParts.prompt) },
  ];

  const useStream =
    streamOptions?.onStreamDelta != null ||
    streamOptions?.onReasoningStreamDelta != null;

  let suppressStallProgress = false;
  let composeResponseReadyLine = 0;
  const httpAwaiting =
    streamOptions?.onAwaitingHttpResponse ??
    (() =>
      onProg?.(
        "chat/completions に送信中。応答ヘッダが返るまで待機中（サーバーがプロンプトを処理。大きいと数分）…"
      ));
  const httpReady = () => {
    suppressStallProgress = true;
    if (streamOptions?.onHttpResponseReady) {
      streamOptions.onHttpResponseReady();
    } else {
      composeResponseReadyLine += 1;
      onProg?.(
        composeResponseReadyLine <= 1
          ? "応答ストリーム受信開始。JSON 本文のトークンを読み取り中…"
          : "（再試行：json モード切替えまたは次モデル）応答ストリーム受信中…"
      );
    }
  };

  const completion = await withStallProgress(
    onProg,
    45_000,
    () => suppressStallProgress,
    () =>
      useStream
        ? chatCompletionStream(messages, {
            models: WIKI_COMPOSE_MODELS,
            jsonObject: true,
            onDelta: streamOptions?.onStreamDelta ?? (() => {}),
            onReasoningDelta: streamOptions?.onReasoningStreamDelta,
            onAwaitingHttpResponse: httpAwaiting,
            onHttpResponseReady: httpReady,
          })
        : chatCompletionNonStream(messages, {
            models: WIKI_COMPOSE_MODELS,
            jsonObject: true,
            onAwaitingHttpResponse: httpAwaiting,
            onHttpResponseReady: httpReady,
          })
  );
  streamOptions?.onTokenUsage?.(completion.usage);
  const content = completion.content;

  const parsed = parseUnifiedJson(content);
  const patches = normalizePatches(parsed.patches);
  const newWikitextRaw =
    typeof parsed.newWikitext === "string" ? parsed.newWikitext : "";
  const summary = parsed.editSummary ?? "自動編集";
  const notes = parsed.notesForHuman ?? "";

  const rawStrategy =
    typeof parsed.strategy === "string" ? parsed.strategy.trim().toLowerCase() : "";
  if (rawStrategy === "refuse" || rawStrategy === "skip") {
    const refuseNotes =
      notes.trim() ||
      [
        "【見送りの理由（自動補完）】モデルが notesForHuman を返さなかったか空でした。",
        "参考ツイートが無い、または指示の根拠となる出典が不足している可能性があります。",
        "時事の追記が必要な場合は、Yahoo 検索クエリを具体化するか、ツイートが取れるキーワードを追加して再実行してください。",
      ].join(" ");
    return {
      newWikitext: input.currentWikitext,
      editSummary: summary || "（変更なし・見送り）",
      notesForHuman: refuseNotes,
      strategyUsed: "refuse",
      patchCount: 0,
    };
  }

  const emptyPage = !input.currentWikitext.trim();

  let strategy: "full" | "patch";
  if (emptyPage) {
    strategy = "full";
  } else if (parsed.strategy === "patch" && patches.length > 0) {
    strategy = "patch";
  } else if (parsed.strategy === "full") {
    strategy = "full";
  } else if (patches.length > 0 && !newWikitextRaw.trim()) {
    strategy = "patch";
  } else if (newWikitextRaw.length > 0) {
    strategy = "full";
  } else {
    throw new Error(
      "OpenAI 応答: strategy / newWikitext / patches のどれも有効な編集として解釈できませんでした"
    );
  }

  if (emptyPage) {
    if (!newWikitextRaw.trim()) {
      throw new Error("空ページでは newWikitext に本文が必要です");
    }
    return {
      newWikitext: finalize(newWikitextRaw),
      editSummary: summary,
      notesForHuman: notes,
      strategyUsed: "full",
      patchCount: 0,
    };
  }

  if (strategy === "patch") {
    try {
      const merged = applyWikitextPatches(input.currentWikitext, patches);
      return {
        newWikitext: finalize(merged),
        editSummary: summary,
        notesForHuman: [
          `[AI が部分編集を選択] パッチ ${patches.length} 件を適用しました。`,
          notes,
        ]
          .filter(Boolean)
          .join("\n"),
        strategyUsed: "patch",
        patchCount: patches.length,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`部分編集パッチの適用に失敗しました: ${msg}`);
    }
  }

  return {
    newWikitext: finalize(newWikitextRaw),
    editSummary: summary,
    notesForHuman: notes,
    strategyUsed: "full",
    patchCount: 0,
  };
}

/** JST の「今日」の日付（YYYY-MM-DD）。期間キーを付ける場合の参考用 */
function todayIsoDateInJst(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Yahoo!リアルタイム検索向けの検索語ルール（誤演算子防止用） */
const YAHOO_REALTIME_QUERY_RULES = [
  "あなたの出力は JSON のみ。キーは queries のみ（文字列の配列）。",
  '形式: {"queries":["検索語1","検索語2",...]}',
  "queries の各要素は、Yahoo!リアルタイム検索の **検索語 p** にそのまま渡す 1 行。説明文・解説・前置きは出さない。",
  "",
  "【包括的に拾う（重要）】",
  "- 各クエリは**短く広く**（だいたい 2〜6 語程度）。長い条件を詰め込んだクエリをたくさん並べない。",
  "- ページ名・トピックの**核になる語**（コミュニティ名・作品名・通称・「ヒカマー」など）を、**別の組み合わせ**で複数本出す。",
  "- 同じ事象の言い換え・細かい別名だけの羅列は避け、**角度の違う広い検索**を優先する。",
  "- **ページ名から取れる単語だけの短いクエリ**を必ず複数含める（例: ページ名が「A / B」なら「A」「B」「A B」のような広い検索）。",
  "- 特定ユーザーの投稿だけを見たいときは **ID:screen_name**（半角コロン）を使う。英数字だけの screen_name は **ID: を付けた形で**書く（例: ID:example_user）。",
  "",
  "【有効な構文例（間違いやすい点に注意）】",
  "- スペース区切り → AND（例: 語1 語2）",
  "- OR → (語A 語B) または 語A OR 語B",
  "- 除外 → -除外したい語（例: 話題 -スパム）",
  "- 特定ユーザーの投稿に絞る → ID:screen_name（半角コロン）。※ from: はここでは使わない（0件になりやすい）",
  "- 特定ユーザー宛の投稿 → @screen_name",
  "- ハッシュタグ → #タグ",
  "- リンクを含む投稿 → URL:ドメイン（前方一致、例: URL:yahoo.co.jp）",
  "- 期間 → since:YYYY-MM-DD / until:YYYY-MM-DD（任意。スペース区切りでキーワードと並べる。Unix 秒 10〜13 桁も可）。",
  "",
  "【方針】まずは広くヒットするキーワード（ページ名・指示・記事 wikitext のトピック）。",
  "ID: / @ / # で無闇に絞らない。指示で「そのアカウント／タグだけ見たい」と明示されているときだけ使う。",
  "期間が不要なら since:/until: を付けない。",
].join("\n");

export type TweetSearchBundleFromAi = {
  queries: string[];
};

function parseTweetSearchBundleJson(content: string): string[] | null {
  const trimmed = content.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const obj = parsed as { queries?: unknown };
  const q = obj.queries;
  if (!Array.isArray(q)) return null;
  return q
    .filter((x): x is string => typeof x === "string")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizeTweetQueriesList(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    const t = q.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** ページ名から短い・広い検索語を追加（AI の細かすぎるクエリを補完） */
export function broadQueriesFromWikiTitle(wikiTitle: string): string[] {
  const t = wikiTitle.trim();
  if (!t) return [];
  const out: string[] = [];
  if (t.length >= 2 && t.length <= 40) out.push(t);
  const parts = t
    .split(/[\s／/・|｜]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (p.length >= 2 && p.length <= 24) out.push(p);
  }
  return [...new Set(out)];
}

function formatBootstrapTweetsForQueryPrompt(tweets: TweetHit[]): string {
  return tweets
    .map((t, i) => {
      const u =
        t.displayName?.trim() || t.authorId?.trim() || "?";
      const body = (t.text ?? "").replace(/\s+/g, " ").trim();
      return `${i + 1}. ${u} — ${body}`;
    })
    .join("\n");
}

/**
 * Yahoo 用の検索語を推測する。期間は検索語内の since:/until: で指定する。
 * `bootstrapTweets` はページ名のみの検索で先に取ったツイート（任意）。
 */
export async function suggestTweetSearchBundle(
  instruction: string,
  wikiTitle: string,
  currentWikitext: string,
  streamOptions?: AiStreamOptions,
  bootstrapTweets?: TweetHit[]
): Promise<TweetSearchBundleFromAi> {
  let wikiBlock =
    currentWikitext.trim() || "（空・新規ページに近い）";
  const wikiMax = getQuerySuggestWikitextMaxChars();
  if (wikiBlock !== "（空・新規ページに近い）" && wikiBlock.length > wikiMax) {
    wikiBlock = `${wikiBlock.slice(0, wikiMax)}\n\n…（以下省略。検索クエリ推測用に先頭 ${wikiMax} 文字まで）`;
  }
  const today = todayIsoDateInJst();

  const userLines = [
    `ページ: ${wikiTitle}`,
    `【参考】今日の日付（JST）: ${today}（検索語に since: / until: を付ける場合）`,
    "",
    "【編集指示（人間）】",
    instruction,
    "",
    "【現在の記事 wikitext（検索クエリの参考。空ならページ名と指示のみで推測）】",
    "```wiki",
    wikiBlock,
    "```",
  ];

  if (bootstrapTweets && bootstrapTweets.length > 0) {
    const maxBt = getQueryBootstrapTweetMax();
    const slice = bootstrapTweets.slice(0, maxBt);
    const omitted =
      bootstrapTweets.length > maxBt
        ? `（HIKAMER_QUERY_BOOTSTRAP_TWEET_MAX=${maxBt} のため先頭 ${maxBt} 件のみ提示。取得済みは全 ${bootstrapTweets.length} 件）`
        : "";
    userLines.push(
      "",
      `【ページ名のみの検索で得た参考ツイート（検索クエリ案の材料。後続で他クエリも検索します）】${omitted}`,
      formatBootstrapTweetsForQueryPrompt(slice)
    );
  }

  const messages = [
    {
      role: "system" as const,
      content: YAHOO_REALTIME_QUERY_RULES,
    },
    {
      role: "user" as const,
      content: userLines.join("\n"),
    },
  ];

  const useStream =
    streamOptions?.onStreamDelta != null ||
    streamOptions?.onReasoningStreamDelta != null;

  const completion = useStream
    ? await chatCompletionStream(messages, {
        jsonObject: true,
        onDelta: streamOptions?.onStreamDelta ?? (() => {}),
        onReasoningDelta: streamOptions?.onReasoningStreamDelta,
        onAwaitingHttpResponse: streamOptions?.onAwaitingHttpResponse,
        onHttpResponseReady: streamOptions?.onHttpResponseReady,
      })
    : await chatCompletionNonStream(messages, {
        jsonObject: true,
        onAwaitingHttpResponse: streamOptions?.onAwaitingHttpResponse,
        onHttpResponseReady: streamOptions?.onHttpResponseReady,
      });
  streamOptions?.onTokenUsage?.(completion.usage);
  const content = completion.content;

  const fromJson = parseTweetSearchBundleJson(content);
  if (fromJson && fromJson.length > 0) {
    return {
      queries: normalizeTweetQueriesList(fromJson),
    };
  }

  const fallbackLine = content.trim().split(/\r?\n/)[0]?.trim() ?? "";
  if (fallbackLine.length > 0) {
    return {
      queries: normalizeTweetQueriesList([fallbackLine]),
    };
  }

  return {
    queries: normalizeTweetQueriesList([wikiTitle]),
  };
}

/**
 * Yahoo 用検索語のみが必要なとき（後方互換）。期間は捨てる。
 */
export async function suggestTweetQueries(
  instruction: string,
  wikiTitle: string,
  currentWikitext: string,
  streamOptions?: AiStreamOptions
): Promise<string[]> {
  const b = await suggestTweetSearchBundle(
    instruction,
    wikiTitle,
    currentWikitext,
    streamOptions
  );
  return b.queries;
}

export type FactCheckInput = ComposeInput & {
  /**
   * 空でページ全文を検証。
   * 指定時はこの抜粋を主に検証し、currentWikitext は文脈として添付する。
   */
  focusWikitext?: string;
};

async function buildFactCheckUserPrompt(
  input: FactCheckInput
): Promise<string> {
  const tweetBlock =
    input.tweets.length === 0
      ? "（参考ツイートは 0 件。）"
      : (await formatReferenceTweetsForPrompt(input.tweets)).prompt;

  const wikiHits = input.wikiSearchHits ?? [];
  const wikiBlock = formatWikiSearchHitsForPrompt(wikiHits);
  const yahooWebBlock = formatYahooWebSearchForPrompt(
    input.yahooWebSearchHits ?? []
  );

  const focus = input.focusWikitext?.trim();
  const targetSection = focus
    ? [
        "【検証の主対象（抜粋。ここに書かれた主張・事実を重点的に検証する）】",
        "```wiki",
        focus,
        "```",
        "",
        "【ページ全体の文脈（抜粋の前後関係の参考）】",
        "```wiki",
        input.currentWikitext || "（空）",
        "```",
      ].join("\n")
    : [
        "【検証対象（ページ全文の wikitext）】",
        "```wiki",
        input.currentWikitext || "（空）",
        "```",
      ].join("\n");

  return [
    `対象ページ名: ${input.wikiTitle}`,
    "",
    "【観点・補足（人間。任意）】",
    input.instruction,
    "",
    targetSection,
    "",
    "【Wiki 内検索で得た関連ページ（取得できた各ページの wikitext 全文）】",
    wikiBlock,
    "",
    "【Yahoo!ウェブ検索の結果（一般サイト・動画など。抜粋の鮮度・正確性は保証されない）】",
    yahooWebBlock,
    "",
    "【参考ツイート】",
    tweetBlock,
    "",
    "次のキーだけを持つ JSON オブジェクトのみ返す:",
    "- summary: 全体の要約（日本語・数文）。",
    '- items: 配列。各要素は { "claim": 検証した主張や文（日本語）, "verdict": "supported" | "weak" | "contradicted" | "unknown" のいずれか, "notes": 根拠・反証・保留理由（日本語）, "sources": 任意・文字列の配列（例: tweet:id, ページ名, URL） }。',
    "verdict: 参考ツイート・関連ページ本文・Yahoo ウェブ検索の抜粋で裏付けできるなら supported、弱いが矛盾しないなら weak、明確に矛盾するなら contradicted、材料不足なら unknown。",
    "ツイート・関連ページ・ウェブ検索にない断定は unknown や weak に寄せ、推測を事実と書かない。",
  ].join("\n");
}

function parseFactCheckJson(raw: string): FactCheckReport {
  const trimmed = raw.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("ファクトチェック応答の JSON を解析できませんでした");
    parsed = JSON.parse(m[0]);
  }
  const o = parsed as {
    summary?: unknown;
    items?: unknown;
  };
  const summary = typeof o.summary === "string" ? o.summary : "";
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items: FactCheckItem[] = [];
  for (const row of itemsRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const claim = typeof r.claim === "string" ? r.claim : "";
    const verdictRaw = typeof r.verdict === "string" ? r.verdict : "";
    const notes = typeof r.notes === "string" ? r.notes : "";
    const v =
      verdictRaw === "supported" ||
      verdictRaw === "weak" ||
      verdictRaw === "contradicted" ||
      verdictRaw === "unknown"
        ? verdictRaw
        : "unknown";
    const sources = Array.isArray(r.sources)
      ? r.sources.filter((x): x is string => typeof x === "string")
      : undefined;
    if (claim.trim()) {
      items.push({
        claim: claim.trim(),
        verdict: v,
        notes: notes.trim() || "（補足なし）",
        ...(sources && sources.length > 0 ? { sources } : {}),
      });
    }
  }
  return {
    summary: summary.trim() || "（要約なし）",
    items,
  };
}

/**
 * 参考ツイート・Wiki 内検索関連ページの本文を踏まえ、wikitext の事実性を JSON で返す（Wiki は更新しない）。
 */
export async function factCheckWithOpenAI(
  input: FactCheckInput,
  streamOptions?: AiStreamOptions
): Promise<FactCheckReport> {
  const userContent = await buildFactCheckUserPrompt(input);
  const messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }> = [
    {
      role: "system",
      content:
        "あなたはファクトチェッカーです。与えられた wikitext（全文または抜粋）について、参考ツイートと Wiki 内検索で得た関連ページ本文（取得できたもの）を根拠に、主張ごとに検証する。JSON 以外は出力しない。推測で事実を断定しない。",
    },
    { role: "user", content: userContent },
  ];

  const useStream =
    streamOptions?.onStreamDelta != null ||
    streamOptions?.onReasoningStreamDelta != null;

  const completion = useStream
    ? await chatCompletionStream(messages, {
        models: OPENAI_MODELS,
        jsonObject: true,
        onDelta: streamOptions?.onStreamDelta ?? (() => {}),
        onReasoningDelta: streamOptions?.onReasoningStreamDelta,
        onAwaitingHttpResponse: streamOptions?.onAwaitingHttpResponse,
        onHttpResponseReady: streamOptions?.onHttpResponseReady,
      })
    : await chatCompletionNonStream(messages, {
        models: OPENAI_MODELS,
        jsonObject: true,
        onAwaitingHttpResponse: streamOptions?.onAwaitingHttpResponse,
        onHttpResponseReady: streamOptions?.onHttpResponseReady,
      });
  streamOptions?.onTokenUsage?.(completion.usage);
  const content = completion.content;

  return parseFactCheckJson(content);
}
