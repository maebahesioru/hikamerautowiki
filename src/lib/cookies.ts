/** MediaWiki ログイン用の最小 Cookie 管理 */

export function parseSetCookie(setCookie: string | null): Map<string, string> {
  const map = new Map<string, string>();
  if (!setCookie) return map;
  const parts = setCookie.split(/,(?=[^;]+=[^;]+)/);
  for (const part of parts) {
    const [pair] = part.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (name) map.set(name, value);
  }
  return map;
}

export function mergeSetCookieHeaders(
  jar: Map<string, string>,
  response: Response
): void {
  const raw = response.headers.getSetCookie?.() ?? [];
  if (raw.length > 0) {
    for (const line of raw) {
      const m = parseSetCookie(line);
      for (const [k, v] of m) jar.set(k, v);
    }
    return;
  }
  const single = response.headers.get("set-cookie");
  if (single) {
    const m = parseSetCookie(single);
    for (const [k, v] of m) jar.set(k, v);
  }
}

export function cookieHeader(jar: Map<string, string>): Record<string, string> {
  if (jar.size === 0) return {};
  const v = [...jar.entries()].map(([k, val]) => `${k}=${val}`).join("; ");
  return { Cookie: v };
}
