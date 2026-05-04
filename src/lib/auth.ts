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
import { isRateLimited } from "./rate-limit"

// Resend SDK for sending custom emails
import { Resend as ResendClient } from "resend"

const resendClient = new ResendClient(process.env.AUTH_RESEND_KEY)

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),

  providers: [
    Resend({
      apiKey: process.env.AUTH_RESEND_KEY,
      from: process.env.EMAIL_FROM ?? "onboarding@resend.dev",
      sendVerificationRequest: async ({ identifier: email, url }) => {
        // Check rate limit before sending
        if (isRateLimited(email)) {
          // Silently skip — the user still sees "check your email"
          return
        }

        await resendClient.emails.send({
          from: process.env.EMAIL_FROM ?? "onboarding@resend.dev",
          to: email,
          subject: "Je inloglink voor Social AI",
          html: `
            <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #1a1a1a;">Social AI</h2>
              <p>Hallo!</p>
              <p>Klik op de onderstaande knop om in te loggen bij Social AI:</p>
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
      // Add custom fields to the session object.
      // Auth.js uses database sessions (not JWTs) when an adapter is present,
      // so `user` here comes directly from the database.
      session.user.id = user.id
      session.user.role = user.role
      session.user.hasLoggedIn = user.hasLoggedIn
      return session
    },

    async signIn() {
      // Allow all sign-ins. The first-login redirect (hasLoggedIn check)
      // is handled by the root page redirect logic, not here — because
      // Auth.js redirects to "/" after magic link verification, and the
      // root page has access to the database for the freshest value.
      return true
    },
  },
})
