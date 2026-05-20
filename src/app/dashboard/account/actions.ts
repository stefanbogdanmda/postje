"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@/lib/auth"
import { db } from "@/db"
import { buildExportJson } from "@/lib/account/export"
import {
  createOrGetDeletionRequest,
  cancelDeletionRequestForUser,
  getActiveDeletionRequest,
} from "@/lib/account/deletion-request"
import { sendDeletionEmail } from "@/lib/account/deletion-email"

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export type ExportResult =
  | { success: true; jsonBlob: string; filename: string }
  | { success: false; error: string }

export type RequestDeletionResult =
  | { success: true; scheduledFor: string }
  | { success: false; error: string }

export type CancelDeletionResult =
  | { success: true }
  | { success: false; error: string }

export async function exportMyDataAction(): Promise<ExportResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: "Niet ingelogd." }
  }

  try {
    const data = await buildExportJson(db, session.user.id, new Date())
    const jsonBlob = JSON.stringify(data, null, 2)
    const date = new Date().toISOString().slice(0, 10)
    const clientPart = data.client?.id ?? session.user.id
    const filename = `postje-export-${clientPart}-${date}.json`
    return { success: true, jsonBlob, filename }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Onbekende fout bij exporteren"
    console.error("[exportMyDataAction] failed", { error: message })
    return { success: false, error: message }
  }
}

export async function requestAccountDeletionAction(): Promise<RequestDeletionResult> {
  const session = await auth()
  if (!session?.user?.id || !session.user.email) {
    return { success: false, error: "Niet ingelogd." }
  }

  try {
    const now = new Date()
    const request = await createOrGetDeletionRequest(db, session.user.id, now)

    const emailResult = await sendDeletionEmail({
      to: session.user.email,
      scheduledFor: request.scheduledFor,
      cancelToken: request.cancelToken,
      appUrl: APP_URL,
    })

    if (!emailResult.success) {
      console.error("[requestAccountDeletionAction] email failed", {
        userId: session.user.id,
        error: emailResult.error,
      })
    }

    revalidatePath("/dashboard")
    revalidatePath("/dashboard/account")

    return {
      success: true,
      scheduledFor: request.scheduledFor.toISOString(),
    }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Onbekende fout"
    console.error("[requestAccountDeletionAction] failed", { error: message })
    return { success: false, error: message }
  }
}

export async function cancelAccountDeletionAction(): Promise<CancelDeletionResult> {
  const session = await auth()
  if (!session?.user?.id) {
    return { success: false, error: "Niet ingelogd." }
  }

  try {
    await cancelDeletionRequestForUser(db, session.user.id, new Date())
    revalidatePath("/dashboard")
    revalidatePath("/dashboard/account")
    return { success: true }
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Onbekende fout"
    return { success: false, error: message }
  }
}

export async function getActiveDeletionRequestAction() {
  const session = await auth()
  if (!session?.user?.id) {
    return null
  }
  return getActiveDeletionRequest(db, session.user.id)
}
