import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

// Middleware runs in the edge runtime, which cannot access SQLite.
// So we check for the session cookie directly instead of using auth().
// This tells us IF the user is logged in, but not WHO they are.
// Role-based authorization happens in server components (Node.js runtime),
// which can access the database.

function getSessionCookie(req: NextRequest): string | undefined {
  return (
    req.cookies.get("authjs.session-token")?.value ??
    req.cookies.get("__Secure-authjs.session-token")?.value
  )
}

export default function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname
  const hasSession = !!getSessionCookie(req)

  // Root — redirect based on session presence
  // The actual destination (admin vs dashboard vs welcome) is decided
  // by the root page server component, which can check the user's role.
  if (path === "/") {
    if (!hasSession) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
    return NextResponse.next()
  }

  // Login page — redirect away if already logged in
  if (path === "/login") {
    if (hasSession) {
      // Redirect to root, which will route to the right destination
      return NextResponse.redirect(new URL("/", req.url))
    }
    return NextResponse.next()
  }

  // Protected routes (admin, dashboard, welcome) — require session cookie
  // Role-based checks (e.g., admin-only) happen in the page server components.
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
