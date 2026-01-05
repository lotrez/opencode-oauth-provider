/**
 * Mock OAuth + OpenAI-compatible server for testing opencode-oauth-provider
 *
 * Endpoints:
 * - POST /oauth/token - OAuth 2.0 token endpoint (client credentials flow)
 * - POST /v1/chat/completions - OpenAI-compatible chat completions (with streaming)
 * - GET /health - Health check
 */

import { handleTokenRequest } from "./oauth"
import { handleChatCompletions } from "./chat"

const PORT = parseInt(process.env.PORT || "8787")

// Simple token store (in-memory for testing)
export const tokenStore = new Map<
  string,
  { clientId: string; expiresAt: number }
>()

// Test client credentials (in production, these would be in a database)
export const validClients = new Map([
  [
    "test-client-id",
    {
      secret: "test-client-secret",
      name: "Test OAuth Client",
    },
  ],
  [
    "kong-client",
    {
      secret: "kong-secret",
      name: "Kong Gateway Client",
    },
  ],
])

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    // CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    }

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders })
    }

    console.log(`[${new Date().toISOString()}] ${req.method} ${path}`)

    try {
      // Health check
      if (path === "/health" && req.method === "GET") {
        return Response.json(
          { status: "ok", timestamp: new Date().toISOString() },
          { headers: corsHeaders }
        )
      }

      // OAuth token endpoint
      if (path === "/oauth/token" && req.method === "POST") {
        const response = await handleTokenRequest(req)
        // Add CORS headers to response
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value)
        })
        return response
      }

      // OpenAI-compatible chat completions
      if (path === "/v1/chat/completions" && req.method === "POST") {
        const response = await handleChatCompletions(req)
        // Add CORS headers to response
        Object.entries(corsHeaders).forEach(([key, value]) => {
          response.headers.set(key, value)
        })
        return response
      }

      // 404 for unknown routes
      return Response.json(
        { error: "Not found", path },
        { status: 404, headers: corsHeaders }
      )
    } catch (error) {
      console.error("Server error:", error)
      return Response.json(
        {
          error: {
            message: error instanceof Error ? error.message : "Internal error",
            type: "server_error",
          },
        },
        { status: 500, headers: corsHeaders }
      )
    }
  },
})

console.log(`
╔═══════════════════════════════════════════════════════════╗
║     Mock OAuth + OpenAI Server for opencode-oauth-provider    ║
╠═══════════════════════════════════════════════════════════╣
║  Server running at: http://localhost:${PORT}                   ║
║                                                           ║
║  Endpoints:                                               ║
║    POST /oauth/token         - Get access token           ║
║    POST /v1/chat/completions - Chat completions (stream)  ║
║    GET  /health              - Health check               ║
║                                                           ║
║  Test credentials:                                        ║
║    Client ID: test-client-id                              ║
║    Client Secret: test-client-secret                      ║
╚═══════════════════════════════════════════════════════════╝
`)
