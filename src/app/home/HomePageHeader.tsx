import Link from "next/link";

export function HomePageHeader() {
  return (
    <header className="mb-10 border-b border-zinc-200 pb-6 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">
          ヒカマーwiki 自動編集アシスタント
        </p>
        <Link
          href="/help"
          className="text-sm font-medium text-emerald-800 underline decoration-emerald-700/30 underline-offset-2 hover:decoration-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200"
        >
          使い方（ヘルプ）
        </Link>
      </div>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
        提案 → ツイート検索 → AI が記事を更新
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
        ページ名と指示を入力します。AI が{" "}
        <a
          className="text-emerald-700 underline decoration-emerald-700/30 underline-offset-2 hover:decoration-emerald-700 dark:text-emerald-400"
          href="https://hikamers.net/wiki/"
          target="_blank"
          rel="noreferrer"
        >
          ヒカマーwiki
        </a>{" "}
        の該当記事を読み、指示に合わせて Yahoo
        リアルタイム検索のクエリを自動で決め（取得期間は任意）、取得したツイートを参考に wikitext
        を生成します。「提案して Wiki に反映」でそのまま投稿します。
      </p>
    </header>
  );
}
