# Architecture

## Project Structure

```
opencode-oauth-provider/
├── packages/
│   ├── plugin/                    # NPM package (publishable)
│   │   ├── src/
│   │   │   └── index.ts          # Main plugin code (SOURCE OF TRUTH)
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── test-server/               # Mock OAuth + OpenAI server
│       ├── src/
│       │   ├── server.ts          # Bun HTTP server
│       │   ├── oauth.ts           # OAuth token endpoint
│       │   └── chat.ts            # OpenAI-compatible chat endpoint
│       └── package.json
├── .opencode/
│   ├── plugin/
│   │   └── oauth-provider.ts     # Local plugin (re-exports from packages/plugin)
│   └── package.json               # Plugin dependencies
├── opencode.json                  # Test configuration
└── README.md
```

## Code Organization

### Single Source of Truth

The plugin code lives in **one place**: `packages/plugin/src/index.ts`

```typescript
// .opencode/plugin/oauth-provider.ts
// This is just a thin wrapper that imports from the package
export { OAuthProviderPlugin as default } from "../../packages/plugin/src/index"
```

**Why this structure?**
- Avoids code duplication (was 600+ lines, now 3 lines in local plugin)
- Makes npm publishing straightforward
- Allows local development and testing
- TypeScript ensures type safety across imports

### Plugin Code (`packages/plugin/src/index.ts`)

**Core Components:**

1. **Config Loading** (`loadConfig()`)
   - Reads `opencode.json` from project directory
   - Parses JSON/JSONC (with proper comment handling)
   - Discovers providers with `oauth` configuration

2. **Token Management** (`fetchToken()`, `getToken()`)
   - Implements OAuth 2.0 client credentials flow
   - Caches tokens per provider (with 60s expiry buffer)
   - Handles concurrent requests (prevents duplicate token fetches)

3. **Fetch Interception** (`installFetchInterceptor()`)
   - Monkey-patches `globalThis.fetch`
   - Preserves `originalFetch` reference (prevents infinite recursion)
   - Matches requests by `baseURL`
   - Injects `Authorization` headers

4. **Plugin Hook** (`OAuthProviderPlugin`)
   - OpenCode plugin entry point
   - Loads config on startup
   - Registers OAuth providers
   - Installs fetch interceptor

### Test Server (`packages/test-server/src/`)

**Components:**

1. **server.ts** - Bun HTTP server
   - Routes requests to OAuth and chat handlers
   - CORS support
   - Health check endpoint

2. **oauth.ts** - OAuth 2.0 implementation
   - Token generation (client credentials)
   - Token validation
   - In-memory token store

3. **chat.ts** - OpenAI-compatible API
   - `/v1/chat/completions` endpoint
   - Streaming (SSE) and non-streaming responses
   - Pattern-matched mock responses

## Data Flow

### 1. Plugin Initialization

```
OpenCode starts
  → Loads .opencode/plugin/oauth-provider.ts
    → Re-exports from packages/plugin/src/index.ts
      → OAuthProviderPlugin({ directory }) is called
        → loadConfig(directory) reads opencode.json
        → Discovers providers with oauth config
        → Calls installFetchInterceptor()
          → Overrides globalThis.fetch
```

### 2. OAuth Token Flow

```
AI request made
  → globalThis.fetch() called
    → Interceptor checks if URL matches OAuth provider
      → getToken(providerId, oauthConfig)
        → Check cache (valid if expires > now + 60s)
        → If miss: fetchToken()
          → POST to tokenUrl with client credentials
          → Store in cache with expiry
        → Return token
      → Add Authorization header
      → Call originalFetch()
        → If 401: clear cache, refresh token, retry
```

### 3. Configuration Discovery

```
opencode.json:
{
  "provider": {
    "my-api": {
      "options": {
        "baseURL": "https://api.example.com/v1",  ← Match key
        "oauth": {                                 ← Trigger OAuth
          "tokenUrl": "...",
          "clientId": "...",
          "clientSecret": "..."
        }
      }
    }
  }
}

Plugin:
1. Finds provider with oauth config
2. Stores { baseURL, oauth } in oauthProviders Map
3. Intercepts requests to baseURL
4. Adds OAuth token automatically
```

## Key Design Decisions

### Why Monkey-Patch `globalThis.fetch`?

**Alternatives considered:**
1. ❌ Provider-level `fetch` option - AI SDK doesn't expose this well
2. ❌ HTTP proxy - Adds complexity, port conflicts
3. ✅ Global fetch interception - Clean, transparent, works with all requests

**Trade-offs:**
- ✅ Works with any OpenAI-compatible provider
- ✅ No changes needed to AI SDK code
- ✅ Transparent to user
- ⚠️  Affects all fetch calls (mitigated by URL matching)
- ⚠️  Could conflict with other fetch interceptors

### Why `originalFetch` Reference?

```typescript
const originalFetch = globalThis.fetch  // Store BEFORE override

globalThis.fetch = async (input, init) => {
  // Add OAuth
  return originalFetch(input, init)  // Use stored reference
}
```

Without this, we'd have infinite recursion:
```typescript
globalThis.fetch = async (input, init) => {
  return fetch(input, init)  // ❌ Calls our override again!
}
```

### Why Token Caching?

**Without caching:**
- Every AI request → new OAuth token request
- 2x latency for every request
- Rate limits from OAuth server

**With caching:**
- OAuth request only when needed (first request + expiry)
- 60s buffer prevents race conditions near expiry
- Automatic refresh on 401 (expired token)

### Why JSON Comment Stripping?

OpenCode supports `.jsonc` files (JSON with comments). Simple regex like `/\/\/.*/g` breaks URLs:

```json
{
  "baseURL": "https://example.com/v1"  // ← Regex removes this!
             ^^^^^^^^^ broken
}
```

Solution: Proper string-aware parser that skips comments inside strings.

## Extension Points

### Adding New OAuth Flows

Currently supports client credentials. To add authorization code:

```typescript
interface OAuthConfig {
  flow: "client_credentials" | "authorization_code"  // New
  tokenUrl: string
  clientId: string
  clientSecret: string
  authorizationUrl?: string  // New (for auth code)
  redirectUri?: string       // New (for auth code)
  scope?: string
}
```

### Multiple Token Strategies

Could support per-request tokens (for user-specific auth):

```typescript
interface OAuthConfig {
  strategy: "shared" | "per-user"
  // ...
}
```

### Token Refresh Flow

Currently fetches new tokens. Could implement refresh tokens:

```typescript
interface TokenData {
  accessToken: string
  refreshToken?: string  // New
  expiresAt: number
}
```

## Testing Strategy

### Unit Tests (Future)

```typescript
// test/token-manager.test.ts
describe("getToken", () => {
  it("caches tokens until expiry")
  it("refreshes on 401")
  it("prevents concurrent fetches")
})
```

### Integration Tests (Manual)

```bash
# Start mock server
bun run dev:server

# Test OAuth flow
opencode run "Hello"

# Check logs for:
# - Token fetch
# - Token caching
# - Request interception
```

## Performance Considerations

### Token Cache Hit Rate

**Optimal scenario:**
- Long conversation: 1 token fetch, N cached lookups
- Hit rate: ~99% for typical usage

**Worst case:**
- Token expires mid-conversation
- New fetch + retry (adds ~200ms once per hour)

### Memory Usage

**Per provider:**
- Token cache: ~500 bytes (token string + metadata)
- Config: ~1KB (URLs, client ID)

**Total for 5 providers:** ~7.5KB (negligible)

### Latency Impact

**First request:**
- OAuth token fetch: ~100-300ms (network RTT)
- After caching: ~0ms (lookup from Map)

**On token expiry:**
- Refresh: ~100-300ms (once per token lifetime)
- Automatic retry: transparent to user

## Security Model

### Threat Model

**Protected against:**
- ✅ Token theft (tokens in memory only, not persisted)
- ✅ Replay attacks (tokens have expiry)
- ✅ MITM (HTTPS required for production)

**Not protected against:**
- ❌ Malicious plugins (can access globalThis.fetch)
- ❌ Memory dumps (tokens visible in process memory)
- ❌ Code injection (JavaScript environment)

### Best Practices

1. **Use environment variables** for secrets (`{env:VAR}`)
2. **Enable HTTPS** for all OAuth endpoints
3. **Limit scopes** to minimum required
4. **Rotate credentials** regularly
5. **Add `.env` to `.gitignore`**

## Future Improvements

### 1. Refresh Token Support

```typescript
async function refreshAccessToken(refreshToken: string) {
  // POST to tokenUrl with refresh_token grant
}
```

### 2. Token Persistence (Optional)

```typescript
// Save to ~/.cache/opencode/oauth-tokens.json
const tokenCache = new DiskCache<TokenData>()
```

### 3. Multiple Client Strategies

```typescript
// Round-robin across multiple clients (rate limit mitigation)
const clients = [
  { clientId: "...", clientSecret: "..." },
  { clientId: "...", clientSecret: "..." },
]
```

### 4. Plugin Configuration

```typescript
// opencode.json
{
  "plugin": {
    "opencode-oauth-provider": {
      "debug": true,
      "tokenCacheTTL": 3500
    }
  }
}
```

## Contributing

To extend this plugin:

1. **Edit source:** `packages/plugin/src/index.ts`
2. **Add tests:** (create `test/` directory)
3. **Update docs:** This file + README.md
4. **Test locally:** `opencode run "test"`
5. **Build package:** `bun run build`
