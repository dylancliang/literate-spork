import { HAN } from "./columns";
import { usesHanScript } from "./languages";

// Things the game engine reads and the translation must keep exactly:
// {0} {name}  %s %d %1$s  <color=gold> </color>  literal "\n"  and real line breaks.
const TOKEN = /\{[^{}\s]*\}|%(?:\d+\$)?[sdif@]|<\/?[A-Za-z][^<>]*>|\\n|\\t|\n/g;

export function protectedTokens(text: string): string[] {
  return (text.match(TOKEN) ?? []).sort();
}

/** Returns a list of problems; an empty list means the translation passed. */
export function checkTranslation(source: string, target: string | undefined, langCode: string): string[] {
  const problems: string[] = [];
  if (target === undefined) return ["no translation returned"];
  if (source.trim() !== "" && target.trim() === "") return ["translation is empty"];

  const a = protectedTokens(source);
  const b = protectedTokens(target);
  const missing = diff(a, b);
  const extra = diff(b, a);
  if (missing.length) problems.push(`placeholder or tag missing: ${missing.join(" ")}`);
  if (extra.length) problems.push(`unexpected placeholder or tag: ${extra.join(" ")}`);

  if (!usesHanScript(langCode) && HAN.test(target)) problems.push("Chinese characters left in the translation");
  else if (!usesHanScript(langCode) && /[，。！？；：（）【】、]/.test(target)) problems.push("Chinese punctuation left in the translation");
  if (target.length > source.length * 8 + 40) problems.push("translation is suspiciously long");
  return problems;
}

function diff(a: string[], b: string[]): string[] {
  const pool = [...b];
  const out: string[] = [];
  for (const t of a) {
    const i = pool.indexOf(t);
    if (i >= 0) pool.splice(i, 1);
    else out.push(t === "\n" ? "(line break)" : t);
  }
  return out;
}
