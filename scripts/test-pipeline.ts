// Runs the whole pipeline on the sample file with a stand-in AI, so the logic
// (column picking, batching, checking, repair, output layout) is tested without an API key.
// Usage: npm test

import { readFileSync, writeFileSync } from "node:fs";
import {
  buildJob,
  buildOutput,
  chooseColumns,
  estimateCalls,
  handleFollowup,
  loadFile,
  translateLanguages,
  understandLanguages,
  type Ctx,
} from "../lib/pipeline";
import { matchLanguages } from "../lib/languages";
import { checkTranslation } from "../lib/validate";
import { parseCsv } from "../lib/csv";
import type { AgentApi, TraceEvent } from "../lib/types";

let failures = 0;
function expect(cond: unknown, label: string) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

// Stand-in AI: "translates" by tagging text and replacing Chinese characters.
// It deliberately breaks some strings on the first attempt to exercise the repair step,
// and never manages one string, to exercise the "needs review" path.
const calls = { translate: 0, classify: 0, languages: 0, followup: 0 };
const fake = (code: string, text: string) =>
  `[${code}] ` + text.replace(/[一-鿿]+/g, "w").replace(/，/g, ", ").replace(/。/g, ".").replace(/：/g, ": ");
const mockApi: AgentApi = {
  async parseLanguages(text) {
    calls.languages++;
    return /brazil/i.test(text) ? [{ code: "pt-BR", name: "Brazilian Portuguese" }] : [];
  },
  async classifyColumns(cols) {
    calls.classify++;
    return cols.map((c) => ({ name: c.name, translate: !/key|id|icon/i.test(c.name), reason: "mock verdict" }));
  },
  async translate({ lang, items }) {
    calls.translate++;
    return items.map((i) => {
      if (i.text.includes("VIP")) return { id: i.id, text: `[${lang.code}] VIP 月卡` }; // always leaves Chinese
      if (!i.problem && i.text.includes("{1}")) return { id: i.id, text: fake(lang.code, i.text).replace("{1}", "") }; // drops a placeholder once
      return { id: i.id, text: fake(lang.code, i.text) };
    });
  },
  async routeFollowup({ message }) {
    calls.followup++;
    if (/japanese/i.test(message)) return { action: "add_languages", languages: [{ code: "ja", name: "Japanese" }], instruction: "", rows: [], reply: "Adding Japanese." };
    return { action: "retranslate", languages: [{ code: "de", name: "German" }], instruction: "use formal Sie", rows: [3], reply: "Redoing row 3 in German." };
  },
};

async function main() {
  const trace: TraceEvent[] = [];
  const ctx: Ctx = { api: mockApi, trace: (e) => trace.push({ ...e, id: String(trace.length), at: Date.now() }) };

  console.log("\n— Language parsing (no AI) —");
  expect(JSON.stringify(matchLanguages("English and German").map((l) => l.code)) === '["en","de"]', "“English and German” → en, de");
  expect(JSON.stringify(matchLanguages("翻译成英语和德语").map((l) => l.code)) === '["en","de"]', "“翻译成英语和德语” → en, de");
  expect(JSON.stringify(matchLanguages("en, de").map((l) => l.code)) === '["en","de"]', "“en, de” → en, de");
  expect(matchLanguages("can you translate it please").length === 0, "“it” in a sentence is not read as Italian");
  const br = await understandLanguages(ctx, "the language they speak in Brazil");
  expect(br[0]?.code === "pt-BR" && calls.languages === 1, "unknown phrasing falls back to the AI");

  console.log("\n— Validation rules —");
  expect(checkTranslation("攻击力提升{0}点", "ATK +{0}", "en").length === 0, "placeholders kept → pass");
  expect(checkTranslation("攻击力提升{0}点", "ATK +", "en").some((p) => p.includes("{0}")), "missing {0} → flagged");
  expect(checkTranslation("<color=gold>限时</color>", "<color=gold>Limited</color>", "de").length === 0, "tags kept → pass");
  expect(checkTranslation("保留1点生命值。\\n每场", "Keep 1 HP. Once", "en").some((p) => p.includes("\\n")), "missing \\n → flagged");
  expect(checkTranslation("火焰之剑", "Flame 剑", "en").some((p) => p.includes("Chinese")), "leftover Chinese → flagged");
  expect(checkTranslation("火焰之剑", "炎の剣", "ja").length === 0, "Chinese characters allowed in Japanese");
  expect(checkTranslation("剑", "", "en")[0] === "translation is empty", "empty → flagged");

  console.log("\n— GBK file decoding —");
  const gbkBytes = new Uint8Array([0x69, 0x64, 0x2c, 0xc3, 0xfb, 0xb3, 0xc6, 0x0a, 0x31, 0x2c, 0xbb, 0xf0, 0xd1, 0xe6, 0x0a]); // "id,名称\n1,火焰\n" in GBK
  const gbk = parseCsv("gbk.csv", gbkBytes);
  expect(gbk.headers[1] === "名称" && gbk.rows[0][1] === "火焰" && gbk.encoding.startsWith("GBK"), "GBK-encoded file decodes correctly");

  console.log("\n— Full run on sample_input.csv —");
  const ds = loadFile(ctx, "sample_input.csv", new Uint8Array(readFileSync("public/sample_input.csv")));
  expect(ds.rows.length === 100 && ds.headers.length === 10, "100 rows × 10 columns");
  expect(ds.rows.every((r) => !r[0].includes(".")), "IDs kept as text");

  const cols = await chooseColumns(ctx, ds);
  const picked = cols.filter((c) => c.translate).map((c) => c.name);
  console.log("   picked:", picked.join(", "));
  expect(JSON.stringify(picked) === JSON.stringify(["名称", "类型", "稀有度", "描述"]), "picks exactly 名称, 类型, 稀有度, 描述");
  expect(calls.classify === 0, "no AI call needed for the sample's columns");

  const langs = matchLanguages("English and German");
  const job = buildJob(ds, cols, langs);
  const cellsToTranslate = ds.rows.reduce((n, r) => n + cols.filter((c) => c.translate && r[c.index].trim()).length, 0);
  console.log(`   ${cellsToTranslate} non-empty cells → ${job.units.length} unique strings; ${estimateCalls(job)} translate calls planned`);
  expect(job.units.length < cellsToTranslate, "deduplication reduces the strings sent to the AI");

  let lastProgress = "";
  await translateLanguages(ctx, job, langs, { onProgress: (d, t) => (lastProgress = `${d}/${t}`) });
  console.log("   progress ended at", lastProgress, "| translate calls:", calls.translate);

  const out = buildOutput(ctx, job);
  writeFileSync("scripts/test-output.csv", out.csv);
  expect(out.rows.length === 100, "output has the same 100 rows");
  expect(out.headers.join(",").startsWith("id,item_key,名称,名称_en,名称_de,类型,类型_en,类型_de,稀有度,稀有度_en,稀有度_de,描述,描述_en,描述_de,价格"), "translations sit next to their source column");
  expect(out.headers.at(-1) === "translation_status", "status column at the end");
  expect(out.csv.charCodeAt(0) === 0xfeff, "output starts with a BOM for Excel");

  const iDesc = out.headers.indexOf("描述");
  const emptyRows = out.rows.filter((r) => r[iDesc] === "");
  expect(emptyRows.length > 0 && emptyRows.every((r) => r[iDesc + 1] === "" && r[iDesc + 2] === ""), "empty source cells stay empty");

  const repaired = out.rows.filter((r) => r[iDesc].includes("{1}") && !r[iDesc].includes("VIP"));
  expect(repaired.length > 0 && repaired.every((r) => r[iDesc + 1].includes("{1}") && r[iDesc + 2].includes("{1}")), "dropped {1} placeholders were repaired");

  const vipRow = out.rows.findIndex((r) => r[2] === "VIP月卡");
  expect(vipRow >= 0 && out.rows[vipRow].at(-1)!.startsWith("needs review"), "unfixable string is flagged, not hidden");
  expect(out.flagged.length === 1, `exactly one row flagged (got ${out.flagged.length})`);

  console.log("\n— Follow-ups —");
  const before = calls.translate;
  const r1 = await handleFollowup(ctx, job, "please also add Japanese");
  const out2 = buildOutput(null, job);
  expect(r1.changed && out2.headers.includes("名称_ja"), "“add Japanese” adds 名称_ja");
  const r2 = await handleFollowup(ctx, job, "row 3 German should be formal");
  expect(r2.changed && calls.translate > before, "row-level retranslate runs");

  console.log("\n— Trace —");
  for (const e of trace) console.log(`   [${e.actor.padEnd(4)}] ${e.status === "ok" ? " " : e.status === "warn" ? "!" : "x"} ${e.title}`);

  console.log(`\n${failures ? `${failures} FAILED` : "All checks passed."}`);
  process.exit(failures ? 1 : 0);
}

main();
