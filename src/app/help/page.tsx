import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

const desc =
  "ヒカマーwiki 自動編集アシスタントの初めての方向けガイド。記事編集・新規記事・ファクトチェック・リダイレクトの使い方を順に説明します。";

export const metadata: Metadata = {
  title: "使い方",
  description: desc,
  openGraph: {
    title: "使い方 | ヒカマーwiki 自動編集",
    description: desc,
  },
};

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 border-b border-zinc-200 pb-8 last:border-0 dark:border-zinc-800"
    >
      <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </section>
  );
}

export default function HelpPage() {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <header className="mb-10 border-b border-zinc-200 pb-6 dark:border-zinc-800">
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <Link
              href="/"
              className="underline decoration-emerald-700/30 underline-offset-2 hover:decoration-emerald-700"
            >
              トップに戻る
            </Link>
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            使い方（はじめての方へ）
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            {desc}
          </p>
        </header>

        <nav
          aria-label="このページ内"
          className="mb-10 rounded-xl border border-zinc-200 bg-white p-4 text-sm shadow-sm dark:border-zinc-800 dark:bg-zinc-900/40"
        >
          <p className="mb-2 font-medium text-zinc-800 dark:text-zinc-200">
            目次
          </p>
          <ol className="list-decimal space-y-1.5 pl-5 text-zinc-700 dark:text-zinc-300">
            <li>
              <a href="#what" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                このツールでできること
              </a>
            </li>
            <li>
              <a href="#flow" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                基本的な流れ
              </a>
            </li>
            <li>
              <a href="#modes" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                作業モード（4 種類）
              </a>
            </li>
            <li>
              <a href="#wiki-search" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                Wiki ページの選び方
              </a>
            </li>
            <li>
              <a href="#instruction" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                指示の書き方
              </a>
            </li>
            <li>
              <a href="#tweets" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                ツイート検索と AI
              </a>
            </li>
            <li>
              <a href="#running" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                実行中の画面
              </a>
            </li>
            <li>
              <a href="#after" className="text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400">
                終わったあと（ログ・共有）
              </a>
            </li>
          </ol>
        </nav>

        <article className="space-y-10">
          <Section id="what" title="1. このツールでできること">
            <p>
              このサイトは、{" "}
              <a
                href="https://hikamers.net/wiki/"
                target="_blank"
                rel="noreferrer"
                className="text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
              >
                ヒカマーwiki
              </a>{" "}
              の記事を、あなたの「指示」と、Yahoo リアルタイム検索や（サーバーに設定があれば）データベースに蓄積されたツイートを材料に、AI が
              wikitext を書き換え提案し、承認の流れで Wiki に投稿するための補助ツールです。
            </p>
            <p>
              ブラウザからフォームを送るだけで動きます。提案の保存やアカウント登録はこの画面にはありません（実行はその場でサーバーが処理します）。
            </p>
          </Section>

          <Section id="flow" title="2. 基本的な流れ">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                トップで<strong>作業モード</strong>を選ぶ（次節）。
              </li>
              <li>
                <strong>編集したい Wiki のページ</strong>を、キーワード検索して一覧から選ぶ（新規記事モードでは種類とページ名を入力）。
              </li>
              <li>
                <strong>指示</strong>を書く（追記・修正の内容、ファクトチェックの観点など）。
              </li>
              <li>
                実行ボタンを押すと、サーバーが Wiki 本文の取得 → ツイート検索 → AI
                による文章生成 →（編集・新規なら）Wiki への反映、までを進めます。
              </li>
            </ol>
            <p className="text-zinc-600 dark:text-zinc-400">
              Wiki への実際の書き込みには、サーバー側に Bot 用のログイン情報が設定されている必要があります。未設定の環境ではエラーになることがあります。
            </p>
          </Section>

          <Section id="modes" title="3. 作業モード（4 種類）">
            <dl className="space-y-4">
              <div>
                <dt className="font-medium text-zinc-900 dark:text-zinc-100">
                  記事を編集
                </dt>
                <dd className="mt-1 pl-0 text-zinc-700 dark:text-zinc-300">
                  既存ページを選び、指示どおり追記・修正します。メインの利用想定です。
                </dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-900 dark:text-zinc-100">
                  新規記事
                </dt>
                <dd className="mt-1 pl-0 text-zinc-700 dark:text-zinc-300">
                  人物向けでは「ヒカマーwiki:チラシの裏/」配下に作る前提の入力になります。指定したタイトルに<strong>既に本文があるページ</strong>では実行できません（誤上書き防止）。
                </dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-900 dark:text-zinc-100">
                  ファクトチェック
                </dt>
                <dd className="mt-1 pl-0 text-zinc-700 dark:text-zinc-300">
                  Wiki の本文は更新せず、ツイート・関連ページと照らして検証結果だけを返します。見出し（
                  <code className="rounded bg-zinc-200/80 px-1 text-xs dark:bg-zinc-800">
                    == 見出し ==
                  </code>
                  ）がある記事では、節単位に検証範囲を絞れます。
                </dd>
              </div>
              <div>
                <dt className="font-medium text-zinc-900 dark:text-zinc-100">
                  リダイレクト
                </dt>
                <dd className="mt-1 pl-0 text-zinc-700 dark:text-zinc-300">
                  AI は使わず、移動元ページから移動先ページへのリダイレクトだけを作成します。移動先は検索して選びます。
                </dd>
              </div>
            </dl>
          </Section>

          <Section id="wiki-search" title="4. Wiki ページの選び方">
            <p>
              「記事を編集」「ファクトチェック」では、キーワードを入れて「ページを検索」を押すと、ヒカマーwiki 内の検索結果が一覧表示されます。編集したい行をクリックすると、そのページ名が選択状態になります。
            </p>
            <p>
              新規記事では検索は使わず、種類（人物かそれ以外か）とページ名を自分で入力します。
            </p>
          </Section>

          <Section id="instruction" title="5. 指示の書き方">
            <p>
              <strong>記事を編集</strong>では、どの段落に何を足すか、時事の要約、トーンなど、人間が編集者に頼むときのように書けます。空に近い指示でも動きますが、具体的なほど意図に沿いやすいです。
            </p>
            <p>
              <strong>新規記事</strong>では指示は任意です。章立てや出典の付け方の希望を書いてもよいです。
            </p>
            <p>
              <strong>ファクトチェック</strong>では「どの主張を重点的に見るか」などの観点を書けます。空でも実行できます。
            </p>
          </Section>

          <Section id="tweets" title="6. ツイート検索と AI">
            <p>
              ツイート検索用のキーワードを<strong>フォームに書いていない場合</strong>、サーバー上の
              AI が、あなたの指示と Wiki の現在の本文などから検索クエリを複数行にわたって生成します（進行状況に表示されます）。
            </p>
            <p>
              取得したツイートは、Yahoo リアルタイム検索と（設定されている場合）データベースの両方からマージされ、同じツイート
              ID はデータベース側を優先してフィールドを統合します。データベース側は検索条件に合う行を<strong>件数上限なしで</strong>読み込みます（大量ヒット時は時間・メモリに注意）。最終的に AI に渡す件数には上限があり、上限を超える場合は<strong>データベース由来のツイートを先に残し</strong>、その範囲内では<strong>ランダムな順</strong>で切り詰めます（実行のたびに順序は変わります）。
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">
              検索語に日付を含める高度な書き方や、手動の期間指定は API・サーバー設定向けの機能です。通常は画面の指示と AI
              のクエリ生成だけで利用できます。
            </p>
          </Section>

          <Section id="running" title="7. 実行中の画面">
            <p>
              処理には時間がかかることがあります。進行状況の一覧が順に増え、AI
              がストリーミング出力に対応している場合は、検索クエリの生成や wikitext
              の編集内容が途中から表示されることがあります。
            </p>
            <p>
              「停止」でリクエストを打ち切れます。タブを閉じると途中経過が失われる場合があります。
            </p>
          </Section>

          <Section id="after" title="8. 終わったあと（ログ・共有）">
            <p>
              編集・新規の実行後は、直近の実行ログに使った検索クエリやツイート件数などが表示されます。
            </p>
            <p>
              成功すると、X（旧 Twitter）に投稿用の文をコピーしたり、意図 URL
              で開いたりできることがあります。
            </p>
            <p>
              実行履歴は、このブラウザの localStorage
              に保存される一覧です（編集反映などが成功したときだけ記録）。別の端末やブラウザとは共有されません。
            </p>
          </Section>
        </article>

        <p className="mt-12 text-center text-sm text-zinc-500 dark:text-zinc-400">
          <Link
            href="/"
            className="text-emerald-700 underline underline-offset-2 dark:text-emerald-400"
          >
            トップへ戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
