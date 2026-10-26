import { assert, callTool, FAST_MODEL, handler } from "@/lib/server/llm";
import type { Lang } from "@/lib/types";
import { isMock } from "@/lib/server/mock";

export const maxDuration = 30;

export const POST = handler<{ text: string }, { languages: Lang[] }>(async ({ text }) => {
  assert(typeof text === "string" && text.length <= 1000, "Message too long.");

  if (isMock()) return { languages: /brazil/i.test(text) ? [{ code: "pt-BR", name: "Brazilian Portuguese" }] : [] };

  const out = await callTool<{ languages: Lang[] }>({
    model: FAST_MODEL,
    system:
      "The user is asking an app to translate a Chinese CSV file. Extract the TARGET languages they want, in the order mentioned. " +
      "Return BCP-47 codes (e.g. en, de, ja, pt-BR, zh-Hant) and English names. " +
      "If the message names no target language, return an empty list. Never include Simplified Chinese (the source) unless they clearly ask for it.",
    user: text,
    toolName: "set_target_languages",
    toolDescription: "Record the target languages the user asked for.",
    schema: {
      properties: {
        languages: {
          type: "array",
          items: { type: "object", properties: { code: { type: "string" }, name: { type: "string" } }, required: ["code", "name"] },
        },
      },
      required: ["languages"],
    },
  });

  const languages = (out.languages ?? [])
    .filter((l) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(l.code) && l.name)
    .slice(0, 10);
  return { languages };
});
