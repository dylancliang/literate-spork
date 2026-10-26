"use client";

import { useMemo, useState } from "react";
import { buildJob, estimateCalls, type Output } from "@/lib/pipeline";
import type { ColumnDecision, Dataset, Lang } from "@/lib/types";

const methodLabel = { rule: "Rule", ai: "AI", user: "You" } as const;
const methodClass = { rule: "code", ai: "ai", user: "user" } as const;

export function PlanCard(props: {
  dataset: Dataset;
  columns: ColumnDecision[];
  languages: Lang[];
  onToggle: (name: string) => void;
  onRemoveLang: (code: string) => void;
  onApprove: () => void;
  disabled: boolean;
}) {
  const { dataset, columns, languages } = props;
  const chosen = columns.filter((c) => c.translate);
  const { units, calls, cells } = useMemo(() => {
    const job = buildJob(dataset, columns, languages.length ? languages : [{ code: "xx", name: "" }]);
    const cells = dataset.rows.reduce((n, r) => n + chosen.filter((c) => r[c.index].trim()).length, 0);
    return { units: job.units.length, calls: estimateCalls(job), cells };
  }, [dataset, columns, languages, chosen]);
  const seconds = Math.max(10, Math.ceil(calls / 6) * 20);

  return (
    <div className="card">
      <h2>Here's my plan</h2>
      <p className="sub">Untick any column you want left alone, then start. Nothing is sent for translation until you press the button.</p>
      <div className="plan-facts tabnum">
        <span>
          <b>{dataset.fileName}</b>
        </span>
        <span>
          <b>{dataset.rows.length}</b> rows
        </span>
        <span>
          <b>{cells}</b> cells to translate
        </span>
        <span>
          <b>{units}</b> unique strings (repeats are translated once)
        </span>
      </div>

      <ul className="col-list">
        {columns.map((c) => {
          const id = `col-${c.index}`;
          return (
            <li key={c.name} className={c.translate ? "" : "off"}>
              <input id={id} type="checkbox" checked={c.translate} onChange={() => props.onToggle(c.name)} disabled={props.disabled} />
              <label htmlFor={id}>
                <span className="colname">{c.name}</span>
                {c.stats.samples[0] && <span className="sample">e.g. {c.stats.samples[0]}</span>}
              </label>
              <span className="reason">{c.reason}</span>
              <span className={`badge ${methodClass[c.method]}`} title={`Decided by: ${methodLabel[c.method]}`}>
                {methodLabel[c.method]}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="langs">
        <span>Into:</span>
        {languages.length ? (
          languages.map((l) => (
            <span key={l.code} className="lang-chip">
              {l.name} <span className="hint">{l.code}</span>
              <button type="button" aria-label={`Remove ${l.name}`} onClick={() => props.onRemoveLang(l.code)} disabled={props.disabled}>
                ×
              </button>
            </span>
          ))
        ) : (
          <span className="hint">No languages yet. Type them in the box below, e.g. English and German.</span>
        )}
      </div>

      <div className="btn-row">
        <button className="btn primary" onClick={props.onApprove} disabled={props.disabled || !languages.length || !units}>
          Translate {chosen.length} column{chosen.length === 1 ? "" : "s"}
          {languages.length ? ` into ${languages.map((l) => l.name).join(", ")}` : ""}
        </button>
        {languages.length > 0 && units > 0 && (
          <span className="hint tabnum">
            {calls} AI calls, about {seconds} seconds
          </span>
        )}
      </div>
    </div>
  );
}

export function ProgressCard(props: {
  label: string;
  done: number;
  total: number;
  finished: boolean;
  failed?: boolean;
  cancelled?: boolean;
  paused?: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}) {
  const { label, done, total, finished, failed, cancelled, paused } = props;
  const pct = total ? Math.round((done / total) * 100) : 0;
  if (failed || cancelled)
    return (
      <div className="card progress" role="status">
        <div className="label">
          <span>{label}</span>
          <span>{cancelled ? "Cancelled" : "Stopped"}</span>
        </div>
      </div>
    );
  const status = finished
    ? "Checked and done"
    : paused
      ? `Paused at ${done} of ${total} batches`
      : done >= total && total > 0
        ? "Checking…"
        : `${done} of ${total} batches`;
  return (
    <div className="card progress" role="status">
      <div className="label tabnum">
        <span>{finished ? label.replace(/^Translating/, "Translated") : label}</span>
        <span>{status}</span>
      </div>
      <div className={`bar${paused ? " paused" : ""}`} aria-hidden="true">
        <span style={{ width: `${finished ? 100 : pct}%` }} />
      </div>
      {!finished && (
        <div className="run-controls">
          {paused ? (
            <button className="btn" onClick={props.onResume}>
              Resume
            </button>
          ) : (
            <button className="btn" onClick={props.onPause}>
              Pause
            </button>
          )}
          <button className="btn" onClick={props.onCancel}>
            Cancel
          </button>
          {paused && <span className="hint">Batches already sent will finish; nothing new starts until you resume.</span>}
        </div>
      )}
    </div>
  );
}

export function ConfirmCard(props: {
  reply: string;
  summary: string;
  calls: number;
  status: "pending" | "approved" | "declined";
  onGo: () => void;
  onDecline: () => void;
}) {
  if (props.status !== "pending")
    return (
      <div className="frozen">
        {props.status === "approved" ? "Approved" : "Not run"}: {props.summary}.
      </div>
    );
  return (
    <div className="card">
      {props.reply && <p className="sub" style={{ marginBottom: 8 }}>{props.reply}</p>}
      <h2>{props.summary}</h2>
      <p className="hint tabnum" style={{ margin: "4px 0 0" }}>
        {props.calls} AI call{props.calls === 1 ? "" : "s"}. Nothing changes until you choose.
      </p>
      <div className="btn-row">
        <button className="btn primary" onClick={props.onGo}>
          Go ahead
        </button>
        <button className="btn" onClick={props.onDecline}>
          Not now
        </button>
      </div>
    </div>
  );
}

export function ResultCard(props: { output: Output; languages: Lang[]; fileName: string; translated: string[]; first: boolean }) {
  const { output, languages, translated } = props;
  const [showAll, setShowAll] = useState(false);
  const outName = props.fileName.replace(/\.(csv|tsv|txt)$/i, "") + "_translated.csv";
  const href = useMemo(() => URL.createObjectURL(new Blob([output.csv], { type: "text/csv;charset=utf-8" })), [output.csv]);

  // Preview only the translated columns side by side; other columns are unchanged in the file.
  const groups = translated.map((name) => ({
    name,
    src: output.headers.indexOf(name),
    targets: languages.map((l) => ({ lang: l, idx: output.headers.indexOf(`${name}_${l.code}`) })),
  }));
  const flaggedSet = new Set(output.flagged.map((f) => f.row));
  const rows = showAll ? output.rows : output.rows.slice(0, 8);

  return (
    <div className="card">
      <h2>{props.first ? "Done" : "Updated"}: {output.stats.rows} rows into {languages.map((l) => l.name).join(", ")}</h2>
      <div className="stats tabnum">
        <span>
          <b>{output.stats.strings}</b> unique strings translated
        </span>
        <span>
          <b>{output.stats.cells}</b> cells filled
        </span>
        <span className={output.stats.flaggedRows ? "warn" : ""}>
          <b>{output.stats.flaggedRows}</b> row{output.stats.flaggedRows === 1 ? "" : "s"} to review
        </span>
      </div>

      <div className="table-wrap">
        <table className="preview">
          <thead>
            <tr>
              <th className="num">#</th>
              {groups.map((g) => [
                <th key={g.name} className="src">
                  {g.name}
                </th>,
                ...g.targets.map((t) => (
                  <th key={`${g.name}-${t.lang.code}`}>
                    {g.name}_<span className="th-lang">{t.lang.code}</span>
                  </th>
                )),
              ])}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={flaggedSet.has(i + 1) ? "flag" : ""}>
                <td className="num tabnum">{i + 1}</td>
                {groups.map((g) => [
                  <td key={g.name} className="src">
                    {r[g.src]}
                  </td>,
                  ...g.targets.map((t) => <td key={`${g.name}-${t.lang.code}`}>{r[t.idx]}</td>),
                ])}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {output.rows.length > 8 && (
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="linkish" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show fewer rows" : `Show all ${output.rows.length} rows`}
          </button>
          <span className="hint">The file also keeps every other column unchanged, plus a translation_status column.</span>
        </div>
      )}

      {output.flagged.length > 0 && (
        <div className="flags">
          <b>
            {output.flagged.length} row{output.flagged.length === 1 ? "" : "s"} failed the automatic checks even after a retry.
          </b>{" "}
          They're marked "needs review" in the file.
          <ul>
            {output.flagged.slice(0, 6).map((f) => (
              <li key={f.row}>
                Row {f.row}: {f.issues.join("; ")}
              </li>
            ))}
            {output.flagged.length > 6 && <li>…and {output.flagged.length - 6} more in the file.</li>}
          </ul>
        </div>
      )}

      <div className="btn-row">
        <a className="btn primary" href={href} download={outName}>
          Download {outName}
        </a>
      </div>
      <p className="next-hint">
        Want changes? Ask below: “add Japanese”, “make the German formal (Sie)”, “redo row 12”, or “why wasn't icon translated?”
      </p>
    </div>
  );
}
