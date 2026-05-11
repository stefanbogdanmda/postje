"use server"

import { auth } from "@/lib/auth"
import { db } from "@/db"
import { eq } from "drizzle-orm"
import { clients } from "@/db/schema"
import {
  getPostById,
  approvePost as repoApprovePost,
  rejectPost as repoRejectPost,
  regeneratePost as repoRegeneratePost,
} from "./repository"
import { regenerateSinglePost } from "@/lib/ai/regenerate-post"
import { MAX_REJECTIONS } from "./config"
import type { Post } from "./types"

interface ActionResult {
  success: boolean
  post?: Post
  error?: string
}

async function getClientIdForSession(): Promise<string | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const client = db
    .select({ id: clients.id })
    .from(clients)
    .where(eq(clients.userId, session.user.id))
    .get()
  return client?.id ?? null
}

export async function approvePostAction(
  postId: string,
  editedContent?: string
): Promise<ActionResult> {
  const clientId = await getClientIdForSession()
  if (!clientId) return { success: false, error: "Niet ingelogd" }
  try {
    const post = repoApprovePost(db, postId, clientId, editedContent)
    return { success: true, post }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Onbekende fout"
    return { success: false, error: message }
  }
}

export async function rejectPostAction(
  postId: string
): Promise<ActionResult> {
  const clientId = await getClientIdForSession()
  if (!clientId) return { success: false, error: "Niet ingelogd" }
  try {
    const post = repoRejectPost(db, postId, clientId)
    return { success: true, post }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Onbekende fout"
    return { success: false, error: message }
  }
}

export async function regeneratePostAction(
  postId: string,
  feedback: string
): Promise<ActionResult> {
  const clientId = await getClientIdForSession()
  if (!clientId) return { success: false, error: "Niet ingelogd" }
  if (!feedback || feedback.trim().length < 10)
    return {
      success: false,
      error: "Feedback moet minimaal 10 tekens bevatten",
    }
  const existingPost = getPostById(db, postId, clientId)
  if (!existingPost) return { success: false, error: "Post niet gevonden" }
  if (existingPost.status !== "draft")
    return {
      success: false,
      error: "Deze post kan niet meer aangepast worden.",
    }
  if (existingPost.rejectionCount >= MAX_REJECTIONS)
    return {
      success: false,
      error:
        "Je hebt het maximum aantal wijzigingen bereikt. Neem contact op met Stefan.",
    }
  try {
    const newContent = await regenerateSinglePost(
      existingPost,
      feedback,
      clientId
    )
    const post = repoRegeneratePost(
      db,
      postId,
      clientId,
      newContent.content,
      newContent.reasoning
    )
    return { success: true, post }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Onbekende fout"
    return { success: false, error: message }
  }
}
