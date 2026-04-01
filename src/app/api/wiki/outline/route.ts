import { NextResponse } from "next/server";
import { fetchWikiWikitextPublic } from "@/lib/mediawiki";
import type { WikiOutlineSection } from "@/lib/wikitextSections";
import { parseWikiSectionOutline } from "@/lib/wikitextSections";

function apiUrl(): string {
  return (
    process.env.WIKI_API_URL?.trim() || "https://hikamers.net/api.php"
  );
}

export async function GET(req: Request) {
  const title = new URL(req.url).searchParams.get("title")?.trim() ?? "";
  if (!title) {
    return NextResponse.json(
      { error: "クエリ title（ページ名）が必要です" },
      { status: 400 }
    );
  }

  try {
    const rev = await fetchWikiWikitextPublic(apiUrl(), title);
    if (rev.missing) {
      return NextResponse.json({
        ok: true,
        title: rev.title,
        missing: true,
        sections: [] as WikiOutlineSection[],
      });
    }
    const sections = parseWikiSectionOutline(rev.wikitext);
    return NextResponse.json({
      ok: true,
      title: rev.title,
      missing: false,
      sections,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
