"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

export default function DeleteUserButton({
  userId,
  userEmail,
}: {
  userId: string
  userEmail: string
}) {
  const [confirming, setConfirming] = useState(false)
  const [confirmEmail, setConfirmEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleDelete() {
    if (confirmEmail !== userEmail) return

    setLoading(true)
    const res = await fetch("/api/admin/delete-user", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    })

    if (res.ok) {
      setConfirming(false)
      setConfirmEmail("")
      router.refresh() // re-fetches the user list
    }
    setLoading(false)
  }

  if (confirming) {
    return (
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Type email to confirm"
          value={confirmEmail}
          onChange={(e) => setConfirmEmail(e.target.value)}
          style={{
            padding: "4px 8px",
            border: "1px solid #ddd",
            borderRadius: "4px",
            fontSize: "13px",
          }}
        />
        <button
          onClick={handleDelete}
          disabled={confirmEmail !== userEmail || loading}
          style={{
            padding: "4px 12px",
            backgroundColor: confirmEmail === userEmail ? "#dc2626" : "#ccc",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: confirmEmail === userEmail ? "pointer" : "not-allowed",
            fontSize: "13px",
          }}
        >
          {loading ? "..." : "Confirm"}
        </button>
        <button
          onClick={() => {
            setConfirming(false)
            setConfirmEmail("")
          }}
          style={{
            padding: "4px 12px",
            backgroundColor: "transparent",
            border: "1px solid #ddd",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      style={{
        padding: "4px 12px",
        backgroundColor: "transparent",
        border: "1px solid #dc2626",
        color: "#dc2626",
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: "13px",
      }}
    >
      Delete
    </button>
  )
}
