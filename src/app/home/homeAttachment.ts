import {
  MAX_INLINE_ATTACHMENTS,
  MAX_INLINE_IMAGE_BYTES,
} from "@/lib/inlineAttachmentLimits";

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[]
    );
  }
  return btoa(binary);
}

export async function filesToAttachedImagesPayload(
  files: File[]
): Promise<{ name: string; dataBase64: string; mimeType: string }[]> {
  if (files.length > MAX_INLINE_ATTACHMENTS) {
    throw new Error(`画像は最大 ${MAX_INLINE_ATTACHMENTS} 枚までです`);
  }
  const out: { name: string; dataBase64: string; mimeType: string }[] = [];
  for (const f of files) {
    if (f.size > MAX_INLINE_IMAGE_BYTES) {
      throw new Error(
        `「${f.name}」が大きすぎます（1 枚あたり最大 ${MAX_INLINE_IMAGE_BYTES / (1024 * 1024)}MB）`
      );
    }
    const buf = await f.arrayBuffer();
    out.push({
      name: f.name,
      dataBase64: arrayBufferToBase64(buf),
      mimeType: f.type || "application/octet-stream",
    });
  }
  return out;
}
