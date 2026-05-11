import { put } from "@vercel/blob"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
])

export interface UploadValidationError {
  field: string
  message: string
}

export function validatePhotoFile(
  file: File
): UploadValidationError | null {
  if (!ALLOWED_TYPES.has(file.type)) {
    return {
      field: "file",
      message: `Invalid file type: ${file.type}. Accepted: JPEG, PNG, WebP.`,
    }
  }
  if (file.size > MAX_FILE_SIZE) {
    return {
      field: "file",
      message: `File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB. Maximum: 5MB.`,
    }
  }
  return null
}

export async function uploadPhotoToBlob(
  file: File,
  clientId: string
): Promise<{ url: string }> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg"
  const safeExtension = /^[a-z0-9]+$/.test(extension) ? extension : "jpg"
  const key = `photos/${clientId}/${Date.now()}-${crypto.randomUUID()}.${safeExtension}`

  const blob = await put(
    key,
    file,
    { access: "public" }
  )
  return { url: blob.url }
}
