"use client";

export function HomeDevTodoSection() {
  return (
        <section
          className="mt-10 pb-2"
          aria-labelledby="site-todo-heading"
        >
          <h2
            id="site-todo-heading"
            className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
          >
            開発 TODO（予定）
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-zinc-600 dark:text-zinc-400">
            <li>
              <span className="block text-zinc-700 dark:text-zinc-300">
                Discord鯖 の会話等も拾えるようにする
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                Bot を作って権限・履歴取得などを試し、実際に拾えるか検証する想定。
              </span>
            </li>
            <li>
              <span className="block text-zinc-700 dark:text-zinc-300">
                DM グループのチャット等も拾えるようにする
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                現状、まともな方法は多分ない、など。
              </span>
            </li>
            <li>
              <span className="block text-zinc-700 dark:text-zinc-300">
                X のスペースの内容も拾えるようにする
              </span>
              <span className="mt-1 block text-xs leading-relaxed text-zinc-500 dark:text-zinc-500">
                定期的に録音が公開されているものを掘り当て、ローカル Whisper で文字起こしして自鯖 DB などに保存する、といったルートならギリ現実的かもしれない、など。
              </span>
            </li>
          </ul>
        </section>
  );
}
