import { assert, callJson, FAST_MODEL, handler } from "@/lib/server/llm";
import type { FollowupAction, Lang } from "@/lib/types";
import { isMock, mockFollowup } from "@/lib/server/mock";

export const maxDuration = 30;

type Body = {
  message: string;
  languages: Lang[];
  columns: { name: string; translate: boolean; reason: string }[];
  rowCount: number;
};

export const POST = handler<Body, FollowupAction>(async ({ message, languages, columns, rowCount }) => {
  assert(typeof message === "string" && message.length <= 1000, "Message too long.");

  if (isMock()) return mockFollowup(message);

  const context = {
    current_target_languages: languages,
    columns: columns,
    data_rows: rowCount,
  };

  const out = await callJson<{ action: FollowupAction["action"]; languages?: Lang[]; instruction?: string; rows?: number[]; reply: string }>({
    model: FAST_MODEL,
    system:
      "You are the assistant inside a CSV translation app. A Chinese CSV has already been translated. The user sent a follow-up. Decide what to do:\n" +
      "- add_languages: they want one or more NEW target languages added (give BCP-47 codes + English names).\n" +
      "- retranslate: they want existing translations redone, e.g. a different tone/formality, a terminology change, or specific rows fixed. " +
      "Put the change in `instruction` (written as an instruction to a translator). Limit `languages` to the affected ones (empty = all). " +
      "Put 1-based data row numbers in `rows` if they named rows (empty = all rows).\n" +
      "- answer: a question or comment that needs no re-translation. Answer it in `reply` using the context (e.g. why a column was skipped).\n" +
      "Always write `reply`: one or two friendly sentences for the user, in the language they wrote in.\n\n" +
      `Context: ${JSON.stringify(context)}`,
    user: message,
    schema: {
      properties: {
        action: { type: "string", enum: ["add_languages", "retranslate", "answer"] },
        languages: {
          type: "array",
          items: { type: "object", properties: { code: { type: "string" }, name: { type: "string" } }, required: ["code", "name"] },
        },
        instruction: { type: "string" },
        rows: { type: "array", items: { type: "integer" } },
        reply: { type: "string" },
      },
      required: ["action", "reply"],
    },
  });

  return {
    action: out.action,
    languages: (out.languages ?? []).filter((l) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l.code)).slice(0, 10),
    instruction: (out.instruction ?? "").slice(0, 500),
    rows: (out.rows ?? []).filter((r) => Number.isInteger(r) && r >= 1 && r <= rowCount).slice(0, 500),
    reply: out.reply ?? "",
  };
});
