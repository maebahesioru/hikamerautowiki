import { readFileSync } from "fs";
import { join } from "path";

/**
 * 新規記事作成時に AI に渡す体裁サンプル。`public/wikitemp.txt` を全文読む。
 * 読めないときは空文字。
 */
export function loadWikitempForPrompt(): string {
  const path = join(process.cwd(), "public", "wikitemp.txt");
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}
