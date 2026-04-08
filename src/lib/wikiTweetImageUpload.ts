/**
 * wikitext 内の pbs.twimg.com 画像 URL をダウンロードし、Wiki にアップロードして
 * [[File:...]] または Infobox の | image = ファイル名 に差し替える。
 */

import { createHash } from "node:crypto";

import { fetchWithRetry } from "@/lib/httpRetry";
import { uploadFileToMediaWiki } from "@/lib/mediawiki";

const MAX_BYTES = 10 * 1024 * 1024;

const TWIMG_URL_RE =
  /https:\/\/pbs\.twimg\.com\/[a-zA-Z0-9_./?=&%#+-]+/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** wikitext から pbs.twimg.com の URL を重複なく抽出（長い順） */
export function extractPbsTwimgUrls(wikitext: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  TWIMG_URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TWIMG_URL_RE.exec(wikitext)) !== null) {
    let u = m[0];
    while (u.endsWith(")") || u.endsWith("]") || u.endsWith("}")) {
      u = u.slice(0, -1);
    }
    if (seen.has(u)) continue;
    seen.add(u);
    found.push(u);
  }
  return found.sort((a, b) => b.length - a.length);
}

function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

function sanitizeMwStem(s: string): string {
  const t = s.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return t.length > 80 ? t.slice(0, 80) : t;
}

function extFromPathOrType(pathname: string, contentType: string): string {
  const m = pathname.match(/\.(jpe?g|png|gif|webp)$/i);
  if (m) return m[0].toLowerCase();
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return ".jpg";
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  return ".jpg";
}

function basenameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const seg = path.split("/").filter(Boolean).pop() ?? "image";
    return seg.split("?")[0] || "image.jpg";
  } catch {
    return "image.jpg";
  }
}

async function downloadTwimg(url: string): Promise<{
  data: Uint8Array;
  contentType: string;
}> {
  const r = await fetchWithRetry(url, {
    headers: {
      Accept: "image/*,*/*",
      "User-Agent":
        process.env.HIKAMER_TWIMG_DOWNLOAD_USER_AGENT ??
        "hikamerautowiki/0.1 (tweet image upload)",
    },
    cache: "no-store",
  });
  if (!r.ok) {
    throw new Error(`GET ${url.slice(0, 80)}… → HTTP ${r.status}`);
  }
  const ct = r.headers.get("content-type") ?? "application/octet-stream";
  if (!ct.toLowerCase().startsWith("image/")) {
    throw new Error(`画像ではない Content-Type: ${ct}`);
  }
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > MAX_BYTES) {
    throw new Error(`サイズ超過（${buf.length} bytes > ${MAX_BYTES}）`);
  }
  if (buf.length === 0) {
    throw new Error("空のレスポンス");
  }
  return { data: buf, contentType: ct };
}

/**
 * 本文中の pbs.twimg.com URL を Wiki にアップロードし、wikitext を置換する。
 * `HIKAMER_UPLOAD_TWIMG=0` で無効。
 */
export async function uploadPbsTwimgUrlsInWikitext(
  apiUrl: string,
  jar: Map<string, string>,
  csrfToken: string,
  wikitext: string,
  options?: { onProgress?: (m: string) => void }
): Promise<string> {
  if (process.env.HIKAMER_UPLOAD_TWIMG === "0" || !wikitext) {
    return wikitext;
  }

  const urls = extractPbsTwimgUrls(wikitext);
  if (urls.length === 0) return wikitext;

  let out = wikitext;

  for (const url of urls) {
    const esc = escapeRegExp(url);
    if (!out.includes(url)) continue;

    let uploadedName: string;
    try {
      options?.onProgress?.(`画像を取得・アップロード中: ${url.slice(0, 72)}…`);
      const { data, contentType } = await downloadTwimg(url);
      const base = basenameFromUrl(url);
      const stem = sanitizeMwStem(base.replace(/\.[^.]+$/, "") || "img");
      const ext = extFromPathOrType(base, contentType);
      const filename = `Hikamer_${shortHash(url)}_${stem}${ext}`;
      const up = await uploadFileToMediaWiki(apiUrl, jar, csrfToken, {
        filename,
        data,
        contentType,
      });
      uploadedName = up.filename;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      options?.onProgress?.(`画像アップロードをスキップ（元 URL のまま）: ${msg}`);
      continue;
    }

    out = out.replace(
      new RegExp(`(\\|\\s*image\\s*=\\s*)${esc}`, "gi"),
      `$1${uploadedName}`
    );

    if (out.includes(url)) {
      out = out.split(url).join(`[[File:${uploadedName}|250px]]`);
    }
  }

  return out;
}
