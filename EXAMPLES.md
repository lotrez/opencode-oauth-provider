# Configuration Examples

Example configurations for common API gateways and OAuth providers.

## Kong Gateway

Kong with OAuth 2.0 plugin protecting an OpenAI API:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "kong-openai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenAI via Kong",
      "options": {
        "baseURL": "https://kong.mycompany.com/openai/v1",
        "oauth": {
          "tokenUrl": "https://kong.mycompany.com/oauth2/token",
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
  },
  "model": "kong-openai/gpt-4o"
}
```

## AWS API Gateway with Cognito

AWS API Gateway with Cognito OAuth:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "aws-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LLM via AWS API Gateway",
      "options": {
        "baseURL": "https://api.example.com/prod/v1",
        "oauth": {
          "tokenUrl": "https://myapp.auth.us-east-1.amazoncognito.com/oauth2/token",
          "clientId": "{env:COGNITO_CLIENT_ID}",
          "clientSecret": "{env:COGNITO_CLIENT_SECRET}",
          "scope": "llm/access"
        }
      },
      "models": {
        "claude-3-5-sonnet": { "name": "Claude 3.5 Sonnet" }
      }
    }
  }
}
```

## Azure API Management with Azure AD

Azure API Management with Azure AD OAuth:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "azure-apim": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Azure APIM OpenAI",
      "options": {
        "baseURL": "https://myapim.azure-api.net/openai/v1",
        "oauth": {
          "tokenUrl": "https://login.microsoftonline.com/{tenant-id}/oauth2/v2.0/token",
          "clientId": "{env:AZURE_CLIENT_ID}",
          "clientSecret": "{env:AZURE_CLIENT_SECRET}",
          "scope": "api://myapi/.default"
        }
      },
      "models": {
        "gpt-4": { "name": "GPT-4" }
      }
    }
  }
}
```

## Custom OAuth Provider

Generic OAuth 2.0 provider:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "custom-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Custom LLM Gateway",
      "options": {
        "baseURL": "https://llm-gateway.example.com/v1",
        "oauth": {
          "tokenUrl": "https://auth.example.com/oauth/token",
          "clientId": "my-client-id",
          "clientSecret": "my-client-secret",
          "scope": "llm:read llm:write"
        }
      },
      "models": {
        "custom-model": {
          "name": "Custom Model",
          "limit": {
            "context": 128000,
            "output": 4096
          }
        }
      }
    }
  }
}
```

## Multiple OAuth Providers

You can configure multiple OAuth-protected providers:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "internal-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Internal LLM",
      "options": {
        "baseURL": "https://internal.example.com/v1",
        "oauth": {
          "tokenUrl": "https://auth.internal.example.com/token",
          "clientId": "{env:INTERNAL_CLIENT_ID}",
          "clientSecret": "{env:INTERNAL_CLIENT_SECRET}"
        }
      },
      "models": {
        "gpt-4": { "name": "Internal GPT-4" }
      }
    },
    "external-llm": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "External LLM",
      "options": {
        "baseURL": "https://external.example.com/v1",
        "oauth": {
          "tokenUrl": "https://external.example.com/oauth/token",
          "clientId": "{env:EXTERNAL_CLIENT_ID}",
          "clientSecret": "{env:EXTERNAL_CLIENT_SECRET}",
          "scope": "api:access"
        }
      },
      "models": {
        "claude-3": { "name": "External Claude 3" }
      }
    }
  },
  "model": "internal-llm/gpt-4"
}
```

## Environment Variables

Create a `.env` file for sensitive credentials:

```bash
# Kong Gateway
KONG_CLIENT_ID=your-kong-client-id
KONG_CLIENT_SECRET=your-kong-client-secret

# AWS Cognito
COGNITO_CLIENT_ID=your-cognito-client-id
COGNITO_CLIENT_SECRET=your-cognito-client-secret

# Azure AD
AZURE_CLIENT_ID=your-azure-client-id
AZURE_CLIENT_SECRET=your-azure-client-secret

# Custom providers
INTERNAL_CLIENT_ID=your-internal-client-id
INTERNAL_CLIENT_SECRET=your-internal-client-secret
EXTERNAL_CLIENT_ID=your-external-client-id
EXTERNAL_CLIENT_SECRET=your-external-client-secret
```

Then source it before running OpenCode:

```bash
source .env
opencode
```

Or use direnv for automatic environment loading:

```bash
# .envrc
export KONG_CLIENT_ID=xxx
export KONG_CLIENT_SECRET=xxx
```

## Testing Configuration

Test your OAuth configuration:

```bash
# Test token endpoint
curl -X POST https://your-auth-server.com/oauth/token \
  -d "grant_type=client_credentials" \
  -d "client_id=your-client-id" \
  -d "client_secret=your-client-secret"

# Expected response:
# {
#   "access_token": "...",
#   "token_type": "Bearer",
#   "expires_in": 3600
# }
```

Then test with OpenCode:

```bash
opencode run "Hello, test the connection"
```

You should see OAuth logs:
```
[oauth] Loading config from /path/to/project
[oauth] Registered provider: your-provider
[oauth] Fetch interceptor installed for 1 provider(s)
[oauth] Intercepting request to your-provider
[oauth] Fetching token from https://...
[oauth] Token obtained, expires in 3600s
```
