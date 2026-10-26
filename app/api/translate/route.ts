import { assert, callJson, handler, TRANSLATE_MODEL } from "@/lib/server/llm";
import type { Lang, TranslateItem } from "@/lib/types";
import { isMock, mockTranslate } from "@/lib/server/mock";

export const maxDuration = 60;

const MAX_ITEMS = 60;
const MAX_CHARS = 2000;

type Body = { lang: Lang; items: TranslateItem[]; instruction?: string };

export const POST = handler<Body, { translations: { id: string; text: string }[] }>(async ({ lang, items, instruction }) => {
  assert(lang && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(lang.code) && typeof lang.name === "string" && lang.name.length < 60, "Invalid language.");
  assert(Array.isArray(items) && items.length > 0 && items.length <= MAX_ITEMS, `Send between 1 and ${MAX_ITEMS} items.`);
  assert(items.every((i) => typeof i.id === "string" && typeof i.text === "string" && i.text.length <= MAX_CHARS), "Invalid item.");
  assert(!instruction || (typeof instruction === "string" && instruction.length <= 500), "Instruction too long.");

  if (isMock()) return { translations: await mockTranslate(lang, items) };

  const system = [
    `You are a professional video-game localizer. Translate Simplified Chinese game text into ${lang.name} (${lang.code}).`,
    "",
    "Rules:",
    "1. Return exactly one translation for every id you receive. Never skip, merge or reorder items.",
    "2. Copy these exactly, unchanged and untranslated: placeholders like {0} {1} {name} %s %d, markup tags like <color=gold> and </color> (translate only the words between tags), and the two-character sequence \\n.",
    "3. Keep numbers and quantities (x100, 50%, 3) with the same values; follow the target language's normal typography.",
    "4. The `column` tells you what kind of text it is (a name, a category, a rarity, a description). Translate the same Chinese term the same way every time.",
    "5. Item, skill and character names should sound like natural names in the target language, not word-by-word glosses. Keep them short; UI space is limited.",
    "6. Descriptions should read like polished game UI text: concise and clear.",
    lang.code.toLowerCase().startsWith("de") ? "7. German: address the player informally (du) unless told otherwise; capitalize nouns; prefer short, natural compounds." : "",
    "If an item has a `problem` field, your previous attempt failed an automatic check. Fix that problem.",
    instruction ? `\nExtra instruction from the user (follow it): ${instruction}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const user = `Translate these ${items.length} items into ${lang.name}:\n\n${JSON.stringify(
    items.map(({ id, column, text, problem }) => (problem ? { id, column, text, problem } : { id, column, text })),
    null,
    1
  )}`;

  const out = await callJson<{ translations: { id: string; text: string }[] }>({
    model: TRANSLATE_MODEL,
    system,
    user,
    maxTokens: 16000,
    schema: {
      properties: {
        translations: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, text: { type: "string" } },
            required: ["id", "text"],
          },
        },
      },
      required: ["translations"],
    },
  });
  return { translations: Array.isArray(out.translations) ? out.translations : [] };
});
