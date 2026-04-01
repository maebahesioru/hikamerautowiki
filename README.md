# ヒカマーwiki 自動編集アシスタント

[ヒカマーwiki](https://hikamers.net/wiki/) の記事を、人の指示と **Yahoo リアルタイム検索**および（任意で）**PostgreSQL の `tweets` テーブル**から取ったツイートを踏まえて AI が wikitext を生成・投稿するためのツールです。

## 技術スタック

- React / Next.js（App Router）/ TypeScript / Tailwind CSS
- パッケージ管理: `pnpm`

## 全体の流れ

1. **フォームから実行**  
   **Wiki** はキーワードで **ページを検索**し、一覧から選ぶ。あわせて **追記・修正の指示** を入力し、**「提案して Wiki に反映」** を押す。`POST /api/run` が **その場でパイプラインを実行**し（提案の永続保存はしない）、**MediaWiki に投稿**する（要 `WIKI_USERNAME` / `WIKI_PASSWORD`）。**ツイート検索のキーワード**は **AI が指示・記事本文から推測**する。取得**期間**は **任意**で、**検索語に `since:` / `until:`（yahoo-realtime-api.md のクエリ演算子）** を含めない限り期間で絞らない。リクエストに手動日付（`tweetSince` / `tweetUntil`）があるときは **それが優先**。期間を付けたときは **DB と Yahoo** の両方に適用される。

2. **パイプラインの中身**  
   - MediaWiki API で対象ページの **現在の wikitext を取得**（匿名・閲覧可能な記事のみ想定）。  
   - 検索クエリが空なら **AI がクエリを推測**（詳細は下記「空欄時の検索クエリ推測」）。  
   - **検索の並列度**: ページ名の Wiki 検索は 1 本。各ツイート検索クエリは **`HIKAMER_SEARCH_CONCURRENCY`（既定 2）** 件ずつバッチ処理し、バッチ内では各クエリごとに **DB / Wiki 内検索 / Yahoo** を同時に呼ぶ（以前はクエリを全部同時に走らせて Postgres の接続タイムアウトや `fetch failed` が出やすかった）。**マージ時の優先度**（同一ツイート ID）は **DB → Yahoo**。Wiki は関連ページスニペット用でツイートとは別。  
   - **`DATABASE_URL` があれば**、別系統の **Postgres `tweets` テーブル**（`新しいフォルダー` と同じ想定）からも同じ検索クエリで取得（**古い順**、件数は合計上限の範囲内）。**Yahoo リアルタイム検索 API**（`start` 並列・最大 10000 件相当）でもツイートを取得。**ツイート ID が重複する場合は DB を優先してマージ**し、**DB + Yahoo 合わせて最大 10000 件**（`HIKAMER_TOTAL_TWEET_LIMIT`）に切り詰め。期間を付けたときは、API の `since` / `until`（Unix 秒）と DB の `created_at` の両方で絞り込む（`src/lib/tweetSearchDateRange.ts`）。  
   - **OpenAI 互換 API** で、指示・既存記事・ツイートを踏まえて編集内容を生成（全文再出力か部分パッチかは **AI が 1 回の JSON 応答で選ぶ**。下記「全文と部分（パッチ）」）。  
   - **反映**のときだけ **MediaWiki API にログイン**し、**`action=edit` の `text` にページ全文**を渡して更新する（API 上は常に本文の置換）。

### AI によるツイート検索クエリ（期間は検索語の since:/until:）

パイプラインは **`src/lib/ai.ts` の `suggestTweetSearchBundle`** を呼びます。

- **いつ:** `tweetQuery` が空のとき。人が `tweetQuery` を入れている場合は **そのまま**（検索語に `since:`/`until:` を自分で書ける）。提案に手動の `tweetSince`/`tweetUntil` がある場合は **期間は proposal 優先**（検索語の `since:`/`until:` は除去されるが、フィルタは手動日付のみ）。  
- **JSON:** **`queries` のみ**（文字列の配列）。期間は **JSON ではなく検索語文字列内**の **`since:YYYY-MM-DD` / `until:YYYY-MM-DD`**（`yahoo-realtime-api.md` のクエリ演算子）。  
- **どう推測するか:** OpenAI 互換 API への **通常のチャット補完**（メインの wikitext 生成とは **別リクエスト**）。  
  - **システムプロンプト:** 公式ヘルプにリンクし、同リポジトリの **クエリ演算子**（AND / OR / `-` / `ID:` / `@` / `#` / `URL:` / **`since:` / `until:`**）に揃える。  
  - **サーバー:** `src/lib/yahooQuerySinceUntil.ts` が検索語から `since:`/`until:` を取り除き、Yahoo の HTTP `since`/`until` と DB `created_at` に反映する。

つまり「推測」は **ヒューリスティックなルールベースではなく、上記プロンプトに従った LLM の出力**である。

### 全文と部分（パッチ）（AI が自動選択）

`composeWikitextWithOpenAI`（`src/lib/ai.ts`）は **1 回の**チャット補完で、JSON に **`strategy`: `"full"` または `"patch"`** を含めさせ、サーバーが解釈する。

| strategy | 意味 | Wiki への保存 |
|----------|------|----------------|
| **full** | `newWikitext` に編集後の**ページ全文** | その文字列を `action=edit` の `text` に渡す |
| **patch** | `patches: [{ oldText, newText }, ...]` のみ（`newWikitext` は空でよい） | **`applyWikitextPatches`**（`src/lib/wikitextPatch.ts`）で現在の wikitext に順に適用した結果を `text` に渡す |

- 空ページでは **必ず full**（プロンプトで指示）。  
- モデルが patch を選んでも `oldText` が一意に一致しなければ **エラー**になる。  
- 実行サマリー先頭に **「AI 編集: 全文」** または **「AI 編集: 部分（パッチ n 件）」** と出る。

## 環境変数

`.env.example` を参考に `.env.local` などを用意する。

- **必須（AI）:** `OPENAI_API_KEY`（必要なら `OPENAI_API_BASE`）  
- **反映時のみ:** `WIKI_USERNAME` / `WIKI_PASSWORD`  
- **任意:** Yahoo 用 `YAHOO_REALTIME_USER_AGENT` / `YAHOO_REALTIME_REFERER`、モデル固定 `OPENAI_MODEL`  
- **任意（DB ツイート）:** `DATABASE_URL`（未設定なら DB はスキップ）  
- **任意:** `HIKAMER_TOTAL_TWEET_LIMIT`（Yahoo+DB マージ後の合計上限、既定 10000）
- **任意:** `HIKAMER_SEARCH_CONCURRENCY`（検索クエリの同時実行数、既定 2。リモート DB が遅いときは 1 に下げる）
- **任意（SEO）:** `NEXT_PUBLIC_SITE_URL`（本番のサイト origin。OG・canonical・`sitemap.xml` / `robots.txt` の絶対 URL に使う。未設定時はビルド時に `http://localhost:3000` が使われる）

## 開発

```bash
pnpm install
pnpm dev
```

ブラウザで [http://localhost:3000](http://localhost:3000) を開く。

```bash
pnpm build
pnpm start
```

## 補足

- ツイート取得の API 仕様メモはリポジトリ内 `yahoo-realtime-api.md` を参照。  
- AI のモデル優先順・互換 API の挙動は `src/lib/openaiCompat.ts` を参照。  
- DB 検索の実装は `src/lib/tweetsDb.ts` を参照。
