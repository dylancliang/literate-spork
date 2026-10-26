"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { httpApi } from "@/lib/api-client";
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
  type Job,
  type Output,
} from "@/lib/pipeline";
import type { ColumnDecision, Dataset, Lang, TraceEvent } from "@/lib/types";
import TracePanel from "./TracePanel";
import { PlanCard, ProgressCard, ResultCard } from "./Cards";

type Stage = "start" | "plan" | "running" | "done";

export type Msg =
  | { id: string; role: "user"; text: string; file?: string }
  | { id: string; role: "agent"; kind: "text"; text: string; tone?: "error" }
  | { id: string; role: "agent"; kind: "welcome" }
  | { id: string; role: "agent"; kind: "plan"; frozen?: { columns: string[]; languages: Lang[] } }
  | { id: string; role: "agent"; kind: "progress"; label: string; done: number; total: number; finished: boolean; failed?: boolean }
  | { id: string; role: "agent"; kind: "result"; output: Output; languages: Lang[]; fileName: string; translated: string[]; first: boolean };

type NewMsg = Msg extends infer M ? (M extends Msg ? Omit<M, "id"> & { id?: string } : never) : never;

let counter = 0;
const uid = () => `m${++counter}`;
const listNames = (ls: Lang[]) =>
  ls.length <= 1 ? ls.map((l) => l.name).join("") : `${ls.slice(0, -1).map((l) => l.name).join(", ")} and ${ls[ls.length - 1].name}`;

export default function Agent() {
  const [messages, setMessages] = useState<Msg[]>([{ id: "welcome", role: "agent", kind: "welcome" }]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [stage, setStage] = useState<Stage>("start");
  const [busy, setBusy] = useState(false);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [columns, setColumns] = useState<ColumnDecision[]>([]);
  const [langs, setLangs] = useState<Lang[]>([]);
  const [draft, setDraft] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const jobRef = useRef<Job | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const ctx: Ctx = useMemo(
    () => ({
      api: httpApi,
      trace: (e) => setTrace((t) => [...t, { ...e, id: uid(), at: Date.now() }]),
    }),
    []
  );

  const add = useCallback((m: NewMsg) => {
    const id = m.id ?? uid();
    setMessages((ms) => [...ms, { ...m, id } as Msg]);
    return id;
  }, []);
  const patch = useCallback((id: string, p: Partial<Msg>) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? ({ ...m, ...p } as Msg) : m)));
  }, []);
  const say = useCallback((text: string, tone?: "error") => add({ role: "agent", kind: "text", text, tone }), [add]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  // Auto-grow the text box.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [draft]);

  const showPlan = useCallback(() => {
    setMessages((ms) => [...ms.filter((m) => !(m.role === "agent" && m.kind === "plan" && !m.frozen)), { id: uid(), role: "agent", kind: "plan" }]);
    setStage("plan");
  }, []);

  // ---------- one entry point for everything the user sends ----------
  const send = useCallback(
    async (text: string, attached: File | null) => {
      text = text.trim();
      if ((!text && !attached) || busy || stage === "running") return;
      add({ role: "user", text, file: attached?.name });
      setDraft("");
      setFile(null);
      setBusy(true);
      try {
        // After a result, plain messages are follow-ups ("add Japanese", "make German formal").
        if (stage === "done" && !attached && jobRef.current) {
          await followUp(text);
          return;
        }

        let ds = dataset;
        let cols = columns;
        let ls = langs;
        if (attached) {
          if (!/\.(csv|tsv|txt)$/i.test(attached.name)) throw new Error("Please attach a .csv file.");
          ds = loadFile(ctx, attached.name, new Uint8Array(await attached.arrayBuffer()));
          cols = await chooseColumns(ctx, ds);
          jobRef.current = null;
          setDataset(ds);
          setColumns(cols);
        }
        if (text) {
          const found = await understandLanguages(ctx, text);
          if (found.length) {
            // A language typed on its own adds to the list; "only", "instead", "just" etc. replace it.
            // A new file with a new request starts fresh.
            const replace = attached || !langs.length || /\b(only|instead|just|replace|switch)\b|只|改成|换成|仅/i.test(text);
            ls = replace ? found : [...langs, ...found.filter((f) => !langs.some((l) => l.code === f.code))];
            setLangs(ls);
          } else if (!attached) {
            say(
              ds
                ? "I didn't catch a language there. Which languages should I translate into? For example: English and German."
                : "Attach a CSV with Chinese text and tell me which languages you want, for example: English and German."
            );
            return;
          }
        }

        if (ds) {
          if (!cols.some((c) => c.translate)) {
            say("I didn't find any columns with Chinese text. If one should be translated anyway, tick it in the plan below.");
          }
          showPlan();
        } else if (ls.length) {
          say(`Got it: ${listNames(ls)}. Now attach the CSV file you want translated.`);
        }
      } catch (e) {
        say(e instanceof Error ? e.message : String(e), "error");
      } finally {
        setBusy(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, stage, dataset, columns, langs, ctx]
  );

  const approve = useCallback(async () => {
    if (!dataset || !langs.length) return;
    const chosen = columns.filter((c) => c.translate);
    setMessages((ms) =>
      ms.map((m) => (m.role === "agent" && m.kind === "plan" && !m.frozen ? { ...m, frozen: { columns: chosen.map((c) => c.name), languages: langs } } : m))
    );
    const overrides = columns.filter((c) => c.method === "user");
    ctx.trace({
      step: "approve",
      actor: "user",
      title: `You approved: ${chosen.length} column${chosen.length === 1 ? "" : "s"} → ${listNames(langs)}`,
      detail: overrides.length ? `You changed: ${overrides.map((c) => `${c.name} (${c.translate ? "translate" : "skip"})`).join(", ")}` : "No changes to the suggested columns.",
      status: "ok",
    });
    setStage("running");
    const job = buildJob(dataset, columns, langs);
    jobRef.current = job;
    const pid = add({
      role: "agent",
      kind: "progress",
      label: `Translating ${job.units.length} unique strings into ${listNames(langs)}`,
      done: 0,
      total: estimateCalls(job),
      finished: false,
    });
    try {
      await translateLanguages(ctx, job, langs, { onProgress: (done, total) => patch(pid, { done, total } as Partial<Msg>) });
      patch(pid, { finished: true } as Partial<Msg>);
      const output = buildOutput(ctx, job);
      add({ role: "agent", kind: "result", output, languages: [...job.languages], fileName: dataset.fileName, translated: chosen.map((c) => c.name), first: true });
      setStage("done");
    } catch (e) {
      patch(pid, { failed: true } as Partial<Msg>);
      say(`Translation stopped: ${e instanceof Error ? e.message : String(e)}`, "error");
      jobRef.current = null;
      showPlan(); // bring back an editable plan so the user can try again
    }
  }, [dataset, columns, langs, ctx, add, patch, say, showPlan]);

  const followUp = async (text: string) => {
    const job = jobRef.current!;
    setStage("running");
    let pid: string | null = null;
    try {
      const r = await handleFollowup(ctx, job, text, (done, total) => {
        if (!pid) pid = add({ role: "agent", kind: "progress", label: "Updating translations", done, total, finished: false });
        else patch(pid, { done, total } as Partial<Msg>);
      });
      if (pid) patch(pid, { finished: true } as Partial<Msg>);
      if (r.reply) say(r.reply);
      if (r.changed) {
        const output = buildOutput(ctx, job);
        setLangs([...job.languages]);
        add({
          role: "agent",
          kind: "result",
          output,
          languages: [...job.languages],
          fileName: job.ds.fileName,
          translated: job.columns.filter((c) => c.translate).map((c) => c.name),
          first: false,
        });
      }
    } catch (e) {
      say(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setStage("done");
    }
  };

  const useSample = async () => {
    const res = await fetch("/sample_input.csv");
    const blob = await res.blob();
    send("English and German", new File([blob], "sample_input.csv", { type: "text/csv" }));
  };

  const toggleColumn = (name: string) =>
    setColumns((cs) => cs.map((c) => (c.name === name ? { ...c, translate: !c.translate, method: "user", reason: c.translate ? "You turned this off" : "You turned this on" } : c)));
  const removeLang = (code: string) => setLangs((ls) => ls.filter((l) => l.code !== code));

  const locked = busy || stage === "running";
  const placeholder =
    stage === "running"
      ? "Working…"
      : stage === "done"
        ? "Ask for a change: add Japanese, make the German formal, redo row 12…"
        : stage === "plan"
          ? "Change the languages, or press Translate in the plan"
          : "Attach a CSV and name your languages, e.g. English and German";

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !locked) setFile(f);
  };

  return (
    <main className="workspace">
      <section
        className={`chat${dragging ? " dragging" : ""}`}
        aria-label="Conversation"
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <div className="messages" aria-live="polite">
          <div className="messages-inner">
            {messages.map((m) => {
              if (m.role === "user")
                return (
                  <div key={m.id} className="msg-user">
                    {m.file && <FileChip name={m.file} />}
                    {m.text && <div className="bubble">{m.text}</div>}
                  </div>
                );
              return (
                <div key={m.id} className="msg-agent">
                  <div className="avatar" aria-hidden="true">
                    文
                  </div>
                  <div className="agent-body">
                    {m.kind === "welcome" && (
                      <div className="agent-text">
                        Attach a CSV with Chinese text and tell me which languages you want. I'll pick the columns that need translating, show you the plan,
                        then give you the file back with a new column for each language.
                        <div className="btn-row">
                          <button className="btn" onClick={useSample} disabled={locked}>
                            Try the sample file in English and German
                          </button>
                          <a className="btn" href="/sample_input.csv" download>
                            Download the sample
                          </a>
                        </div>
                      </div>
                    )}
                    {m.kind === "text" && <div className={`agent-text${m.tone === "error" ? " error" : ""}`}>{m.text}</div>}
                    {m.kind === "plan" &&
                      (m.frozen ? (
                        <div className="frozen">
                          Plan approved: {m.frozen.columns.join(", ") || "no columns"} → {listNames(m.frozen.languages)}.
                        </div>
                      ) : (
                        dataset && (
                          <PlanCard
                            dataset={dataset}
                            columns={columns}
                            languages={langs}
                            onToggle={toggleColumn}
                            onRemoveLang={removeLang}
                            onApprove={approve}
                            disabled={locked}
                          />
                        )
                      ))}
                    {m.kind === "progress" && <ProgressCard label={m.label} done={m.done} total={m.total} finished={m.finished} failed={m.failed} />}
                    {m.kind === "result" && (
                      <ResultCard output={m.output} languages={m.languages} fileName={m.fileName} translated={m.translated} first={m.first} />
                    )}
                  </div>
                </div>
              );
            })}
            {busy && stage !== "running" && <div className="hint">Working…</div>}
            <div ref={endRef} />
          </div>
        </div>

        <div className="composer-wrap">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft, file);
            }}
          >
            {file && (
              <div className="attached">
                <span className="file-chip">
                  <FileIcon />
                  {file.name}
                  <button type="button" aria-label="Remove attached file" onClick={() => setFile(null)}>
                    ×
                  </button>
                </span>
              </div>
            )}
            <div className="composer-row">
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt,text/csv"
                hidden
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  e.target.value = "";
                }}
              />
              <button type="button" className="icon-btn" aria-label="Attach a CSV file" onClick={() => fileInput.current?.click()} disabled={locked}>
                <ClipIcon />
              </button>
              <label htmlFor="msg" className="sr-only">
                Message
              </label>
              <textarea
                id="msg"
                ref={textRef}
                rows={1}
                value={draft}
                placeholder={placeholder}
                disabled={locked}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(draft, file);
                  }
                }}
              />
              <button type="submit" className="icon-btn send" aria-label="Send" disabled={locked || (!draft.trim() && !file)}>
                <SendIcon />
              </button>
            </div>
          </form>
        </div>
      </section>

      <TracePanel events={trace} />
    </main>
  );
}

export function FileChip({ name }: { name: string }) {
  return (
    <span className="file-chip">
      <FileIcon />
      {name}
    </span>
  );
}

function FileIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}
function ClipIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 11-8.5 8.5a5 5 0 0 1-7-7L14 4a3.3 3.3 0 0 1 4.7 4.7l-8.6 8.6a1.7 1.7 0 0 1-2.3-2.4L15.5 7" />
    </svg>
  );
}
function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}
