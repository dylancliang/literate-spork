// The agent's workflow. It runs in the browser and calls the server only for the
// steps that need judgment (the AI). Everything with a checkable right answer is plain code.

import { parseCsv, toCsv } from "./csv";
import { ruleDecisions } from "./columns";
import { matchLanguages } from "./languages";
import { checkTranslation } from "./validate";
import type { AgentApi, ColumnDecision, Dataset, Lang, TraceEvent, TranslateItem, Unit } from "./types";

export const MAX_ROWS = 2000;
export const BATCH_ITEMS = 20;
const BATCH_CHARS = 1800;
const CONCURRENCY = 6;

export type Ctx = {
  api: AgentApi;
  trace: (e: Omit<TraceEvent, "id" | "at">) => void;
};

export type Job = {
  ds: Dataset;
  columns: ColumnDecision[];
  units: Unit[];
  unitByCell: Map<string, string>; // `${colIndex}\u0000${text}` -> unit id
  languages: Lang[];
  translations: Record<string, Record<string, string>>; // lang -> unit -> text
  problems: Record<string, Record<string, string[]>>; // lang -> unit -> problems
  instructions: Record<string, string>; // lang -> latest style instruction
};

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Step 1: understand the request ----------

export async function understandLanguages(ctx: Ctx, text: string): Promise<Lang[]> {
  const t0 = now();
  const quick = matchLanguages(text);
  if (quick.length) {
    ctx.trace({
      step: "parse_request",
      actor: "code",
      title: `Read target languages: ${quick.map((l) => l.name).join(", ")}`,
      detail: "Matched by name from a built-in list, so no AI call was needed.",
      data: quick,
      ms: now() - t0,
      status: "ok",
    });
    return quick;
  }
  if (!text.trim()) return [];
  try {
    const langs = await ctx.api.parseLanguages(text);
    ctx.trace({
      step: "parse_request",
      actor: "ai",
      title: langs.length ? `AI read target languages: ${langs.map((l) => l.name).join(", ")}` : "AI found no target language in the message",
      detail: "The message didn't name a language from the built-in list, so the AI interpreted it.",
      data: langs,
      ms: now() - t0,
      status: "ok",
    });
    return langs;
  } catch (e) {
    ctx.trace({ step: "parse_request", actor: "ai", title: "Couldn't interpret the languages", detail: String(e), ms: now() - t0, status: "error" });
    return [];
  }
}

// ---------- Step 2: open and inspect the file ----------

export function loadFile(ctx: Ctx, fileName: string, bytes: Uint8Array): Dataset {
  const t0 = now();
  const ds = parseCsv(fileName, bytes);
  if (ds.rows.length > MAX_ROWS) {
    throw new Error(`This demo handles up to ${MAX_ROWS} rows; the file has ${ds.rows.length}.`);
  }
  ctx.trace({
    step: "profile_csv",
    actor: "code",
    title: `Opened ${fileName}: ${ds.rows.length} rows × ${ds.headers.length} columns`,
    detail: `Text encoding: ${ds.encoding}. Separator: ${ds.delimiter}. All cells kept as text so IDs and dates aren't reformatted.`,
    data: { headers: ds.headers },
    ms: now() - t0,
    status: "ok",
  });
  return ds;
}

// ---------- Step 3: pick the columns to translate ----------

export async function chooseColumns(ctx: Ctx, ds: Dataset): Promise<ColumnDecision[]> {
  const t0 = now();
  const { decided, undecided } = ruleDecisions(ds);
  ctx.trace({
    step: "pick_columns",
    actor: "code",
    title: `Rules decided ${decided.length} of ${ds.headers.length} columns${undecided.length ? `; ${undecided.length} unclear` : ""}`,
    detail: "Each column is scored by how many cells contain Chinese and how many look like IDs, numbers or paths.",
    data: decided.map((d) => ({ column: d.name, translate: d.translate, reason: d.reason })),
    ms: now() - t0,
    status: "ok",
  });

  const fromAi: ColumnDecision[] = [];
  if (undecided.length) {
    const t1 = now();
    try {
      const verdicts = await withRetry(() => ctx.api.classifyColumns(undecided.map((u) => ({ name: u.name, stats: u.stats }))));
      for (const u of undecided) {
        const v = verdicts.find((x) => x.name === u.name);
        fromAi.push({
          name: u.name,
          index: u.index,
          stats: u.stats,
          method: "ai",
          translate: v ? v.translate : u.stats.chineseShare >= 0.5,
          reason: v ? v.reason : "AI gave no verdict; fell back to the Chinese-share rule",
        });
      }
      ctx.trace({
        step: "pick_columns",
        actor: "ai",
        title: `AI judged ${undecided.length} unclear column${undecided.length > 1 ? "s" : ""}`,
        data: fromAi.map((d) => ({ column: d.name, translate: d.translate, reason: d.reason })),
        ms: now() - t1,
        status: "ok",
      });
    } catch (e) {
      for (const u of undecided) {
        fromAi.push({
          name: u.name,
          index: u.index,
          stats: u.stats,
          method: "rule",
          translate: u.stats.chineseShare >= 0.5,
          reason: "AI unavailable; used the Chinese-share rule",
        });
      }
      ctx.trace({ step: "pick_columns", actor: "ai", title: "AI column check failed; used rules instead", detail: String(e), ms: now() - t1, status: "warn" });
    }
  }
  return [...decided, ...fromAi].sort((a, b) => a.index - b.index);
}

// ---------- Plan: deduplicate the text that needs translating ----------

export function buildJob(ds: Dataset, columns: ColumnDecision[], languages: Lang[]): Job {
  const units: Unit[] = [];
  const unitByCell = new Map<string, string>();
  for (const col of columns.filter((c) => c.translate)) {
    for (const row of ds.rows) {
      const text = row[col.index];
      if (text.trim() === "") continue;
      const key = `${col.index}\u0000${text}`;
      if (unitByCell.has(key)) continue;
      const id = `u${units.length + 1}`;
      units.push({ id, column: col.name, text });
      unitByCell.set(key, id);
    }
  }
  return { ds, columns, units, unitByCell, languages, translations: {}, problems: {}, instructions: {} };
}

export function estimateCalls(job: Job, langs: Lang[] = job.languages): number {
  return batchUnits(job.units).length * langs.length;
}

function batchUnits(units: Unit[]): Unit[][] {
  const batches: Unit[][] = [];
  let cur: Unit[] = [];
  let chars = 0;
  for (const u of units) {
    if (cur.length && (cur.length >= BATCH_ITEMS || chars + u.text.length > BATCH_CHARS)) {
      batches.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(u);
    chars += u.text.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

// ---------- Steps 4–6: translate, check, repair ----------

export async function translateLanguages(
  ctx: Ctx,
  job: Job,
  langs: Lang[],
  opts: { instruction?: string; onlyUnits?: Set<string>; onProgress?: (done: number, total: number) => void } = {}
): Promise<void> {
  const units = opts.onlyUnits ? job.units.filter((u) => opts.onlyUnits!.has(u.id)) : job.units;
  const batches = batchUnits(units);
  const tasks: { lang: Lang; batch: Unit[]; n: number }[] = [];
  for (const lang of langs) {
    job.translations[lang.code] ??= {};
    job.problems[lang.code] ??= {};
    if (opts.instruction) job.instructions[lang.code] = opts.instruction;
    batches.forEach((batch, i) => tasks.push({ lang, batch, n: i + 1 }));
  }

  let done = 0;
  let failed = 0;
  let firstError = "";
  const total = tasks.length;
  opts.onProgress?.(0, total);

  await runPool(tasks, CONCURRENCY, async ({ lang, batch, n }) => {
    const t0 = now();
    try {
      const out = await withRetry(() =>
        ctx.api.translate({ lang, items: batch.map((u) => ({ id: u.id, column: u.column, text: u.text })), instruction: job.instructions[lang.code] })
      );
      const ids = new Set(batch.map((u) => u.id));
      let got = 0;
      for (const r of out) {
        if (ids.has(r.id)) {
          job.translations[lang.code][r.id] = r.text;
          got++;
        }
      }
      ctx.trace({
        step: "translate",
        actor: "ai",
        title: `Translated batch ${n}/${batches.length} → ${lang.name} (${got}/${batch.length} strings)`,
        ms: now() - t0,
        status: got === batch.length ? "ok" : "warn",
      });
    } catch (e) {
      failed++;
      firstError ||= e instanceof Error ? e.message : String(e);
      ctx.trace({ step: "translate", actor: "ai", title: `Batch ${n}/${batches.length} → ${lang.name} failed`, detail: String(e), ms: now() - t0, status: "error" });
    }
    done++;
    opts.onProgress?.(done, total);
  });

  // If nothing came back at all, it's a setup or service problem, not a translation problem: say so plainly.
  if (total > 0 && failed === total) throw new Error(firstError);

  for (const lang of langs) {
    const failing = checkAll(ctx, job, lang, units, "check");
    if (failing.length) await repair(ctx, job, lang, failing);
  }
}

function checkAll(ctx: Ctx, job: Job, lang: Lang, units: Unit[], phase: "check" | "recheck"): Unit[] {
  const t0 = now();
  const failing: Unit[] = [];
  for (const u of units) {
    const p = checkTranslation(u.text, job.translations[lang.code][u.id], lang.code);
    if (p.length) {
      job.problems[lang.code][u.id] = p;
      failing.push(u);
    } else {
      delete job.problems[lang.code][u.id];
    }
  }
  if (phase === "check") {
    ctx.trace({
      step: "validate",
      actor: "code",
      title: `Checked ${units.length} ${lang.name} strings: ${failing.length ? `${failing.length} need a fix` : "all passed"}`,
      detail: "Checks: one answer per string, nothing empty, placeholders and tags unchanged, no Chinese left over, no runaway length.",
      data: failing.slice(0, 20).map((u) => ({ id: u.id, source: u.text, translation: job.translations[lang.code][u.id], problems: job.problems[lang.code][u.id] })),
      ms: now() - t0,
      status: failing.length ? "warn" : "ok",
    });
  }
  return failing;
}

async function repair(ctx: Ctx, job: Job, lang: Lang, failing: Unit[]): Promise<void> {
  const t0 = now();
  const items: TranslateItem[] = failing.map((u) => ({
    id: u.id,
    column: u.column,
    text: u.text,
    problem: `Your previous translation was: ${JSON.stringify(job.translations[lang.code][u.id] ?? "")}. Problem: ${job.problems[lang.code][u.id].join("; ")}`,
  }));
  try {
    for (let i = 0; i < items.length; i += BATCH_ITEMS) {
      const out = await withRetry(() => ctx.api.translate({ lang, items: items.slice(i, i + BATCH_ITEMS), instruction: job.instructions[lang.code] }));
      for (const r of out) {
        // Only accept a repair if it actually passes the checks.
        const u = failing.find((f) => f.id === r.id);
        if (u && checkTranslation(u.text, r.text, lang.code).length === 0) job.translations[lang.code][r.id] = r.text;
      }
    }
  } catch (e) {
    ctx.trace({ step: "repair", actor: "ai", title: `Repair call for ${lang.name} failed`, detail: String(e), status: "error", ms: now() - t0 });
  }
  const still = checkAll(ctx, job, lang, failing, "recheck");
  ctx.trace({
    step: "repair",
    actor: "ai",
    title: `Re-translated ${failing.length} flagged ${lang.name} string${failing.length > 1 ? "s" : ""}: ${failing.length - still.length} fixed${still.length ? `, ${still.length} marked for review` : ""}`,
    data: still.map((u) => ({ id: u.id, source: u.text, translation: job.translations[lang.code][u.id], problems: job.problems[lang.code][u.id] })),
    ms: now() - t0,
    status: still.length ? "warn" : "ok",
  });
}

// ---------- Step 7: build the output file ----------

export type Output = {
  headers: string[];
  rows: string[][];
  csv: string;
  flagged: { row: number; issues: string[] }[];
  stats: { rows: number; strings: number; cells: number; flaggedRows: number };
};

export function buildOutput(ctx: Ctx | null, job: Job): Output {
  const t0 = now();
  const { ds, columns, languages } = job;
  const translateSet = new Set(columns.filter((c) => c.translate).map((c) => c.index));
  const headers: string[] = [];
  ds.headers.forEach((h, i) => {
    headers.push(h);
    if (translateSet.has(i)) for (const l of languages) headers.push(`${h}_${l.code}`);
  });
  headers.push("translation_status");

  const flagged: Output["flagged"] = [];
  let cells = 0;
  const rows = ds.rows.map((row, r) => {
    const out: string[] = [];
    const issues: string[] = [];
    row.forEach((cell, i) => {
      out.push(cell);
      if (!translateSet.has(i)) return;
      const unitId = cell.trim() === "" ? undefined : job.unitByCell.get(`${i}\u0000${cell}`);
      for (const l of languages) {
        if (!unitId) {
          out.push("");
          continue;
        }
        out.push(job.translations[l.code]?.[unitId] ?? "");
        cells++;
        const p = job.problems[l.code]?.[unitId];
        if (p?.length) issues.push(`${ds.headers[i]}_${l.code}: ${p.join("; ")}`);
      }
    });
    out.push(issues.length ? `needs review: ${issues.join(" | ")}` : "ok");
    if (issues.length) flagged.push({ row: r + 1, issues });
    return out;
  });

  const output: Output = {
    headers,
    rows,
    csv: toCsv(headers, rows),
    flagged,
    stats: { rows: rows.length, strings: job.units.length, cells, flaggedRows: flagged.length },
  };
  ctx?.trace({
    step: "export",
    actor: "code",
    title: `Built output: ${rows.length} rows × ${headers.length} columns`,
    detail: "Original columns kept; each translated column is followed by one column per language; a translation_status column marks rows to review. Saved as UTF-8 with BOM for Excel.",
    data: { headers },
    ms: now() - t0,
    status: flagged.length ? "warn" : "ok",
  });
  return output;
}

// ---------- Follow-ups after the first result ----------

export async function handleFollowup(
  ctx: Ctx,
  job: Job,
  message: string,
  onProgress?: (done: number, total: number) => void
): Promise<{ reply: string; changed: boolean }> {
  const t0 = now();
  let action;
  try {
    action = await withRetry(() =>
      ctx.api.routeFollowup({
        message,
        languages: job.languages,
        columns: job.columns.map((c) => ({ name: c.name, translate: c.translate, reason: c.reason })),
        rowCount: job.ds.rows.length,
      })
    );
  } catch (e) {
    // Fallback without the AI: if the message names new languages, add them.
    const langs = matchLanguages(message).filter((l) => !job.languages.some((x) => x.code === l.code));
    if (!langs.length) {
      ctx.trace({ step: "follow_up", actor: "ai", title: "Couldn't interpret the follow-up", detail: String(e), status: "error", ms: now() - t0 });
      return { reply: "Sorry, I couldn't process that request just now. Please try again.", changed: false };
    }
    action = { action: "add_languages" as const, languages: langs, instruction: "", rows: [], reply: "" };
  }

  ctx.trace({
    step: "follow_up",
    actor: "ai",
    title: `Understood follow-up as: ${describeAction(action)}`,
    data: action,
    ms: now() - t0,
    status: "ok",
  });

  if (action.action === "answer") return { reply: action.reply, changed: false };

  if (action.action === "add_languages") {
    const fresh = action.languages.filter((l) => !job.languages.some((x) => x.code === l.code));
    if (!fresh.length) return { reply: "Those languages are already in the file.", changed: false };
    job.languages = [...job.languages, ...fresh];
    await translateLanguages(ctx, job, fresh, { instruction: action.instruction || undefined, onProgress });
    return { reply: action.reply || `Added ${fresh.map((l) => l.name).join(", ")}.`, changed: true };
  }

  // retranslate
  const langs = action.languages.length
    ? job.languages.filter((l) => action.languages.some((x) => x.code.toLowerCase() === l.code.toLowerCase()))
    : job.languages;
  if (!langs.length) return { reply: "That language isn't in the file yet. Ask me to add it first.", changed: false };
  let only: Set<string> | undefined;
  if (action.rows.length) {
    only = new Set();
    for (const r of action.rows) {
      const row = job.ds.rows[r - 1];
      if (!row) continue;
      row.forEach((cell, i) => {
        const id = job.unitByCell.get(`${i}\u0000${cell}`);
        if (id) only!.add(id);
      });
    }
    if (!only.size) return { reply: "I couldn't find those rows. Row numbers start at 1 for the first data row.", changed: false };
  }
  await translateLanguages(ctx, job, langs, { instruction: action.instruction || undefined, onlyUnits: only, onProgress });
  return { reply: action.reply || "Done.", changed: true };
}

function describeAction(a: { action: string; languages: Lang[]; instruction: string; rows: number[] }): string {
  if (a.action === "answer") return "a question (no re-translation)";
  const langs = a.languages.map((l) => l.name).join(", ") || "all languages";
  const rows = a.rows.length ? `, rows ${a.rows.join(", ")}` : "";
  const instr = a.instruction ? ` with instruction "${a.instruction}"` : "";
  return a.action === "add_languages" ? `add ${langs}${instr}` : `re-translate ${langs}${rows}${instr}`;
}

// ---------- helpers ----------

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if ((e as { retryable?: boolean }).retryable === false) break;
      if (i < attempts - 1) await sleep(1000 * 2 ** i);
    }
  }
  throw last;
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      await worker(items[i]);
    }
  });
  await Promise.all(runners);
}
