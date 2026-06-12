import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Middleware runs before matched routes and does a cheap session-cookie check.
// It cannot replace route/page authz: role and ownership checks stay server-side
// (see requireClientAccess/requireAdmin). This is defense-in-depth only — it
// redirects unauthenticated visitors away from protected areas at the edge, so a
// future route that forgets its own auth() call is not silently public.

function getSessionCookie(req: NextRequest): string | undefined {
  return (
    req.cookies.get("authjs.session-token")?.value ??
    req.cookies.get("__Secure-authjs.session-token")?.value
  )
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname
  const hasSession = !!getSessionCookie(req)

  if (path === "/") {
    if (!hasSession) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
    return NextResponse.next()
  }

  if (path === "/login") {
    if (hasSession) {
      return NextResponse.redirect(new URL("/", req.url))
    }
    return NextResponse.next()
  }

  if (
    path.startsWith("/admin") ||
    path.startsWith("/dashboard") ||
    path.startsWith("/welcome")
  ) {
    if (!hasSession) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
    return NextResponse.next()
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/admin/:path*",
    "/dashboard/:path*",
    "/welcome/:path*",
  ],
}
