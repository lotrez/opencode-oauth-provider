/**
 * OAuth 2.0 Token endpoint implementation
 * Supports client_credentials grant type (for API gateways like Kong)
 */

import { tokenStore, validClients } from "./server";

interface TokenRequest {
	grant_type: string;
	client_id?: string;
	client_secret?: string;
	scope?: string;
}

interface TokenResponse {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope?: string;
}

interface ErrorResponse {
	error: string;
	error_description: string;
}

function generateToken(): string {
	// Generate a random token (in production, use proper JWT)
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleTokenRequest(req: Request): Promise<Response> {
	const contentType = req.headers.get("content-type") || "";

	let params: TokenRequest;

	// Parse request body (support both form-urlencoded and JSON)
	if (contentType.includes("application/x-www-form-urlencoded")) {
		const formData = await req.formData();
		params = {
			grant_type: formData.get("grant_type") as string,
			client_id: formData.get("client_id") as string,
			client_secret: formData.get("client_secret") as string,
			scope: formData.get("scope") as string,
		};
	} else if (contentType.includes("application/json")) {
		params = await req.json();
	} else {
		// Try to extract from Authorization header (Basic auth)
		const authHeader = req.headers.get("authorization");
		if (authHeader?.startsWith("Basic ")) {
			const base64 = authHeader.slice(6);
			const decoded = atob(base64);
			const [clientId, clientSecret] = decoded.split(":");

			const formData = await req.formData().catch(() => new FormData());
			params = {
				grant_type: (formData.get("grant_type") as string) || "client_credentials",
				client_id: clientId,
				client_secret: clientSecret,
				scope: formData.get("scope") as string,
			};
		} else {
			return Response.json(
				{
					error: "invalid_request",
					error_description: "Unsupported content type",
				} as ErrorResponse,
				{ status: 400 },
			);
		}
	}

	// Validate grant type
	if (params.grant_type !== "client_credentials") {
		return Response.json(
			{
				error: "unsupported_grant_type",
				error_description: `Grant type '${params.grant_type}' is not supported. Use 'client_credentials'.`,
			} as ErrorResponse,
			{ status: 400 },
		);
	}

	// Validate client credentials
	if (!params.client_id || !params.client_secret) {
		return Response.json(
			{
				error: "invalid_request",
				error_description: "Missing client_id or client_secret",
			} as ErrorResponse,
			{ status: 400 },
		);
	}

	const client = validClients.get(params.client_id);
	if (!client || client.secret !== params.client_secret) {
		return Response.json(
			{
				error: "invalid_client",
				error_description: "Invalid client credentials",
			} as ErrorResponse,
			{ status: 401 },
		);
	}

	// Generate and store token
	const accessToken = generateToken();
	const expiresIn = 3600; // 1 hour

	tokenStore.set(accessToken, {
		clientId: params.client_id,
		expiresAt: Date.now() + expiresIn * 1000,
	});

	console.log(`[OAuth] Issued token for client: ${params.client_id} (expires in ${expiresIn}s)`);

	const response: TokenResponse = {
		access_token: accessToken,
		token_type: "Bearer",
		expires_in: expiresIn,
	};

	if (params.scope) {
		response.scope = params.scope;
	}

	return Response.json(response, {
		headers: {
			"Cache-Control": "no-store",
			Pragma: "no-cache",
		},
	});
}

export function validateToken(
	authHeader: string | null,
): { valid: true; clientId: string } | { valid: false; error: string } {
	if (!authHeader) {
		return { valid: false, error: "Missing Authorization header" };
	}

	if (!authHeader.startsWith("Bearer ")) {
		return { valid: false, error: "Invalid Authorization header format" };
	}

	const token = authHeader.slice(7);
	const tokenData = tokenStore.get(token);

	if (!tokenData) {
		return { valid: false, error: "Invalid or expired token" };
	}

	if (tokenData.expiresAt < Date.now()) {
		tokenStore.delete(token);
		return { valid: false, error: "Token expired" };
	}

	return { valid: true, clientId: tokenData.clientId };
}
