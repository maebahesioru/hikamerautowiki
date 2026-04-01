import { NextResponse } from "next/server";
import { z } from "zod";
import {
  editWikiPage,
  mediaWikiLogin,
  wikiTitlesLooselyEqual,
} from "@/lib/mediawiki";
import { validateWikiWriteEnv } from "@/lib/serverEnv";

function apiUrl(): string {
  return process.env.WIKI_API_URL?.trim() || "https://hikamers.net/api.php";
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`環境変数 ${name} が未設定です`);
  }
  return v;
}

const bodySchema = z.object({
  sourceTitle: z.string().min(1, "移動元のページ名を入力してください"),
  targetTitle: z.string().min(1, "移動先を検索して選んでください"),
});

export async function POST(req: Request) {
  let json: unknown;
  try {
    const t = await req.text();
    if (!t) {
      return NextResponse.json({ error: "JSON ボディが空です" }, { status: 400 });
    }
    json = JSON.parse(t);
  } catch {
    return NextResponse.json({ error: "JSON が不正です" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  const envErr = validateWikiWriteEnv();
  if (envErr) return envErr;

  const sourceTitle = parsed.data.sourceTitle.trim();
  const targetTitle = parsed.data.targetTitle.trim();

  if (wikiTitlesLooselyEqual(sourceTitle, targetTitle)) {
    return NextResponse.json(
      { error: "移動元と移動先が同じです" },
      { status: 400 }
    );
  }

  if (/[\[\]\n\r]/.test(targetTitle)) {
    return NextResponse.json(
      { error: "移動先のページ名に使えない文字が含まれています" },
      { status: 400 }
    );
  }

  const text = `#REDIRECT [[${targetTitle}]]`;
  const summary = `リダイレクト → [[${targetTitle}]]`;

  try {
    const api = apiUrl();
    const wikiUser = requireEnv("WIKI_USERNAME");
    const wikiPass = requireEnv("WIKI_PASSWORD");
    const { jar, csrfToken } = await mediaWikiLogin(api, wikiUser, wikiPass);
    await editWikiPage(api, jar, csrfToken, sourceTitle, text, summary);
    return NextResponse.json({
      ok: true,
      sourceTitle,
      targetTitle,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
