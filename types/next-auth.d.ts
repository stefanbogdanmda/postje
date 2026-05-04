import { DefaultSession } from "next-auth"

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      role: "client" | "admin"
      hasLoggedIn: boolean
    } & DefaultSession["user"]
  }

  interface User {
    role: "client" | "admin"
    hasLoggedIn: boolean
  }
}
