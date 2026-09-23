"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { editField, rerunAssistant, routeDocument } from "@/app/actions";
import { QUEUES, type Queue } from "@/data/sops";
import type { FieldCheck } from "@/lib/checks";
import { locate } from "@/lib/checks";
import type { DocType, FieldKey } from "@/lib/fields";
import type { Routing } from "@/lib/routing";
import s from "./Workbench.module.css";

export type WorkbenchData = {
  doc: { id: number; channel: "fax" | "portal" | "email"; sender: string; receivedAt: string; pages: number; body: string; closed: boolean };
  proposal: {
    id: number;
    model: string;
    promptVersion: string;
    summary: string;
    clinicalQuote: string | null;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    createdAt: string;
  } | null;
  assessment: { docType: DocType; docTypeLabel: string; checks: FieldCheck[]; routing: Routing } | null;
  routed: { queue: string; taskId: number; by: string; at: string; tags: string[]; suggested: string | null } | null;
  audit: { id: number; at: string; actor: string; event: string; detail: Record<string, unknown> }[];
  perms: { route: boolean; routeClinical: boolean; edit: boolean; run: boolean };
  roleLabel: string;
};

const CLINICAL = "__clinical";
type Mark = { key: string; start: number; end: number; tone: "yellow" | "pink" | "orange" };

const tz = { timeZone: "America/Chicago" } as const;
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", ...tz });
const stamp = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, ...tz });

function toneOf(c: FieldCheck): Mark["tone"] {
  return c.status === "ok" || c.status === "edited" ? "yellow" : "pink";
}

/** Splits the text at every mark boundary so overlapping marks render as nested highlights. */
function segments(text: string, marks: Mark[]) {
  const cuts = new Set([0, text.length]);
  for (const m of marks) {
    cuts.add(m.start);
    cuts.add(m.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const out: { text: string; marks: Mark[] }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    out.push({ text: text.slice(a, b), marks: marks.filter((m) => m.start <= a && m.end >= b) });
  }
  return out;
}

export function Workbench({ data }: { data: WorkbenchData }) {
  const [active, setActive] = useState<string | null>(null);
  const { doc, proposal, assessment } = data;
  const benchRef = useRef<HTMLDivElement>(null);

  // On a phone the document sits below the inbox, so opening one should bring it into view.
  useEffect(() => {
    if (window.matchMedia("(max-width: 1000px)").matches && new URLSearchParams(window.location.search).has("doc")) {
      benchRef.current?.scrollIntoView({ block: "start" });
    }
  }, []);

  const marks = useMemo(() => {
    const list: Mark[] = [];
    for (const c of assessment?.checks ?? []) {
      if (c.span) list.push({ key: c.key, start: c.span[0], end: c.span[1], tone: toneOf(c) });
    }
    if (proposal?.clinicalQuote) {
      const span = locate(doc.body, proposal.clinicalQuote);
      if (span) list.push({ key: CLINICAL, start: span[0], end: span[1], tone: "orange" });
    }
    return list;
  }, [assessment, proposal, doc.body]);

  const focus = (key: string | null) => {
    setActive(key);
    if (!key) return;
    document.querySelector(`[data-mark~="${key}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  return (
    <div className={s.bench} ref={benchRef}>
      <section className={s.paperCol} aria-label="Document">
        <Paper doc={doc} marks={marks} active={active} onHover={setActive} />
        {marks.length > 0 && (
          <p className={s.legend}>
            <span className="hl">Yellow</span> the assistant read it here and the checks passed ·{" "}
            <span className="hl hl-pink">pink</span> a check failed ·{" "}
            <span className="hl hl-orange">orange</span> clinical content
          </p>
        )}
      </section>
      <Reading data={data} active={active} onFocus={focus} />
    </div>
  );
}

function Paper({ doc, marks, active, onHover }: { doc: WorkbenchData["doc"]; marks: Mark[]; active: string | null; onHover: (k: string | null) => void }) {
  const segs = useMemo(() => segments(doc.body, marks), [doc.body, marks]);
  const header =
    doc.channel === "fax"
      ? `${stamp(doc.receivedAt)}  FROM: ${doc.sender.toUpperCase()}  P. 1/${doc.pages}`
      : doc.channel === "portal"
        ? `PATIENT PORTAL · RECEIVED ${stamp(doc.receivedAt)}`
        : `INBOUND EMAIL · RECEIVED ${stamp(doc.receivedAt)}`;

  return (
    <article className={s.paper} data-channel={doc.channel}>
      <div className={s.faxHead}>{header}</div>
      <pre className={s.print}>
        {segs.map((seg, i) => {
          if (seg.marks.length === 0) return <span key={i}>{seg.text}</span>;
          // Clinical text wins the color; otherwise a failed check shows over a passed one.
          const tone = seg.marks.some((m) => m.tone === "orange") ? "orange" : seg.marks.some((m) => m.tone === "pink") ? "pink" : "yellow";
          const keys = seg.marks.map((m) => m.key);
          const lit = active !== null && keys.includes(active);
          return (
            <mark
              key={i}
              data-mark={keys.join(" ")}
              className={`hl ${tone === "pink" ? "hl-pink" : tone === "orange" ? "hl-orange" : ""} ${s.mark} ${lit ? s.lit : ""} ${active && !lit ? s.dim : ""}`}
              onMouseEnter={() => onHover(keys[keys.length - 1])}
              onMouseLeave={() => onHover(null)}
            >
              {seg.text}
            </mark>
          );
        })}
      </pre>
    </article>
  );
}

const STATUS_COPY: Record<Routing["status"], { title: string; tone: string }> = {
  ready: { title: "Ready to route", tone: "hl-green" },
  attention: { title: "Needs a look before routing", tone: "hl-pink" },
  escalated: { title: "Escalated for clinical content", tone: "hl-orange" },
};

function Reading({ data, active, onFocus }: { data: WorkbenchData; active: string | null; onFocus: (k: string | null) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [elsewhere, setElsewhere] = useState<Queue | "">("");
  const { doc, proposal, assessment, routed, perms } = data;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      setMessage(null);
      const r = await fn();
      setMessage(r.ok ? { tone: "ok", text: done } : { tone: "error", text: r.error });
      router.refresh();
    });

  if (!proposal || !assessment) {
    return (
      <aside className={s.reading}>
        <p className={s.eyebrow}>Assistant&apos;s reading</p>
        <h2 className={s.docType}>Not read yet</h2>
        <p className={s.summary}>The assistant has not produced a proposal for this document.</p>
        {perms.run && (
          <button className={s.primary} disabled={pending} onClick={() => run(() => rerunAssistant(doc.id), "Proposal ready.")}>
            {pending ? "Reading…" : "Run the assistant"}
          </button>
        )}
        {message && <p className={message.tone === "error" ? s.error : s.ok} role="status">{message.text}</p>}
      </aside>
    );
  }

  const { routing, checks } = assessment;
  const status = STATUS_COPY[routing.status];
  const failed = checks.filter((c) => c.problem);
  const clinical = routing.status === "escalated";
  const allowed = clinical ? perms.routeClinical : perms.route;
  const blockedWhy = clinical
    ? "Switch to Triage nurse to take documents with clinical content."
    : "Switch to Intake coordinator to route administrative documents.";

  return (
    <aside className={s.reading} aria-label="Assistant's reading and routing">
      <p className={s.eyebrow}>Assistant&apos;s reading</p>
      <h2 className={s.docType}>{assessment.docTypeLabel}</h2>
      <p className={s.summary}>{proposal.summary}</p>

      {routed ? (
        <div className={s.receipt}>
          <p className={s.receiptMain}>
            Routed to <strong>{routed.queue}</strong>
          </p>
          <p className={s.receiptMeta}>
            {routed.by} · {clock(routed.at)} · task #{routed.taskId}
            {routed.suggested && routed.suggested !== routed.queue && <> · assistant suggested {routed.suggested}</>}
          </p>
          {routed.tags.length > 0 && <p className={s.receiptMeta}>Carried as tags: {routed.tags.join(" · ")}</p>}
        </div>
      ) : (
        <div className={s.route} data-status={routing.status}>
          <p className={s.status}>
            <span className={`hl ${status.tone}`}>{status.title}</span>
            {failed.length > 0 && <span className={s.failCount}> · {failed.length === 1 ? "1 check failed" : `${failed.length} checks failed`}</span>}
          </p>
          <p className={s.queue}>
            <span className={s.arrow} aria-hidden>→</span> {routing.queue}
          </p>
          <ul className={s.reasons}>
            {routing.reasons.map((r, i) => (
              <li key={i}>
                {r.text} <a href={`/ask#${r.sop.replace(/\s§/, "-")}`} className={s.sop}>{r.sop}</a>
              </li>
            ))}
          </ul>
          {routing.tags.length > 0 && (
            <ul className={s.tags}>
              {routing.tags.map((t, i) => (
                <li key={i} data-tone={t.tone}>
                  {t.label} <a href={`/ask#${t.sop.replace(/\s§/, "-")}`} className={s.sop}>{t.sop}</a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h3 className={s.h3}>Index fields</h3>
      {checks.length === 0 ? (
        <p className={s.none}>Nothing to index until the document is identified.</p>
      ) : (
        <ul className={s.fields}>
          {checks.map((c) => (
            <FieldRow
              key={c.key}
              check={c}
              active={active === c.key}
              editable={perms.edit && !doc.closed}
              onFocus={onFocus}
              onSave={(value) => run(() => editField(doc.id, proposal.id, c.key as FieldKey, value), `${c.label} corrected.`)}
              pending={pending}
            />
          ))}
        </ul>
      )}
      {proposal.clinicalQuote && (
        <p
          className={s.clinicalNote}
          onMouseEnter={() => onFocus(CLINICAL)}
          onMouseLeave={() => onFocus(null)}
        >
          <span className="hl hl-orange">Clinical content found</span> The assistant does not interpret it. It goes to a nurse the same day.
        </p>
      )}

      {!doc.closed && (
        <div className={s.actions}>
          {allowed ? (
            <>
              <button className={s.primary} disabled={pending} onClick={() => run(() => routeDocument(doc.id, proposal.id, null), `Routed to ${routing.queue}.`)}>
                Route to {routing.queue}
              </button>
              {!clinical && (
                <div className={s.elsewhere}>
                  <label className="sr-only" htmlFor="elsewhere">Route to a different queue</label>
                  <select id="elsewhere" value={elsewhere} onChange={(e) => setElsewhere(e.target.value as Queue)}>
                    <option value="">Route elsewhere…</option>
                    {QUEUES.filter((q) => q !== routing.queue && q !== "Nurse Triage").map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))}
                  </select>
                  {elsewhere && (
                    <button className={s.secondary} disabled={pending} onClick={() => run(() => routeDocument(doc.id, proposal.id, elsewhere), `Routed to ${elsewhere}.`)}>
                      Route to {elsewhere}
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className={s.blocked}>
              Working as {data.roleLabel}. {blockedWhy}
            </p>
          )}
          {perms.run && (
            <button className={s.link} disabled={pending} onClick={() => run(() => rerunAssistant(doc.id), "The assistant read the document again.")}>
              Ask the assistant to read it again
            </button>
          )}
        </div>
      )}
      <p className={message?.tone === "error" ? s.error : s.ok} role="status" aria-live="polite">
        {pending ? "Working…" : message?.text}
      </p>

      <details className={s.provenance}>
        <summary>How this proposal was made</summary>
        <dl>
          <dt>Model</dt>
          <dd>{proposal.model}, prompt {proposal.promptVersion}</dd>
          <dt>Tokens</dt>
          <dd>{proposal.inputTokens.toLocaleString()} in · {proposal.outputTokens.toLocaleString()} out</dd>
          <dt>Cost</dt>
          <dd>${proposal.costUsd.toFixed(4)} · {(proposal.latencyMs / 1000).toFixed(1)} s</dd>
          <dt>Decided by</dt>
          <dd>Routing rules in code, from the SOPs. The model only reads and extracts.</dd>
        </dl>
        <ol className={s.timeline}>
          {data.audit.map((e) => (
            <li key={e.id}>
              <time>{clock(e.at)}</time> <span className={e.actor === "assistant" || e.actor === "system" ? undefined : "pen"}>{e.actor}</span>{" "}
              {describe(e.event, e.detail)}
            </li>
          ))}
        </ol>
      </details>
    </aside>
  );
}

function FieldRow({
  check: c,
  active,
  editable,
  onFocus,
  onSave,
  pending,
}: {
  check: FieldCheck;
  active: boolean;
  editable: boolean;
  onFocus: (k: string | null) => void;
  onSave: (value: string) => void;
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.value ?? "");
  const isDate = /date|dob|valid_|effective/.test(c.key);

  return (
    <li
      className={`${s.field} ${active ? s.fieldActive : ""}`}
      data-status={c.status}
      onMouseEnter={() => c.span && onFocus(c.key)}
      onMouseLeave={() => onFocus(null)}
    >
      <span className={s.fieldLabel}>
        {c.label}
        {!c.required && <span className={s.optional}> optional</span>}
      </span>
      {editing ? (
        <form
          className={s.editForm}
          onSubmit={(e) => {
            e.preventDefault();
            onSave(draft);
            setEditing(false);
          }}
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={isDate ? "YYYY-MM-DD" : ""}
            aria-label={`Correct ${c.label}`}
          />
          <button type="submit" disabled={pending}>Save</button>
          <button type="button" onClick={() => { setEditing(false); setDraft(c.value ?? ""); }}>Cancel</button>
        </form>
      ) : (
        <span className={s.fieldValue}>
          {c.value ? (
            <span className={c.status === "edited" ? `pen ${s.valueText}` : s.valueText}>{c.value}</span>
          ) : (
            <span className={s.missing}>not in document</span>
          )}
          {editable && (
            <button type="button" className={s.edit} onClick={() => setEditing(true)} aria-label={`Correct ${c.label}`}>
              Correct
            </button>
          )}
        </span>
      )}
      {c.status === "edited" && <span className={s.note}>Typed by a person, format checked</span>}
      {c.problem && <span className={s.problem}>{c.problem}</span>}
    </li>
  );
}

function describe(event: string, d: Record<string, unknown>): string {
  switch (event) {
    case "document.received":
      return `received the document by ${d.channel}`;
    case "ai.proposed":
      return `proposed ${String(d.suggested_queue)} (${String(d.status)}), $${Number(d.cost_usd).toFixed(4)}`;
    case "ai.failed":
      return `could not read it: ${String(d.reason)}`;
    case "field.corrected":
      return `corrected ${String(d.field).replace(/_/g, " ")}`;
    case "document.routed":
      return `routed it to ${String(d.queue)}${d.overridden ? `, overriding ${String(d.suggested_queue)}` : ""}`;
    default:
      return event;
  }
}
