import { NextResponse } from "next/server";
import { searchWikiPages } from "@/lib/mediawiki";

function apiUrl(): string {
  return (
    process.env.WIKI_API_URL?.trim() || "https://hikamers.net/api.php"
  );
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ results: [] as { title: string; snippet?: string }[] });
  }
  try {
    /** UI では件数を多めに（サブページ名の部分一致は複数クエリマージ後に必要） */
    const results = await searchWikiPages(apiUrl(), q, 50);
    return NextResponse.json({ results });
  } catch (e) {
    const msg =
      e instanceof Error && e.name === "AbortError"
        ? "Wiki 検索がタイムアウトしました（応答がありません）。しばらくしてから再試行してください。"
        : e instanceof Error
          ? e.message
          : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
