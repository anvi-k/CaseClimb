import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Tells pages which path was requested, so `requireUser` can send a signed-out visitor to
 * /login?next=<that path> and bring them back after signing in. Pages only; API routes, uploads
 * and static files are not matched.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set("x-rounds-path", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api/|_next/|login|register|favicon.ico|.*\\.[a-zA-Z0-9]+$).*)"],
};
