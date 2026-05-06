import Anthropic from "@anthropic-ai/sdk"

let clientInstance: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!clientInstance) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to your .env.local file."
      )
    }
    clientInstance = new Anthropic({ apiKey })
  }
  return clientInstance
}
