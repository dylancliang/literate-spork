import Anthropic from "@anthropic-ai/sdk";

// Server-only. The API key never reaches the browser.

export const TRANSLATE_MODEL = process.env.TRANSLATE_MODEL || "claude-sonnet-5-5";
export const FAST_MODEL = process.env.FAST_MODEL || "claude-haiku-5-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(500, "The server is missing ANTHROPIC_API_KEY. Add it in the Vercel project settings (Environment Variables) and redeploy.");
  }
  client ??= new Anthropic();
  return client;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Ask the model to answer by "calling" a tool whose input schema is our output format.
 * Forcing the tool gives us structured JSON every time instead of parsing free text.
 */
export async function callTool<T>(opts: {
  model: string;
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const res = await getClient().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    tools: [{ name: opts.toolName, description: opts.toolDescription, input_schema: { type: "object", ...opts.schema } }],
    tool_choice: { type: "tool", name: opts.toolName },
  });
  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new HttpError(502, "The model did not return structured output.");
  return block.input as T;
}

/** Wraps a route handler with JSON parsing and readable errors. */
export function handler<In, Out>(fn: (body: In) => Promise<Out>) {
  return async (req: Request): Promise<Response> => {
    try {
      const body = (await req.json()) as In;
      return Response.json(await fn(body));
    } catch (e) {
      if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
      if (e instanceof Anthropic.APIError) {
        const status = e.status ?? 502;
        return Response.json({ error: `Model API error (${status}): ${e.message}` }, { status: status === 429 || status === 529 ? 503 : 502 });
      }
      console.error(e);
      return Response.json({ error: "Unexpected server error." }, { status: 500 });
    }
  };
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new HttpError(400, message);
}
