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
 * Ask the model for JSON that must match a schema (the API's structured outputs feature),
 * so we never parse free text. Every object in the schema is made strict: all fields required,
 * no extra fields allowed.
 */
export async function callJson<T>(opts: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const res = await getClient().messages.create({
    model: opts.model,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: "user", content: opts.user }],
    output_config: { format: { type: "json_schema", schema: strict({ type: "object", ...opts.schema }) as Record<string, unknown> } },
  });
  if (res.stop_reason === "max_tokens") throw new HttpError(502, "The model's answer was cut off (too long). Try a smaller batch.");
  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  try {
    return JSON.parse(text) as T;
  } catch {
    // Defensive: take the outermost JSON object if anything surrounds it.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1)) as T;
      } catch {
        /* fall through */
      }
    }
    throw new HttpError(502, "The model did not return valid JSON.");
  }
}

function strict(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strict);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) out[k] = k === "properties" ? mapValues(v as Record<string, unknown>, strict) : strict(v);
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

function mapValues(o: Record<string, unknown>, f: (v: unknown) => unknown) {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));
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
