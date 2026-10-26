import type { AgentApi } from "./types";

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`) as Error & { retryable?: boolean };
    // Rate limits and model outages are worth retrying; bad input or a missing API key are not.
    err.retryable = res.status === 429 || res.status >= 502;
    throw err;
  }
  return json as T;
}

/** Browser implementation of the agent's server calls. */
export const httpApi: AgentApi = {
  async parseLanguages(text) {
    return (await post<{ languages: { code: string; name: string }[] }>("/api/languages", { text })).languages;
  },
  async classifyColumns(columns) {
    return (await post<{ verdicts: { name: string; translate: boolean; reason: string }[] }>("/api/columns", { columns })).verdicts;
  },
  async translate(req) {
    return (await post<{ translations: { id: string; text: string }[] }>("/api/translate", req)).translations;
  },
  async routeFollowup(req) {
    return post("/api/followup", req);
  },
};
