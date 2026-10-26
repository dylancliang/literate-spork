import { assert, callJson, FAST_MODEL, handler } from "@/lib/server/llm";
import type { ColumnStats } from "@/lib/types";
import { isMock, mockColumns } from "@/lib/server/mock";

export const maxDuration = 30;

type Body = { columns: { name: string; stats: ColumnStats }[] };
type Verdict = { name: string; translate: boolean; reason: string };

export const POST = handler<Body, { verdicts: Verdict[] }>(async ({ columns }) => {
  assert(Array.isArray(columns) && columns.length > 0 && columns.length <= 50, "Send between 1 and 50 columns.");

  if (isMock()) return { verdicts: await mockColumns(columns) };

  const described = columns.map((c) => ({
    column: c.name,
    percent_cells_with_chinese: Math.round(c.stats.chineseShare * 100),
    percent_cells_that_look_like_codes: Math.round(c.stats.codeLikeShare * 100),
    distinct_values: c.stats.uniqueValues,
    samples: c.stats.samples.slice(0, 8).map((s) => s.slice(0, 120)),
  }));

  const out = await callJson<{ verdicts: Verdict[] }>({
    model: FAST_MODEL,
    system:
      "You help localize a game's data table from Chinese. For each column, decide whether its values are human-readable text that players see " +
      "(names, descriptions, categories, dialogue: translate) or machine data that code depends on (IDs, keys, codes, file paths, enums used as keys, numbers: do NOT translate). " +
      "Translating a key or ID breaks the game, so when unsure about a key-like column, choose not to translate. " +
      "Give a short plain-English reason (under 15 words) a non-engineer would understand.",
    user: JSON.stringify(described, null, 1),
    schema: {
      properties: {
        verdicts: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, translate: { type: "boolean" }, reason: { type: "string" } },
            required: ["name", "translate", "reason"],
          },
        },
      },
      required: ["verdicts"],
    },
  });
  return { verdicts: out.verdicts ?? [] };
});
