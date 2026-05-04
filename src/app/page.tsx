import { redirect } from "next/navigation"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { users } from "@/db/schema"
import { eq } from "drizzle-orm"

export default async function Home() {
  const session = await auth()

  if (!session) {
    redirect("/login")
  }

  // Admin always goes to admin dashboard
  if (session.user.role === "admin") {
    redirect("/admin")
  }

  // First-login detection: query the database for the freshest value.
  // We can't rely on session.user.hasLoggedIn because Auth.js may have
  // cached the session before we can update it. The DB is the source of truth.
  const user = await db
    .select({ hasLoggedIn: users.hasLoggedIn })
    .from(users)
    .where(eq(users.id, session.user.id))
    .get()

  if (user && !user.hasLoggedIn) {
    // Flip the flag BEFORE redirecting — the welcome page is a greeting,
    // not a gate. Next login will skip it.
    await db
      .update(users)
      .set({ hasLoggedIn: true })
      .where(eq(users.id, session.user.id))
    redirect("/welcome")
  }

  redirect("/dashboard")
}
