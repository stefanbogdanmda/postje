/**
 * Permission scopes requested during the Meta OAuth dialog.
 * Order matches docs/meta-setup.md §10a so the consent dialog asks for
 * exactly the same set we manually grant during dev.
 */
export const META_OAUTH_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_metadata",
  "business_management",
  "instagram_basic",
  "instagram_content_publish",
] as const

/** Default Graph API version when META_GRAPH_VERSION is not set. */
export const DEFAULT_GRAPH_VERSION = "v21.0"

export function getGraphVersion(): string {
  return process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION
}

export function getGraphBaseUrl(): string {
  return `https://graph.facebook.com/${getGraphVersion()}`
}

/** OAuth dialog hostname (separate from graph.facebook.com). */
export function getOAuthDialogUrl(): string {
  return `https://www.facebook.com/${getGraphVersion()}/dialog/oauth`
}
