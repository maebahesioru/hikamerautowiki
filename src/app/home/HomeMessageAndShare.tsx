import { buildXShareText, openXShareIntent } from "@/app/home/homeWikiShare";
import type { ShareSnapshot } from "@/app/home/homeTypes";

type Props = {
  message: string | null;
  shareSnapshot: ShareSnapshot | null;
  shareCopyHint: string | null;
  onCopyShareText: () => void;
  onCloseShare: () => void;
};

export function HomeMessageAndShare({
  message,
  shareSnapshot,
  shareCopyHint,
  onCopyShareText,
  onCloseShare,
}: Props) {
  return (
    <>
      {message ? (
        <div
          className="mb-6 whitespace-pre-wrap rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
          role="status"
        >
          {message}
        </div>
      ) : null}

      {shareSnapshot ? (
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900/50">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-zinc-600 dark:text-zinc-400">
              今の結果をポストする:
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
              onClick={() => void onCopyShareText()}
            >
              コピー
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
              onClick={() =>
                openXShareIntent(buildXShareText(shareSnapshot))
              }
            >
              <span aria-hidden>𝕏</span>
              で共有
            </button>
            <button
              type="button"
              className="text-xs text-zinc-500 underline decoration-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              onClick={onCloseShare}
            >
              閉じる
            </button>
          </div>
          <div
            role="region"
            aria-label="共有する投稿文のプレビュー"
            className="mt-3 rounded-md border border-dashed border-zinc-200 bg-zinc-50/80 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-950/50"
          >
            <p className="mb-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              プレビュー（intent URL は長いと本文が切れることがあるため、必要ならコピーしてから貼ってください）
            </p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-zinc-800 dark:text-zinc-200">
              {buildXShareText(shareSnapshot)}
            </pre>
          </div>
          {shareCopyHint ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-2 text-xs text-emerald-700 dark:text-emerald-400"
            >
              {shareCopyHint}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
