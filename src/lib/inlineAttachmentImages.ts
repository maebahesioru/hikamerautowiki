/**
 * フォームから送られた画像を MediaWiki にアップロードし、AI が [[File:...]] で参照できるようにする。
 */

import { createHash } from "node:crypto";

import {
  MAX_INLINE_ATTACHMENTS,
  MAX_INLINE_IMAGE_BYTES,
} from "@/lib/inlineAttachmentLimits";
import { uploadFileToMediaWiki } from "@/lib/mediawiki";

export { MAX_INLINE_ATTACHMENTS, MAX_INLINE_IMAGE_BYTES } from "@/lib/inlineAttachmentLimits";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type RawAttachedImageInput = {
  name: string;
  dataBase64: string;
  mimeType: string;
};

export type DecodedInlineAttachment = {
  originalName: string;
  data: Uint8Array;
  mimeType: string;
};

export type PreUploadedWikiFile = {
  wikiFilename: string;
  originalName: string;
};

function safeOriginalName(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? "image";
  const t = base.trim();
  return t.length > 0 ? t.slice(0, 120) : "image.png";
}

function sanitizeStem(s: string): string {
  const noExt = s.replace(/\.[^.]+$/, "");
  const t = noExt.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  return t.length > 0 ? (t.length > 80 ? t.slice(0, 80) : t) : "img";
}

function extFromFilenameAndMime(filename: string, mimeType: string): string {
  const m = filename.match(/\.(jpe?g|png|gif|webp)$/i);
  if (m) return m[0].toLowerCase();
  const ct = mimeType.toLowerCase();
  if (ct.includes("jpeg") || ct === "image/jpg") return ".jpg";
  if (ct.includes("png")) return ".png";
  if (ct.includes("webp")) return ".webp";
  if (ct.includes("gif")) return ".gif";
  return ".jpg";
}

export function predictInlineWikiFilename(
  data: Uint8Array,
  originalName: string,
  mimeType: string
): string {
  const name = safeOriginalName(originalName);
  const stem = sanitizeStem(name);
  const ext = extFromFilenameAndMime(name, mimeType);
  const hash = createHash("sha256")
    .update(Buffer.from(data))
    .digest("hex")
    .slice(0, 8);
  return `Hikamer_inline_${hash}_${stem}${ext}`;
}

function inferMimeFromFilename(filename: string): string | undefined {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return undefined;
}

function normalizeMime(raw: string, filenameForFallback: string): string {
  const t = raw.trim().toLowerCase();
  if (ALLOWED_MIME.has(t)) return t;
  if (t === "" || t === "application/octet-stream") {
    const inferred = inferMimeFromFilename(filenameForFallback);
    if (inferred) return inferred;
  }
  throw new Error(`未対応の画像形式です（${raw}）。JPEG / PNG / WebP / GIF のみ`);
}

/**
 * API 受信直後に呼ぶ。件数・サイズ・MIME・base64 を検証する。
 */
export function decodeAndValidateAttachedImages(
  items: RawAttachedImageInput[]
): DecodedInlineAttachment[] {
  if (items.length === 0) return [];
  if (items.length > MAX_INLINE_ATTACHMENTS) {
    throw new Error(
      `添付画像は最大 ${MAX_INLINE_ATTACHMENTS} 枚までです（${items.length} 枚）`
    );
  }
  const out: DecodedInlineAttachment[] = [];
  for (const item of items) {
    const name = typeof item.name === "string" ? item.name : "";
    if (!name.trim()) {
      throw new Error("添付画像にファイル名がありません");
    }
    const safeName = safeOriginalName(name);
    const mimeType = normalizeMime(item.mimeType ?? "", safeName);
    let buf: Buffer;
    try {
      buf = Buffer.from(item.dataBase64 ?? "", "base64");
    } catch {
      throw new Error("添付画像の base64 が不正です");
    }
    if (buf.length === 0) {
      throw new Error(`空の画像です: ${safeOriginalName(name)}`);
    }
    if (buf.length > MAX_INLINE_IMAGE_BYTES) {
      throw new Error(
        `画像が大きすぎます（${safeName}、最大 ${MAX_INLINE_IMAGE_BYTES} バイト）`
      );
    }
    out.push({
      originalName: safeName,
      data: new Uint8Array(buf),
      mimeType,
    });
  }
  return out;
}

/**
 * ログイン済みセッションでフォーム添付を Wiki に送る。
 */
export async function uploadInlineAttachmentsToWiki(
  apiUrl: string,
  jar: Map<string, string>,
  csrfToken: string,
  items: readonly DecodedInlineAttachment[],
  options?: { onProgress?: (m: string) => void }
): Promise<PreUploadedWikiFile[]> {
  const out: PreUploadedWikiFile[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const filename = predictInlineWikiFilename(
      it.data,
      it.originalName,
      it.mimeType
    );
    options?.onProgress?.(
      `添付画像をアップロード中 (${i + 1}/${items.length}): ${filename}`
    );
    const up = await uploadFileToMediaWiki(apiUrl, jar, csrfToken, {
      filename,
      data: it.data,
      contentType: it.mimeType,
      comment: "Hikamer autowiki: フォーム添付画像",
    });
    out.push({
      wikiFilename: up.filename,
      originalName: it.originalName,
    });
  }
  return out;
}
