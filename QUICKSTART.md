# Quick Start Guide

Get up and running with `opencode-oauth-provider` in 5 minutes.

## 1. Copy the Plugin

```bash
# Navigate to your project
cd /path/to/your/project

# Create plugin directory
mkdir -p .opencode/plugin

# Copy the plugin file
cp /path/to/opencode-oauth-provider/.opencode/plugin/oauth-provider.ts .opencode/plugin/
```

## 2. Configure OAuth in opencode.json

Edit or create `opencode.json` in your project root:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "my-gateway": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "My OAuth Gateway",
      "options": {
        "baseURL": "https://api.example.com/v1",
        "oauth": {
          "tokenUrl": "https://auth.example.com/oauth/token",
          "clientId": "{env:OAUTH_CLIENT_ID}",
          "clientSecret": "{env:OAUTH_CLIENT_SECRET}"
        }
      },
      "models": {
        "gpt-4": { "name": "GPT-4" }
      }
    }
  },
  "model": "my-gateway/gpt-4"
}
```

## 3. Set Environment Variables

```bash
export OAUTH_CLIENT_ID="your-client-id"
export OAUTH_CLIENT_SECRET="your-client-secret"
```

Or create a `.env` file:

```bash
# .env
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
```

## 4. Test It

```bash
# Test the connection
opencode run "Hello, test OAuth"

# You should see OAuth logs:
# [oauth] Loading config from /path/to/project
# [oauth] Registered provider: my-gateway
# [oauth] Fetch interceptor installed for 1 provider(s)
# [oauth] Intercepting request to my-gateway
# [oauth] Fetching token from https://auth.example.com/oauth/token
# [oauth] Token obtained, expires in 3600s
```

## 5. Use It Normally

Now just use OpenCode as normal - OAuth authentication happens automatically:

```bash
opencode run "Write a function to validate email addresses"
opencode run "Explain this code: src/auth.ts"
opencode
```

## Testing with the Mock Server

Want to test without a real OAuth provider? Use the included mock server:

```bash
# 1. Clone this repo
git clone https://github.com/yourusername/opencode-oauth-provider.git
cd opencode-oauth-provider

# 2. Install dependencies
bun install

# 3. Start the mock server
bun run dev:server

# 4. In another terminal, test it
opencode run "Hello"
```

The mock server provides:
- OAuth endpoint: `http://localhost:8787/oauth/token`
- OpenAI-compatible chat: `http://localhost:8787/v1/chat/completions`
- Test credentials: `test-client-id` / `test-client-secret`

## Troubleshooting

### "Missing Authorization header"

The plugin didn't intercept the request. Check:
- ✅ Plugin file is in `.opencode/plugin/oauth-provider.ts`
- ✅ `opencode.json` has `oauth` config in provider options
- ✅ `baseURL` in config matches the API endpoint

### "OAuth token failed (401)"

Invalid credentials. Check:
- ✅ `clientId` and `clientSecret` are correct
- ✅ Environment variables are set (if using `{env:...}`)
- ✅ `tokenUrl` is correct and accessible

### "Failed to parse opencode.json"

JSON syntax error. Check:
- ✅ Valid JSON (no trailing commas)
- ✅ URLs use `https://` (not escaped as `https:\/\/`)
- ✅ Strings are quoted properly

### Plugin not loading

Check:
- ✅ File is named `oauth-provider.ts` (not `.js`)
- ✅ File is in `.opencode/plugin/` directory
- ✅ File has correct TypeScript syntax
- ✅ Run `opencode` with verbose logging to see errors

## Next Steps

- See [EXAMPLES.md](./EXAMPLES.md) for Kong, AWS, Azure configurations
- Read [README.md](./README.md) for full documentation
- Check the [test server source](./packages/test-server/src/) for implementation details

## Need Help?

- [GitHub Issues](https://github.com/yourusername/opencode-oauth-provider/issues)
- [OpenCode Discord](https://opencode.ai/discord)
- [OpenCode Docs](https://opencode.ai/docs/plugins)
