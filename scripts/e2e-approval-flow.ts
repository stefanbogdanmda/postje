/**
 * E2E Approval Flow Verification Script
 *
 * Runtime: ~1 second (no Claude API calls — tests the repository layer directly)
 * When to run: After changes to the dashboard, approval UI, or post repository.
 *   Also run before merging the client-dashboard-approval branch.
 *
 * What it tests:
 * 1. Dashboard data loading (posts grouped by status)
 * 2. Approve a post (without edits)
 * 3. Approve with edits (content update)
 * 4. Reject (skip) a post
 * 5. Regeneration in place (content update, count increment, same ID)
 * 6. MAX_REJECTIONS enforcement
 * 7. Client isolation (clientId filtering)
 * 8. Cannot approve a non-draft post
 *
 * Prerequisites:
 * - Run `npm run db:migrate` first
 * - Does NOT require a running dev server
 * - Does NOT call the Claude API
 */

import { createTestDb, seedTestClient, seedTestPhoto } from "../src/test/db"
import {
  insertPosts,
  getPostsByDateRange,
  getPostById,
  approvePost,
  rejectPost,
  regeneratePost,
} from "../src/lib/posts/repository"
import { MAX_REJECTIONS } from "../src/lib/posts/config"

const db = createTestDb()

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  \u2713 ${message}`)
    passed++
  } else {
    console.error(`  \u2717 ${message}`)
    failed++
  }
}

// ── Setup ──
console.log("\n=== E2E Approval Flow Verification ===\n")

const clientId = seedTestClient(db)
const otherClientId = seedTestClient(db, "other-client")
const photoId = seedTestPhoto(db, clientId, "photo-001")

// Seed posts for the week
insertPosts(db, [
  { clientId, platform: "instagram", scheduledDate: "2026-05-12", content: "IG Monday", reasoning: "test", photoId },
  { clientId, platform: "facebook", scheduledDate: "2026-05-12", content: "FB Monday", reasoning: "test" },
  { clientId, platform: "instagram", scheduledDate: "2026-05-13", content: "IG Tuesday", reasoning: "test" },
  { clientId, platform: "facebook", scheduledDate: "2026-05-13", content: "FB Tuesday", reasoning: "test" },
  { clientId, platform: "instagram", scheduledDate: "2026-05-14", content: "IG Wednesday", reasoning: "test" },
])

// ── Test 1: Dashboard data loading ──
console.log("Test 1: Dashboard data loading")
const allPosts = getPostsByDateRange(db, clientId, "2026-05-12", "2026-05-18")
assert(allPosts.length === 5, "Should have 5 posts for the week")
assert(allPosts.every(p => p.status === "draft"), "All posts should be drafts")

// ── Test 2: Approve a post ──
console.log("\nTest 2: Approve a post")
const postToApprove = allPosts[0]
const approved = approvePost(db, postToApprove.id, clientId)
assert(approved.status === "approved", "Post status should be approved")
assert(approved.approvedAt !== null, "approvedAt should be set")
assert(approved.content === postToApprove.content, "Content should be unchanged")

// ── Test 3: Approve with edits ──
console.log("\nTest 3: Approve with edits")
const postToEdit = allPosts[1]
const edited = approvePost(db, postToEdit.id, clientId, "Edited FB content")
assert(edited.status === "approved", "Post status should be approved")
assert(edited.content === "Edited FB content", "Content should be updated")

// ── Test 4: Reject (skip) a post ──
console.log("\nTest 4: Reject (skip) a post")
const postToReject = allPosts[2]
const rejected = rejectPost(db, postToReject.id, clientId)
assert(rejected.status === "rejected", "Post status should be rejected")
assert(rejected.rejectedAt !== null, "rejectedAt should be set")
assert(rejected.rejectionCount === 1, "rejectionCount should be 1")

// ── Test 5: Regenerate in place ──
console.log("\nTest 5: Regenerate in place")
const postToRegen = allPosts[3]
const regenerated = regeneratePost(db, postToRegen.id, clientId, "New FB Tuesday", "regenerated reasoning")
assert(regenerated.id === postToRegen.id, "Should keep the same post ID")
assert(regenerated.content === "New FB Tuesday", "Content should be updated")
assert(regenerated.reasoning === "regenerated reasoning", "Reasoning should be updated")
assert(regenerated.rejectionCount === 1, "rejectionCount should be 1")
assert(regenerated.status === "draft", "Status should still be draft")

// ── Test 6: MAX_REJECTIONS enforcement ──
console.log("\nTest 6: MAX_REJECTIONS enforcement")
const postForMaxTest = allPosts[4]
for (let i = 0; i < MAX_REJECTIONS; i++) {
  regeneratePost(db, postForMaxTest.id, clientId, `Version ${i + 2}`, "regen")
}
const maxedPost = getPostById(db, postForMaxTest.id, clientId)!
assert(maxedPost.rejectionCount === MAX_REJECTIONS, `rejectionCount should be ${MAX_REJECTIONS}`)

// ── Test 7: Client isolation ──
console.log("\nTest 7: Client isolation")
const crossClientPost = getPostById(db, postToApprove.id, otherClientId)
assert(crossClientPost === null, "Should not find post with wrong clientId")

let crossClientError = false
try {
  approvePost(db, allPosts[3].id, otherClientId)
} catch {
  crossClientError = true
}
assert(crossClientError, "Should throw when approving with wrong clientId")

// ── Test 8: Cannot approve non-draft ──
console.log("\nTest 8: Cannot approve non-draft")
let doubleApproveError = false
try {
  approvePost(db, postToApprove.id, clientId) // already approved
} catch {
  doubleApproveError = true
}
assert(doubleApproveError, "Should throw when approving an already-approved post")

// ── Summary ──
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
process.exit(failed > 0 ? 1 : 0)
