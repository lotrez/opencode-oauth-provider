# Agent Guidelines for opencode-oauth-provider

This document provides guidelines for AI coding agents working on this repository.

## Project Overview

OpenCode plugin that adds OAuth 2.0 client credentials authentication to OpenAI-compatible providers behind API gateways (Kong, AWS API Gateway, etc.).

**Key Components:**
- `packages/plugin/` - Main OAuth plugin (publishable npm package)
- `packages/test-server/` - Mock OAuth + OpenAI server for testing
- `.opencode/plugin/` - Local plugin (re-exports from packages/plugin)

## Build & Development Commands

### Setup
```bash
bun install              # Install all dependencies
```

### Build
```bash
bun run build           # Build all packages
cd packages/plugin && bun run build    # Build plugin only
```

### Development
```bash
bun run dev:server      # Start mock OAuth server (port 8787)
```

### Testing
```bash
# Integration test (requires mock server running)
bun run test            # Starts server + runs opencode test

# Manual testing
bun run dev:server &    # Start server in background
opencode run "Hello"    # Test OAuth flow
```

### Single Test Execution
No unit tests currently. For manual testing of specific functionality:
```bash
# Test OAuth token endpoint
curl -X POST http://localhost:8787/oauth/token \
  -d "grant_type=client_credentials&client_id=test-client-id&client_secret=test-client-secret"

# Test chat endpoint with OAuth
TOKEN=$(curl -s -X POST http://localhost:8787/oauth/token -d "grant_type=client_credentials&client_id=test-client-id&client_secret=test-client-secret" | jq -r '.access_token')
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"mock-gpt-4","messages":[{"role":"user","content":"Hello"}]}'
```

## Code Style Guidelines

### File Organization
- **Source of truth**: `packages/plugin/src/index.ts` contains all plugin code
- **No duplication**: `.opencode/plugin/oauth-provider.ts` just re-exports the source
- **One file per component**: server.ts, oauth.ts, chat.ts in test-server

### Imports
```typescript
// External imports first (alphabetically)
import type { Plugin } from "@opencode-ai/plugin"

// Type imports use 'import type'
import type { OAuthConfig } from "./types"

// IMPORTANT: Use Bun's native APIs, NOT Node.js APIs
// ✅ Good: Use Bun.write(), template strings for paths
// ❌ Bad: import { mkdirSync } from "node:fs"
// ❌ Bad: import { join } from "node:path"
```

### Using Bun APIs

**Path joining:**
```typescript
// Use template strings instead of path.join()
const filePath = `${directory}/opencode.json`  // Good
const logPath = `${logDir}/oauth-${Date.now()}.log`  // Good

// Avoid Node.js path module
import { join } from "node:path"  // Bad
```

**File operations:**
```typescript
// Use Bun's native file APIs
await Bun.write(filePath, content)  // Good
const file = Bun.file(path)  // Good
const exists = await file.exists()  // Good

// Avoid Node.js fs module
import { mkdirSync, writeFileSync } from "node:fs"  // Bad
```

**Creating directories:**
```typescript
// Bun.write creates parent directories automatically
await Bun.write(`${dir}/.init`, "")  // Good

// Avoid Node.js mkdir
import { mkdir } from "node:fs/promises"  // Bad
await mkdir(dir, { recursive: true })  // Bad
```

### TypeScript Configuration
- **Target**: ES2022
- **Module**: ESNext with bundler resolution
- **Strict mode**: Enabled (strict: true)
- **Type safety**: All functions should have explicit return types
- **No implicit any**: Avoid `any`, use `unknown` if needed

### Naming Conventions

**Interfaces & Types:**
```typescript
interface OAuthConfig { }        // PascalCase for interfaces
type TokenData = { }             // PascalCase for types
```

**Functions:**
```typescript
function fetchToken() { }        // camelCase for functions
async function getToken() { }    // async prefix not required
```

**Constants:**
```typescript
const originalFetch = globalThis.fetch   // camelCase for most
const PORT = 8787                        // UPPER_CASE for config
```

**Variables:**
```typescript
const tokenCache = new Map()     // camelCase
let cachedToken: TokenData       // camelCase with explicit type
```

### Comments & Documentation

**File headers:**
```typescript
/**
 * Brief description of what this file does
 * 
 * Key features or implementation details
 */
```

**Function documentation:**
```typescript
/**
 * Brief description of function purpose
 * 
 * @param param - Description
 * @returns Description of return value
 */
```

**Inline comments:**
```typescript
// Use single-line comments for explanations
// Keep comments concise and explain WHY, not WHAT
```

### Error Handling

**Explicit error messages:**
```typescript
throw new Error(`OAuth token failed (${res.status}): ${errorText}`)
```

**Catch and log:**
```typescript
try {
  const token = await fetchToken()
} catch (e) {
  console.error(`[oauth] Failed to fetch token:`, e)
  throw e  // Re-throw after logging
}
```

**Validation before operations:**
```typescript
if (!config?.provider) {
  console.log(`[oauth] No providers configured`)
  return {}  // Return early rather than nesting
}
```

### Logging Convention

**Prefix all logs:**
```typescript
console.log(`[oauth] Loading config from ${directory}`)
console.log(`[oauth] Token obtained, expires in ${expiresIn}s`)
console.error(`[oauth] Failed to parse config:`, error)
```

### Async/Await Patterns

**Prefer async/await over promises:**
```typescript
// Good
const token = await fetchToken()

// Avoid
fetchToken().then(token => { })
```

**Handle concurrent requests:**
```typescript
// Cache in-flight promises to prevent duplicate requests
if (cached?.promise) {
  return cached.promise
}
```

### Type Safety

**Explicit types for public APIs:**
```typescript
export interface OAuthConfig {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scope?: string
}
```

**Avoid type assertions:**
```typescript
// Avoid: const foo = bar as SomeType
// Prefer: validation + type guards
```

**Use discriminated unions:**
```typescript
type Result = 
  | { type: "success"; data: string }
  | { type: "error"; error: string }
```

## Architecture Patterns

### Single Source of Truth
- Plugin code lives ONLY in `packages/plugin/src/index.ts`
- Local plugin (`opencode/plugin/`) re-exports it
- Never duplicate code between packages

### Global Fetch Interception
```typescript
const originalFetch = globalThis.fetch  // Store before override
globalThis.fetch = async (input, init) => {
  // Add OAuth, then call originalFetch
  return originalFetch(input, init)  // Prevents infinite recursion
}
```

### Token Caching
- Cache tokens per provider in Map
- 60s expiry buffer to prevent race conditions
- Handle concurrent requests with promise deduplication

### Configuration Discovery
- Read `opencode.json` from project directory
- Parse JSON/JSONC with proper comment handling
- Match requests by `baseURL` to provider

## Common Pitfalls

1. **Don't use regex for JSON comment removal** - URLs contain `//` which breaks simple regex
2. **Always store `originalFetch` before overriding** - Prevents infinite recursion
3. **Use 60s token expiry buffer** - Prevents using almost-expired tokens
4. **Type `globalThis.fetch` correctly** - Use `as typeof fetch` to avoid type errors
5. **Handle both JSON and form-urlencoded** - OAuth servers vary in requirements

## Testing Guidelines

1. **Start mock server first**: `bun run dev:server`
2. **Check logs for OAuth flow**: Look for `[oauth]` prefixed messages
3. **Verify token caching**: Second request should use cached token
4. **Test streaming responses**: Use `stream: true` in chat requests

## File Modifications

When modifying code:
1. **Edit source**: `packages/plugin/src/index.ts` (never edit `.opencode/plugin/`)
2. **Rebuild**: `cd packages/plugin && bun run build`
3. **Test locally**: `opencode run "test message"`
4. **Update docs**: If changing API, update README.md

## Version Control

- `.env` is gitignored (contains secrets)
- `node_modules/` and `dist/` are gitignored
- Commit compiled `dist/` only for npm publish

## Additional Resources

- [ARCHITECTURE.md](./ARCHITECTURE.md) - Deep technical details
- [EXAMPLES.md](./EXAMPLES.md) - Kong, AWS, Azure configs
- [QUICKSTART.md](./QUICKSTART.md) - 5-minute setup guide
