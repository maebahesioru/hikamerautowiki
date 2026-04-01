/**
 * インターネット公開時の /api 保護（ミドルウェア用）。
 * - HIKAMER_API_SECRET: 設定時は Authorization: Bearer または X-Hikamer-Api-Secret が一致必須
 * - HIKAMER_API_ALLOWED_IPS: カンマ区切り。設定時はクライアント IP がいずれかと一致必須
 * どちらも未設定なら制限なし（ローカル開発向け）。
 */

export type ApiProtectionFailure = {
  ok: false;
  status: number;
  body: { error: string };
};

export type ApiProtectionSuccess = { ok: true };

export type ApiProtectionResult = ApiProtectionFailure | ApiProtectionSuccess;

function normalizeIp(ip: string): string {
  const t = ip.trim();
  if (t.startsWith("::ffff:")) return t.slice(7);
  if (t === "::1") return "127.0.0.1";
  return t;
}

function parseAllowedIps(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => normalizeIp(s))
    .filter((s) => s.length > 0);
}

function timingSafeEqualUtf8(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) {
    diff |= ba[i]! ^ bb[i]!;
  }
  return diff === 0;
}

function extractSecretFromRequest(request: Request): string | null {
  const header = request.headers.get("X-Hikamer-Api-Secret")?.trim();
  if (header) return header;
  const auth = request.headers.get("Authorization")?.trim();
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  return null;
}

export function clientIpFromRequest(request: Request): string | null {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  return null;
}

export function verifyApiProtection(request: Request): ApiProtectionResult {
  const secret = process.env.HIKAMER_API_SECRET?.trim();
  const allowed = parseAllowedIps(process.env.HIKAMER_API_ALLOWED_IPS);

  const needSecret = Boolean(secret);
  const needIp = allowed.length > 0;

  if (!needSecret && !needIp) {
    return { ok: true };
  }

  if (needIp) {
    const ip = clientIpFromRequest(request);
    const normalized = ip ? normalizeIp(ip) : null;
    if (!normalized || !allowed.includes(normalized)) {
      return {
        ok: false,
        status: 403,
        body: { error: "許可されていない IP からのアクセスです" },
      };
    }
  }

  if (needSecret) {
    const presented = extractSecretFromRequest(request);
    if (!presented || !timingSafeEqualUtf8(presented, secret!)) {
      return {
        ok: false,
        status: 401,
        body: {
          error:
            "API 認証が必要です。Authorization: Bearer <secret> または X-Hikamer-Api-Secret ヘッダーを付けてください。",
        },
      };
    }
  }

  return { ok: true };
}
