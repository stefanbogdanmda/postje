"use client"

import { signOut } from "next-auth/react"

export default function SignOutButton({ label }: { label: string }) {
  return (
    <button
      onClick={() => signOut({ callbackUrl: "/login" })}
      style={{
        background: "none",
        border: "none",
        color: "#999",
        textDecoration: "underline",
        cursor: "pointer",
        fontSize: "14px",
      }}
    >
      {label}
    </button>
  )
}
