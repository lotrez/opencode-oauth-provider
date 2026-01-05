/**
 * OpenAI-compatible chat completions endpoint
 * Supports both streaming (SSE) and non-streaming responses
 */

import { validateToken } from "./oauth";

interface Message {
	role: "system" | "user" | "assistant";
	content: string;
}

interface ChatRequest {
	model: string;
	messages: Message[];
	stream?: boolean;
	temperature?: number;
	max_tokens?: number;
}

interface ChatChoice {
	index: number;
	message: Message;
	finish_reason: "stop" | "length" | null;
}

interface ChatResponse {
	id: string;
	object: "chat.completion";
	created: number;
	model: string;
	choices: ChatChoice[];
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
}

interface StreamDelta {
	role?: string;
	content?: string;
}

interface StreamChoice {
	index: number;
	delta: StreamDelta;
	finish_reason: "stop" | "length" | null;
}

interface StreamChunk {
	id: string;
	object: "chat.completion.chunk";
	created: number;
	model: string;
	choices: StreamChoice[];
}

function generateId(): string {
	return `chatcmpl-${Math.random().toString(36).substring(2, 15)}`;
}

// Simulate an AI response based on the user's message
function generateResponse(messages: Message[]): string {
	const lastUserMessage = messages.filter((m) => m.role === "user").pop()?.content || "";

	// Simple pattern matching for demo responses
	const lowerMsg = lastUserMessage.toLowerCase();

	if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
		return "Hello! I'm a mock AI assistant from the opencode-oauth-provider test server. I'm here to help you test your OAuth integration. How can I assist you today?";
	}

	if (lowerMsg.includes("joke")) {
		const jokes = [
			"Why do programmers prefer dark mode? Because light attracts bugs!",
			"Why did the developer go broke? Because he used up all his cache!",
			"How many programmers does it take to change a light bulb? None, that's a hardware problem!",
			"A SQL query walks into a bar, walks up to two tables and asks... 'Can I join you?'",
		];
		return jokes[Math.floor(Math.random() * jokes.length)];
	}

	if (lowerMsg.includes("oauth") || lowerMsg.includes("token")) {
		return "OAuth is working great! Your request was authenticated using the client credentials flow. The access token was validated successfully, and you're now able to make API calls. This demonstrates that the opencode-oauth-provider plugin is correctly handling the OAuth authentication for your API gateway.";
	}

	if (lowerMsg.includes("test")) {
		return "Test successful! The OAuth authentication is working correctly. This response confirms that:\n\n1. Your client credentials were validated\n2. An access token was issued\n3. The token was used to authenticate this API call\n4. The OpenAI-compatible response format is being returned\n\nYou can now integrate this with your Kong gateway or other OAuth-protected API gateways.";
	}

	if (lowerMsg.includes("code") || lowerMsg.includes("function")) {
		return `Here's a simple example function in TypeScript:

\`\`\`typescript
function greet(name: string): string {
  return \`Hello, \${name}! Welcome to the OAuth-protected API.\`;
}

// Usage
console.log(greet("Developer"));
\`\`\`

This demonstrates that code blocks work correctly in streaming responses!`;
	}

	// Default response
	return `I received your message: "${lastUserMessage.substring(0, 50)}${lastUserMessage.length > 50 ? "..." : ""}"

This is a mock response from the opencode-oauth-provider test server. The OAuth authentication is working correctly!

I'm a simple mock AI that responds to:
- Greetings ("hello", "hi")
- Jokes ("tell me a joke")
- OAuth questions ("how is oauth working?")
- Test requests ("test the connection")
- Code requests ("write a function")

Feel free to try any of these!`;
}

export async function handleChatCompletions(req: Request): Promise<Response> {
	// Validate OAuth token
	const authHeader = req.headers.get("authorization");
	const tokenResult = validateToken(authHeader);

	if (!tokenResult.valid) {
		return Response.json(
			{
				error: {
					message: tokenResult.error,
					type: "invalid_request_error",
					code: "invalid_api_key",
				},
			},
			{ status: 401 },
		);
	}

	// Parse request
	let body: ChatRequest;
	try {
		body = await req.json();
	} catch {
		return Response.json(
			{
				error: {
					message: "Invalid JSON in request body",
					type: "invalid_request_error",
				},
			},
			{ status: 400 },
		);
	}

	if (!body.messages || !Array.isArray(body.messages)) {
		return Response.json(
			{
				error: {
					message: "Missing or invalid 'messages' field",
					type: "invalid_request_error",
				},
			},
			{ status: 400 },
		);
	}

	const responseId = generateId();
	const created = Math.floor(Date.now() / 1000);
	const model = body.model || "mock-gpt-4";
	const responseText = generateResponse(body.messages);

	console.log(`[Chat] Client: ${tokenResult.clientId}, Model: ${model}, Stream: ${body.stream ?? false}`);

	// Non-streaming response
	if (!body.stream) {
		const response: ChatResponse = {
			id: responseId,
			object: "chat.completion",
			created,
			model,
			choices: [
				{
					index: 0,
					message: {
						role: "assistant",
						content: responseText,
					},
					finish_reason: "stop",
				},
			],
			usage: {
				prompt_tokens: body.messages.reduce((acc, m) => acc + m.content.length / 4, 0),
				completion_tokens: responseText.length / 4,
				total_tokens: body.messages.reduce((acc, m) => acc + m.content.length / 4, 0) + responseText.length / 4,
			},
		};
		return Response.json(response);
	}

	// Streaming response (SSE)
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			// Send initial chunk with role
			const initialChunk: StreamChunk = {
				id: responseId,
				object: "chat.completion.chunk",
				created,
				model,
				choices: [
					{
						index: 0,
						delta: { role: "assistant", content: "" },
						finish_reason: null,
					},
				],
			};
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialChunk)}\n\n`));

			// Stream the response character by character (or in small chunks)
			const chunkSize = 5; // characters per chunk for realistic streaming
			for (let i = 0; i < responseText.length; i += chunkSize) {
				const textChunk = responseText.slice(i, i + chunkSize);
				const chunk: StreamChunk = {
					id: responseId,
					object: "chat.completion.chunk",
					created,
					model,
					choices: [
						{
							index: 0,
							delta: { content: textChunk },
							finish_reason: null,
						},
					],
				};
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));

				// Small delay to simulate real streaming
				await new Promise((resolve) => setTimeout(resolve, 20));
			}

			// Send final chunk with finish_reason
			const finalChunk: StreamChunk = {
				id: responseId,
				object: "chat.completion.chunk",
				created,
				model,
				choices: [
					{
						index: 0,
						delta: {},
						finish_reason: "stop",
					},
				],
			};
			controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalChunk)}\n\n`));
			controller.enqueue(encoder.encode("data: [DONE]\n\n"));
			controller.close();
		},
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		},
	});
}
