import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Proxy runs before matched routes and can do cheap session-cookie checks.
// It cannot replace route/page authz: role and ownership checks stay server-side.

function getSessionCookie(req: NextRequest): string | undefined {
  return (
    req.cookies.get("authjs.session-token")?.value ??
    req.cookies.get("__Secure-authjs.session-token")?.value
  )
}

export function proxy(req: NextRequest) {
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
