import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  buildAuthUrl,
  exchangeCodeForToken,
  extendUserToken,
  fetchUserPages,
} from "../oauth"

beforeEach(() => {
  process.env.META_APP_ID = "APP_ID_TEST"
  process.env.META_APP_SECRET = "APP_SECRET_TEST"
  process.env.META_OAUTH_REDIRECT_URI = "http://localhost:3000/api/meta/callback"
  process.env.META_GRAPH_VERSION = "v21.0"
})

describe("buildAuthUrl", () => {
  it("includes client_id, redirect_uri, state, and the configured scopes", () => {
    const url = new URL(buildAuthUrl("STATE_TOKEN"))
    expect(url.origin + url.pathname).toBe("https://www.facebook.com/v21.0/dialog/oauth")
    expect(url.searchParams.get("client_id")).toBe("APP_ID_TEST")
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/meta/callback"
    )
    expect(url.searchParams.get("state")).toBe("STATE_TOKEN")
    expect(url.searchParams.get("response_type")).toBe("code")
    const scope = url.searchParams.get("scope")
    expect(scope).toContain("pages_manage_posts")
    expect(scope).toContain("instagram_content_publish")
  })

  it("throws when META_APP_ID is missing", () => {
    delete process.env.META_APP_ID
    expect(() => buildAuthUrl("x")).toThrow(/META_APP_ID/)
  })

  it("throws when META_OAUTH_REDIRECT_URI is missing", () => {
    delete process.env.META_OAUTH_REDIRECT_URI
    expect(() => buildAuthUrl("x")).toThrow(/META_OAUTH_REDIRECT_URI/)
  })
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

describe("exchangeCodeForToken", () => {
  it("calls the graph access_token endpoint with the right params and returns the token", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("https://graph.facebook.com/v21.0/oauth/access_token")
      expect(url).toContain("client_id=APP_ID_TEST")
      expect(url).toContain("client_secret=APP_SECRET_TEST")
      expect(url).toContain("code=AUTHCODE")
      expect(url).toContain(
        "redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fmeta%2Fcallback"
      )
      return jsonResponse({
        access_token: "SHORT_LIVED_TOKEN",
        token_type: "bearer",
        expires_in: 3600,
      })
    })
    const result = await exchangeCodeForToken("AUTHCODE", fetcher)
    expect(result.accessToken).toBe("SHORT_LIVED_TOKEN")
    expect(result.tokenType).toBe("bearer")
    expect(result.expiresIn).toBe(3600)
  })

  it("throws a MetaApiError when graph returns a non-200", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        { error: { message: "Invalid verification code", code: 100, type: "OAuthException" } },
        400
      )
    )
    await expect(exchangeCodeForToken("BADCODE", fetcher)).rejects.toThrow(
      /Invalid verification code/
    )
  })

  it("throws when the response is 200 but body has no access_token", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ something_else: 1 }))
    await expect(exchangeCodeForToken("CODE", fetcher)).rejects.toThrow(/access_token/)
  })
})

describe("extendUserToken", () => {
  it("calls graph with grant_type=fb_exchange_token and returns the long-lived token", async () => {
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toContain("grant_type=fb_exchange_token")
      expect(url).toContain("client_id=APP_ID_TEST")
      expect(url).toContain("client_secret=APP_SECRET_TEST")
      expect(url).toContain("fb_exchange_token=SHORT_LIVED_TOKEN")
      return jsonResponse({
        access_token: "LONG_LIVED_TOKEN",
        token_type: "bearer",
        expires_in: 5_184_000, // 60 days
      })
    })
    const result = await extendUserToken("SHORT_LIVED_TOKEN", fetcher)
    expect(result.accessToken).toBe("LONG_LIVED_TOKEN")
    expect(result.expiresIn).toBe(5_184_000)
  })

  it("propagates a graph error as MetaApiError", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid OAuth access token", code: 190 } }, 400)
    )
    await expect(extendUserToken("BADTOKEN", fetcher)).rejects.toThrow(
      /Invalid OAuth access token/
    )
  })
})

describe("fetchUserPages", () => {
  it("returns the user's pages and the linked instagram business id when present", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes("/me/accounts")) {
        expect(url).toContain("access_token=USER_TOKEN")
        return jsonResponse({
          data: [
            { id: "PAGE_1", name: "Café Test", access_token: "PAGE_TOKEN_1" },
            { id: "PAGE_2", name: "Other Page", access_token: "PAGE_TOKEN_2" },
          ],
        })
      }
      if (url.includes("/PAGE_1") && url.includes("instagram_business_account")) {
        return jsonResponse({ id: "PAGE_1", instagram_business_account: { id: "IG_1" } })
      }
      if (url.includes("/PAGE_2") && url.includes("instagram_business_account")) {
        return jsonResponse({ id: "PAGE_2" }) // no IG linked
      }
      throw new Error(`unexpected url: ${url}`)
    })

    const pages = await fetchUserPages("USER_TOKEN", fetcher)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toEqual({
      id: "PAGE_1",
      name: "Café Test",
      accessToken: "PAGE_TOKEN_1",
      instagramBusinessId: "IG_1",
    })
    expect(pages[1].instagramBusinessId).toBeNull()
  })

  it("returns an empty array when the user has no pages", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ data: [] }))
    const pages = await fetchUserPages("USER_TOKEN", fetcher)
    expect(pages).toEqual([])
  })

  it("propagates graph errors as MetaApiError", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        { error: { message: "Invalid OAuth access token", code: 190 } },
        400
      )
    )
    await expect(fetchUserPages("BADTOKEN", fetcher)).rejects.toThrow(
      /Invalid OAuth access token/
    )
  })
})
