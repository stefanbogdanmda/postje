import NextAuth from "next-auth"
import Resend from "next-auth/providers/resend"
import { DrizzleAdapter } from "@auth/drizzle-adapter"
import { db } from "@/db"
import {
  users,
  accounts,
  sessions,
  verificationTokens,
} from "@/db/schema"

import { isMagicLinkRateLimited } from "./auth/throttle"
import { eq } from "drizzle-orm"

// Resend SDK for sending custom emails
import { Resend as ResendClient } from "resend"

const AUTH_RESEND_KEY = process.env.AUTH_RESEND_KEY
if (!AUTH_RESEND_KEY) {
  throw new Error("AUTH_RESEND_KEY environment variable is not set")
}

const EMAIL_FROM = process.env.EMAIL_FROM ?? "onboarding@resend.dev"
const resendClient = new ResendClient(AUTH_RESEND_KEY)

export const { handlers, auth, signIn, signOut } = NextAuth({
  // The Auth.js v1 adapter types `accounts.expires_at` as `integer`, but our
  // schema column is `bigint` (mode "number"). Stored values are unix epoch
  // seconds that fit in int32 — the runtime contract is identical. We cast
  // the config to `never` so the type system stops complaining about the
  // column width difference. Switching to `integer` would require a new
  // migration on the already-deployed Neon database.
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  } as never),

  providers: [
    Resend({
      apiKey: AUTH_RESEND_KEY,
      from: EMAIL_FROM,
      sendVerificationRequest: async ({ identifier: email, url }) => {
        if (await isMagicLinkRateLimited(email, { db })) {
          return
        }

        await resendClient.emails.send({
          from: EMAIL_FROM,
          to: email,
          subject: "Je inloglink voor Postje",
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #1a1a1a;">Postje</h2>
              <p>Hallo!</p>
              <p>Klik op de onderstaande knop om in te loggen bij Postje:</p>
              <p style="text-align: center; margin: 32px 0;">
                <a href="${url}"
                   style="background-color: #1a1a1a; color: #ffffff; padding: 12px 32px;
                          border-radius: 6px; text-decoration: none; display: inline-block;
                          font-weight: 500;">
                  Inloggen
                </a>
              </p>
              <p style="color: #666; font-size: 14px;">
                Deze link werkt 1 uur. Als je dit niet hebt aangevraagd,
                kun je deze e-mail veilig negeren.
              </p>
            </div>
          `,
        })
      },
    }),
  ],

  pages: {
    signIn: "/login",
  },

  session: {
    // 30 days in seconds
    maxAge: 30 * 24 * 60 * 60,
  },

  callbacks: {
    async session({ session, user }) {
      session.user.id = user.id
      session.user.role = user.role
      session.user.hasLoggedIn = user.hasLoggedIn
      return session
    },

    async signIn({ user }) {
      const email = user.email?.toLowerCase()
      if (!email) return false

      const existingUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1)

      return existingUsers.length > 0
    },
  },
})
