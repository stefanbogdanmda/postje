import { auth } from "@/lib/auth"
import { NextResponse } from "next/server"

export default auth((req) => {
  const { nextUrl } = req
  const path = nextUrl.pathname
  const isLoggedIn = !!req.auth
  const role = req.auth?.user?.role

  // Root — smart redirect
  if (path === "/") {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
    if (role === "admin") {
      return NextResponse.redirect(new URL("/admin", req.url))
    }
    return NextResponse.redirect(new URL("/dashboard", req.url))
  }

  // Login page — redirect away if already logged in
  if (path === "/login") {
    if (isLoggedIn) {
      if (role === "admin") {
        return NextResponse.redirect(new URL("/admin", req.url))
      }
      return NextResponse.redirect(new URL("/dashboard", req.url))
    }
    return NextResponse.next()
  }

  // Admin routes — require admin role
  if (path.startsWith("/admin")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
    if (role !== "admin") {
      return NextResponse.redirect(new URL("/dashboard", req.url))
    }
    return NextResponse.next()
  }

  // Protected routes (dashboard, welcome) — require any valid session
  if (path.startsWith("/dashboard") || path.startsWith("/welcome")) {
    if (!isLoggedIn) {
      return NextResponse.redirect(new URL("/login", req.url))
    }
    return NextResponse.next()
  }

  // Everything else (API routes, static files) — let through
  return NextResponse.next()
})

// Tell Next.js which routes this middleware should run on.
// Excludes API auth routes and static files.
export const config = {
  matcher: [
    "/",
    "/login",
    "/admin/:path*",
    "/dashboard/:path*",
    "/welcome/:path*",
  ],
}
