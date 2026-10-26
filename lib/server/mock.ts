// Test-only stand-in for the AI, switched on with MOCK_AI=1.
// It lets you click through the whole app locally without an API key.
// Its "translations" are obviously fake: [en] tags with Chinese replaced by "~". Never set MOCK_AI on the live site.

import type { FollowupAction, Lang, TranslateItem } from "../types";

export const isMock = () => process.env.MOCK_AI === "1";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockTranslate(lang: Lang, items: TranslateItem[]) {
  await delay(600 + Math.random() * 900);
  return items.map((i) => ({
    id: i.id,
    text:
      `[${lang.code}] ` +
      i.text
        .replace(/[一-鿿]+/g, "~")
        .replace(/，/g, ", ")
        .replace(/。/g, ".")
        .replace(/：/g, ": "),
  }));
}

export async function mockColumns(columns: { name: string }[]) {
  await delay(400);
  return columns.map((c) => ({ name: c.name, translate: !/id|key|code|icon|path/i.test(c.name), reason: "Mock verdict (MOCK_AI=1)" }));
}

export async function mockFollowup(message: string): Promise<FollowupAction> {
  await delay(400);
  if (/japan|日语/i.test(message))
    return { action: "add_languages", languages: [{ code: "ja", name: "Japanese" }], instruction: "", rows: [], reply: "Adding Japanese (mock)." };
  if (/formal|sie/i.test(message))
    return { action: "retranslate", languages: [{ code: "de", name: "German" }], instruction: "Use formal Sie.", rows: [], reply: "Redoing German formally (mock)." };
  return { action: "answer", languages: [], instruction: "", rows: [], reply: "Mock mode: I can only add Japanese or redo German formally." };
}
