/**
 * OpenCode OAuth Provider Plugin
 *
 * Automatically adds OAuth client credentials authentication to providers
 * that have an "oauth" block in their options in opencode.json:
 *
 * ```json
 * {
 *   "provider": {
 *     "my-gateway": {
 *       "npm": "@ai-sdk/openai-compatible",
 *       "name": "My Kong Gateway",
 *       "options": {
 *         "baseURL": "https://api.mycompany.com/v1",
 *         "oauth": {
 *           "tokenUrl": "https://auth.mycompany.com/oauth/token",
 *           "clientId": "{env:MY_CLIENT_ID}",
 *           "clientSecret": "{env:MY_CLIENT_SECRET}",
 *           "scope": "llm:access"
 *         }
 *       },
 *       "models": {
 *         "gpt-4": { "name": "GPT-4 via Gateway" }
 *       }
 *     }
 *   }
 * }
 * ```
 */

import type { Plugin } from "@opencode-ai/plugin";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export interface OAuthConfig {
	tokenUrl: string;
	clientId: string;
	clientSecret: string;
	scope?: string;
}

interface ProviderConfig {
	npm?: string;
	name?: string;
	options?: {
		baseURL?: string;
		oauth?: OAuthConfig;
	};
	models?: Record<string, unknown>;
}

interface OpenCodeConfig {
	provider?: Record<string, ProviderConfig>;
}

interface TokenData {
	accessToken: string;
	tokenType: string;
	expiresAt: number;
}

// Token cache per provider
const tokenCache = new Map<
	string,
	{ token: TokenData | null; promise: Promise<TokenData> | null }
>();

// OAuth providers discovered from config
const oauthProviders = new Map<
	string,
	{ baseURL: string; oauth: OAuthConfig }
>();

// Original fetch reference
const originalFetch = globalThis.fetch;

// File logger setup
const logDir = join(Bun.env.TMPDIR || "/tmp", "opencode-oauth-logs");
const logFile = join(logDir, `oauth-${Date.now()}.log`);
let logWriter: Awaited<ReturnType<typeof Bun.file>> | null = null;

async function initLogger(): Promise<void> {
	try {
		mkdirSync(logDir, { recursive: true });
		console.log(`[oauth] Logs will be written to: ${logFile}`);
	} catch (e) {
		console.error(`[oauth] Failed to create log directory:`, e);
	}
}

async function log(level: "INFO" | "ERROR" | "DEBUG", message: string, ...args: unknown[]): Promise<void> {
	const timestamp = new Date().toISOString();
	const formattedArgs = args.map(arg => 
		typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
	).join(' ');
	const logMessage = `[${timestamp}] [${level}] ${message} ${formattedArgs}\n`;
	
	// Always log to console
	console.log(`[oauth] ${message}`, ...args);
	
	// Write to file using Bun
	try {
		await Bun.$`echo ${logMessage} >> ${logFile}`.quiet();
	} catch (e) {
		// Silently fail file writes
	}
}

async function fetchToken(config: OAuthConfig): Promise<TokenData> {
	await log("INFO", `Fetching token from ${config.tokenUrl}`);

	const body = new URLSearchParams({
		grant_type: "client_credentials",
		client_id: config.clientId,
		client_secret: config.clientSecret,
	});
	if (config.scope) body.set("scope", config.scope);

	const res = await originalFetch(config.tokenUrl, {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: body.toString(),
	});

	if (!res.ok) {
		const err = await res.text();
		await log("ERROR", `OAuth token failed (${res.status}):`, err);
		throw new Error(`OAuth token failed (${res.status}): ${err}`);
	}

	const data = await res.json();
	await log("INFO", `Token obtained, expires in ${data.expires_in || 3600}s`);

	return {
		accessToken: data.access_token,
		tokenType: data.token_type || "Bearer",
		expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
	};
}

async function getToken(
	providerId: string,
	config: OAuthConfig,
): Promise<TokenData> {
	const cached = tokenCache.get(providerId);

	// Return valid cached token (with 60s buffer)
	if (cached?.token && cached.token.expiresAt > Date.now() + 60000) {
		return cached.token;
	}

	// Wait for in-flight request
	if (cached?.promise) {
		return cached.promise;
	}

	// Fetch new token
	const promise = fetchToken(config);
	const existingToken = cached?.token || null;
	tokenCache.set(providerId, { token: existingToken, promise });

	try {
		const token = await promise;
		tokenCache.set(providerId, { token, promise: null });
		return token;
	} catch (e) {
		tokenCache.set(providerId, { token: existingToken, promise: null });
		throw e;
	}
}

function stripJsonComments(content: string): string {
	// Simple JSONC parser that handles comments without breaking URLs
	let result = "";
	let inString = false;
	let inSingleLineComment = false;
	let inMultiLineComment = false;
	let i = 0;

	while (i < content.length) {
		const char = content[i];
		const nextChar = content[i + 1];

		if (inSingleLineComment) {
			if (char === "\n") {
				inSingleLineComment = false;
				result += char;
			}
			i++;
			continue;
		}

		if (inMultiLineComment) {
			if (char === "*" && nextChar === "/") {
				inMultiLineComment = false;
				i += 2;
				continue;
			}
			i++;
			continue;
		}

		if (inString) {
			result += char;
			if (char === "\\" && nextChar) {
				result += nextChar;
				i += 2;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			i++;
			continue;
		}

		// Not in string or comment
		if (char === '"') {
			inString = true;
			result += char;
			i++;
			continue;
		}

		if (char === "/" && nextChar === "/") {
			inSingleLineComment = true;
			i += 2;
			continue;
		}

		if (char === "/" && nextChar === "*") {
			inMultiLineComment = true;
			i += 2;
			continue;
		}

		result += char;
		i++;
	}

	return result;
}

async function loadConfig(directory: string): Promise<OpenCodeConfig | null> {
	const configPaths = [
		join(directory, "opencode.json"),
		join(directory, "opencode.jsonc"),
	];

	for (const configPath of configPaths) {
		const file = Bun.file(configPath);
		
		try {
			if (await file.exists()) {
				const content = await file.text();
				const jsonContent = configPath.endsWith(".jsonc")
					? stripJsonComments(content)
					: content;
				return JSON.parse(jsonContent);
			}
		} catch (e) {
			await log("ERROR", `Failed to parse ${configPath}:`, e);
		}
	}
	return null;
}

function installFetchInterceptor() {
	if (globalThis.fetch !== originalFetch) return; // Already installed

	const interceptor = async (input: RequestInfo | URL, init?: RequestInit) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;

		// Find matching OAuth provider by baseURL
		for (const [providerId, config] of oauthProviders) {
			if (url.startsWith(config.baseURL)) {
				await log("INFO", `Intercepting request to ${providerId}`);

				try {
					const token = await getToken(providerId, config.oauth);
					const headers = new Headers(init?.headers);
					headers.set(
						"Authorization",
						`${token.tokenType} ${token.accessToken}`,
					);

					const res = await originalFetch(input, { ...init, headers });

					// Retry once on 401 with fresh token
					if (res.status === 401) {
						await log("INFO", `Got 401, refreshing token for ${providerId}`);
						tokenCache.delete(providerId);
						const newToken = await getToken(providerId, config.oauth);
						headers.set(
							"Authorization",
							`${newToken.tokenType} ${newToken.accessToken}`,
						);
						return originalFetch(input, { ...init, headers });
					}

					return res;
				} catch (e) {
					await log("ERROR", `Error for ${providerId}:`, e);
					throw e;
				}
			}
		}

		// No OAuth provider matched, pass through
		return originalFetch(input, init);
	};

	globalThis.fetch = interceptor as typeof fetch;
}

export const OAuthProviderPlugin: Plugin = async ({ directory }) => {
	await initLogger();
	await log("INFO", `Loading config from ${directory}`);

	// Load opencode.json
	const config = await loadConfig(directory);

	if (!config?.provider) {
		await log("INFO", `No providers configured`);
		return {};
	}

	// Find providers with OAuth configuration
	for (const [providerId, providerConfig] of Object.entries(config.provider)) {
		const oauth = providerConfig.options?.oauth;
		const baseURL = providerConfig.options?.baseURL;

		if (oauth && baseURL) {
			await log("INFO", `Registered provider: ${providerId}`);
			await log("INFO", `  Base URL: ${baseURL}`);
			await log("INFO", `  Token URL: ${oauth.tokenUrl}`);

			oauthProviders.set(providerId, { baseURL, oauth });
		}
	}

	// Install fetch interceptor if we have OAuth providers
	if (oauthProviders.size > 0) {
		installFetchInterceptor();
		await log(
			"INFO",
			`Fetch interceptor installed for ${oauthProviders.size} provider(s)`,
		);
	}

	return {
		event: async ({ event }) => {
			if (event.type === "session.created" && oauthProviders.size > 0) {
				await log("INFO", `Session started with OAuth enabled`);
			}
		},
	};
};

export default OAuthProviderPlugin;
