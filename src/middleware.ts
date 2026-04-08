import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyApiProtection } from "@/lib/apiAuth";

export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/api/health") {
    return NextResponse.next();
  }
  if (!path.startsWith("/api")) {
    return NextResponse.next();
  }
  const result = verifyApiProtection(request);
  if (!result.ok) {
    return NextResponse.json(result.body, { status: result.status });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
