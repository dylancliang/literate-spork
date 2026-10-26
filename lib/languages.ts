import type { Lang } from "./types";

// A small fixed list covers most requests with no AI call.
// Anything not on the list ("Swahili", "the language they speak in Brazil") falls back to the AI.
const KNOWN: { code: string; name: string; aliases: string[] }[] = [
  { code: "en", name: "English", aliases: ["english", "英语", "英文", "英語", "eng", "englisch", "anglais"] },
  { code: "de", name: "German", aliases: ["german", "deutsch", "德语", "德文", "德語", "ger", "allemand"] },
  { code: "ja", name: "Japanese", aliases: ["japanese", "日语", "日文", "日語", "日本語", "jpn"] },
  { code: "ko", name: "Korean", aliases: ["korean", "韩语", "韩文", "韓語", "한국어", "kor"] },
  { code: "fr", name: "French", aliases: ["french", "法语", "法文", "français", "francais", "französisch"] },
  { code: "es", name: "Spanish", aliases: ["spanish", "西班牙语", "西语", "español", "espanol", "spanisch"] },
  { code: "pt", name: "Portuguese", aliases: ["portuguese", "葡萄牙语", "葡语", "português", "portugues"] },
  { code: "it", name: "Italian", aliases: ["italian", "意大利语", "italiano", "italienisch"] },
  { code: "ru", name: "Russian", aliases: ["russian", "俄语", "русский"] },
  { code: "th", name: "Thai", aliases: ["thai", "泰语", "ไทย"] },
  { code: "vi", name: "Vietnamese", aliases: ["vietnamese", "越南语", "tiếng việt"] },
  { code: "id", name: "Indonesian", aliases: ["indonesian", "印尼语", "bahasa indonesia"] },
  { code: "pl", name: "Polish", aliases: ["polish", "波兰语", "polski"] },
  { code: "nl", name: "Dutch", aliases: ["dutch", "荷兰语", "nederlands"] },
  { code: "tr", name: "Turkish", aliases: ["turkish", "土耳其语", "türkçe"] },
  { code: "ar", name: "Arabic", aliases: ["arabic", "阿拉伯语", "العربية"] },
  { code: "zh-Hant", name: "Traditional Chinese", aliases: ["traditional chinese", "繁体中文", "繁體中文", "繁体", "繁體", "zh-tw", "zh-hant"] },
];

const CODES = new Map(KNOWN.map((l) => [l.code.toLowerCase(), l]));

/** Fast path: find languages by name or alias. Returns [] when unsure, so the AI can take over. */
export function matchLanguages(text: string): Lang[] {
  const lower = text.toLowerCase();
  const hits: { pos: number; lang: Lang }[] = [];

  for (const l of KNOWN) {
    let best = -1;
    for (const a of l.aliases) {
      const isAscii = /^[\x00-\x7f]+$/.test(a);
      const pos = isAscii ? searchWord(lower, a) : lower.indexOf(a);
      if (pos >= 0 && (best < 0 || pos < best)) best = pos;
    }
    if (best >= 0) hits.push({ pos: best, lang: { code: l.code, name: l.name } });
  }

  // Bare two-letter codes ("en, de") are only trusted when the message is nothing but codes,
  // otherwise words like "it" or "id" in a normal sentence would be misread as languages.
  if (hits.length === 0) {
    const tokens = lower.split(/[\s,;/&+和、]+/).filter((t) => t && t !== "and");
    if (tokens.length && tokens.every((t) => CODES.has(t))) {
      tokens.forEach((t, i) => {
        const l = CODES.get(t)!;
        hits.push({ pos: i, lang: { code: l.code, name: l.name } });
      });
    }
  }

  hits.sort((a, b) => a.pos - b.pos);
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.lang.code) && seen.add(h.lang.code)).map((h) => h.lang);
}

function searchWord(haystack: string, word: string): number {
  const re = new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z])`);
  const m = re.exec(haystack);
  return m ? m.index + m[1].length : -1;
}

/** Languages whose normal script includes Chinese characters (so leftover Chinese is not an error). */
export function usesHanScript(code: string): boolean {
  return /^(zh|ja)/i.test(code);
}
