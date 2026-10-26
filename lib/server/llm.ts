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

// Models that rejected the structured-output request once; later calls go straight to the fallback.
const noStructuredOutput = new Set<string>();

/**
 * Ask the model for JSON matching a schema.
 * First choice: the API's structured outputs (the response is guaranteed to match the schema).
 * Fallback, if the model rejects that request: the same schema given as a plain instruction,
 * with the answer parsed from text. Either way the caller gets an object, and our own
 * validation checks every translation afterwards.
 *
 * max_tokens is generous because Sonnet 5.5 and Haiku 5.5 think by default, and thinking
 * tokens count toward the limit.
 */
export async function callJson<T>(opts: {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
}): Promise<T> {
  const schema = strict({ type: "object", ...opts.schema }) as Record<string, unknown>;
  const base = {
    model: opts.model,
    max_tokens: opts.maxTokens ?? 8000,
    messages: [{ role: "user" as const, content: opts.user }],
  };

  let res: Anthropic.Message | undefined;
  if (!noStructuredOutput.has(opts.model)) {
    try {
      res = await getClient().messages.create({ ...base, system: opts.system, output_config: { format: { type: "json_schema", schema } } });
    } catch (e) {
      if (!(e instanceof Anthropic.APIError && e.status === 400)) throw e;
      console.warn(`Structured output rejected for ${opts.model}; using plain JSON instructions instead. ${e.message}`);
      noStructuredOutput.add(opts.model);
    }
  }
  res ??= await getClient().messages.create({
    ...base,
    system: `${opts.system}\n\nRespond with ONLY a JSON object that matches this JSON schema. No other text, no code fences.\n${JSON.stringify(schema)}`,
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
