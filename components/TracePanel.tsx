"use client";

import { useEffect, useRef, useState } from "react";
import type { TraceEvent } from "@/lib/types";

const actorLabel = { code: "Code", ai: "AI", user: "You" } as const;

export default function TracePanel({ events }: { events: TraceEvent[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLOListElement>(null);
  const aiCalls = events.filter((e) => e.actor === "ai").length;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <aside className="trace" aria-label="Agent trace">
      <div className="trace-head">
        <h2>
          Agent trace <span className="tabnum">{events.length ? `${events.length} steps, ${aiCalls} by AI` : ""}</span>
        </h2>
        <div className="legend">
          <span className="badge code">Code: fixed rules</span>
          <span className="badge ai">AI: judgment</span>
          <span className="badge user">You: approval</span>
        </div>
      </div>
      <ol className="trace-list" ref={listRef}>
        {events.length === 0 && (
          <li className="trace-empty">
            Each step the agent takes shows up here, marked by who did it: plain code for anything with one right answer, the AI where judgment is needed,
            and you when it asks for approval. Select a step to see its details.
          </li>
        )}
        {events.map((e) => {
          const isOpen = open.has(e.id);
          const hasMore = Boolean(e.detail || e.data);
          return (
            <li key={e.id} className={`event ${e.actor} ${e.status}`}>
              <button onClick={() => hasMore && toggle(e.id)} aria-expanded={hasMore ? isOpen : undefined} disabled={!hasMore}>
                <div className="event-title">
                  <span className="dot" aria-hidden="true" />
                  <span>{e.title}</span>
                </div>
                <div className="event-meta tabnum">
                  <span>{actorLabel[e.actor]}</span>
                  {e.ms !== undefined && <span>{e.ms < 1000 ? `${Math.max(1, Math.round(e.ms))} ms` : `${(e.ms / 1000).toFixed(1)} s`}</span>}
                  {e.status === "warn" && <span>needs attention</span>}
                  {e.status === "error" && <span>failed</span>}
                  {hasMore && <span>{isOpen ? "Hide details" : "Details"}</span>}
                </div>
              </button>
              {isOpen && (
                <div className="event-detail">
                  {e.detail && <div>{e.detail}</div>}
                  {e.data !== undefined && <pre>{JSON.stringify(e.data, null, 2)}</pre>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
