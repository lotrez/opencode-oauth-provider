# opencode-oauth-provider

OpenCode plugin that adds OAuth 2.0 client credentials authentication to any OpenAI-compatible provider behind an API gateway (like Kong, AWS API Gateway, etc.).

## Features

- **OAuth 2.0 Client Credentials Flow** - Automatically obtains and refreshes access tokens
- **Token Caching** - Caches tokens until they expire (with 60s buffer)
- **Automatic Retry** - Refreshes expired tokens and retries requests on 401
- **Config-Based** - Configure directly in `opencode.json` with no environment variables required
- **Multiple Providers** - Support multiple OAuth-protected providers simultaneously
- **Type-Safe** - Full TypeScript support

## Installation

### Option 1: Local Plugin (Recommended for Development)

The `.opencode/` directory is OpenCode's project-level config directory (like `.vscode/` for VS Code). Files placed here are automatically loaded.

```bash
# Copy the plugin to your project
mkdir -p .opencode/plugin
cp .opencode/plugin/oauth-provider.ts /path/to/your/project/.opencode/plugin/

# OpenCode will auto-load it on startup
```

**Why use `.opencode/plugin/`?**
- ✅ Auto-loaded by OpenCode (no config needed)
- ✅ Can be committed to Git (team-shared)
- ✅ Fast iteration (edit and reload)
- ✅ No npm installation required

### Option 2: NPM Package (Future)

```bash
npm install -g opencode-oauth-provider
```

Then add to your `opencode.json`:

```json
{
  "plugin": ["opencode-oauth-provider"]
}
```

**Note:** Package not yet published to npm. Use Option 1 for now.

## Configuration

Configure OAuth-protected providers in your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "my-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My Kong Gateway",
      "options": {
        "baseURL": "https://api.mycompany.com/v1",
        "oauth": {
          "tokenUrl": "https://auth.mycompany.com/oauth/token",
          "clientId": "your-client-id",
          "clientSecret": "your-client-secret",
          "scope": "llm:access"
        }
      },
      "models": {
        "gpt-4": {
          "name": "GPT-4 via Gateway"
        }
      }
    }
  },
  "model": "my-gateway/gpt-4"
}
```

### Using Environment Variables

You can use environment variable substitution for sensitive data:

```json
{
  "provider": {
    "my-gateway": {
      "options": {
        "baseURL": "https://api.mycompany.com/v1",
        "oauth": {
          "tokenUrl": "https://auth.mycompany.com/oauth/token",
          "clientId": "{env:OAUTH_CLIENT_ID}",
          "clientSecret": "{env:OAUTH_CLIENT_SECRET}"
        }
      }
    }
  }
}
```

Then set the environment variables:

```bash
export OAUTH_CLIENT_ID="your-client-id"
export OAUTH_CLIENT_SECRET="your-client-secret"
```

## How It Works

1. **Config Loading** - Plugin reads `opencode.json` on startup and discovers providers with `oauth` config
2. **Fetch Interception** - Installs a global fetch interceptor that matches requests by `baseURL`
3. **Token Management** - Automatically fetches OAuth tokens using client credentials flow
4. **Request Enhancement** - Adds `Authorization: Bearer <token>` header to matching requests
5. **Token Refresh** - Caches tokens and refreshes them when they expire or on 401 responses

## Example: Kong Gateway

If your Kong gateway protects an OpenAI-compatible API:

```json
{
  "provider": {
    "kong-openai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenAI via Kong",
      "options": {
        "baseURL": "https://kong.example.com/openai/v1",
        "oauth": {
          "tokenUrl": "https://kong.example.com/oauth/token",
          "clientId": "{env:KONG_CLIENT_ID}",
          "clientSecret": "{env:KONG_CLIENT_SECRET}",
          "scope": "openai"
        }
      },
      "models": {
        "gpt-4o": { "name": "GPT-4o" },
        "gpt-4o-mini": { "name": "GPT-4o Mini" }
      }
    }
  }
}
```

## Testing

This repository includes a complete test setup:

### Start the Test Server

```bash
cd packages/test-server
bun run dev
```

The mock server runs on `http://localhost:8787` and provides:
- OAuth token endpoint: `POST /oauth/token`
- OpenAI-compatible chat: `POST /v1/chat/completions`
- Health check: `GET /health`

**Test credentials:**
- Client ID: `test-client-id`
- Client Secret: `test-client-secret`

### Test with OpenCode

```bash
# From the project root
opencode run "Hello, test OAuth"
opencode run "Tell me a joke"
opencode run "Write a TypeScript function"
```

You should see OAuth logs showing token fetching and request interception.

## OAuth Configuration Options

| Option | Required | Description |
|--------|----------|-------------|
| `tokenUrl` | Yes | OAuth 2.0 token endpoint URL |
| `clientId` | Yes | OAuth client ID |
| `clientSecret` | Yes | OAuth client secret |
| `scope` | No | OAuth scope(s) to request |

## Debugging

The plugin logs all OAuth operations:

```
[oauth] Loading config from /path/to/project
[oauth] Registered provider: my-gateway
[oauth]   Base URL: https://api.mycompany.com/v1
[oauth]   Token URL: https://auth.mycompany.com/oauth/token
[oauth] Fetch interceptor installed for 1 provider(s)
[oauth] Session started with OAuth enabled
[oauth] Intercepting request to my-gateway
[oauth] Fetching token from https://auth.mycompany.com/oauth/token
[oauth] Token obtained, expires in 3600s
```

## Supported OAuth Flows

Currently supports:
- ✅ **Client Credentials** (for machine-to-machine auth)

Not yet supported:
- ❌ Authorization Code (for user auth)
- ❌ Device Flow
- ❌ Password Grant

## Technical Details

### How It Works

The plugin uses **global fetch interception** to add OAuth authentication:

1. **Config Discovery** - Reads `opencode.json` and finds providers with `oauth` config
2. **Fetch Monkey-Patching** - Overrides `globalThis.fetch` while preserving the original
3. **Request Matching** - Matches requests by `baseURL` to determine which provider to authenticate
4. **Token Management** - Fetches OAuth tokens using client credentials grant
5. **Header Injection** - Adds `Authorization: Bearer <token>` to matching requests
6. **Token Refresh** - Caches tokens and auto-refreshes on expiry or 401 responses

### Why `originalFetch`?

```typescript
// Store reference BEFORE overriding
const originalFetch = globalThis.fetch

// Override global fetch
globalThis.fetch = async (input, init) => {
  // Add OAuth token
  const token = await getToken()
  init.headers.set("Authorization", `Bearer ${token}`)
  
  // MUST use originalFetch to avoid infinite recursion
  return originalFetch(input, init)  // ✅ Correct
  // return fetch(input, init)        // ❌ Infinite loop!
}
```

Without storing the original reference, our interceptor would call itself infinitely.

### Token Caching Strategy

- Tokens are cached in-memory per provider
- Cache key: provider ID from `opencode.json`
- Expiry: 60 seconds before actual expiry (safety buffer)
- Refresh: Automatic on cache miss or 401 response
- Thread-safe: Prevents multiple concurrent token requests

### Security Considerations

- **Secrets in Config** - Use `{env:VAR}` syntax for client secrets
- **Token Storage** - Tokens stored in memory only (not on disk)
- **HTTPS Only** - Always use HTTPS for token and API endpoints in production
- **Scope Limiting** - Request minimal OAuth scopes needed
- **Git Safety** - Add `.env` to `.gitignore`, never commit secrets

## Contributing

Contributions welcome! Please open an issue or PR.

## License

MIT

## Example Use Cases

- **Kong Gateway** - Protect OpenAI APIs with Kong's OAuth 2.0 plugin
- **AWS API Gateway** - Use Cognito or custom authorizers
- **Azure API Management** - OAuth 2.0 with Azure AD
- **Custom API Gateways** - Any OAuth 2.0 compliant gateway
- **Enterprise LLM Platforms** - Internal LLM APIs with OAuth protection

## Related Projects

- [OpenCode](https://opencode.ai) - AI coding agent
- [OpenCode Plugins](https://opencode.ai/docs/ecosystem#plugins) - Community plugins
- [@opencode-ai/plugin](https://www.npmjs.com/package/@opencode-ai/plugin) - Plugin SDK

## Support

- [GitHub Issues](https://github.com/yourusername/opencode-oauth-provider/issues)
- [OpenCode Discord](https://opencode.ai/discord)
- [Documentation](https://opencode.ai/docs/plugins)
