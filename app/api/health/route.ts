import { FAST_MODEL, TRANSLATE_MODEL } from "@/lib/server/llm";

export const dynamic = "force-dynamic";

/** Quick check of what's deployed. Shows no secrets: only whether a key is set. */
export function GET() {
  return Response.json({
    ok: true,
    version: (process.env.VERCEL_GIT_COMMIT_SHA ?? "local").slice(0, 7),
    apiKeySet: Boolean(process.env.ANTHROPIC_API_KEY),
    translateModel: TRANSLATE_MODEL,
    fastModel: FAST_MODEL,
    mock: process.env.MOCK_AI === "1",
  });
}
