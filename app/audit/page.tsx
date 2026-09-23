import Link from "next/link";
import { q } from "@/lib/db";
import type { AuditRow } from "@/lib/desk";
import s from "./audit.module.css";

export const metadata = { title: "Audit trail · Intake Desk" };

const FILTERS = [
  { key: "", label: "Everything" },
  { key: "ai.", label: "Assistant" },
  { key: "field.", label: "Corrections" },
  { key: "document.routed", label: "Routings" },
  { key: "knowledge.", label: "Knowledge" },
];

const MACHINE = new Set(["assistant", "system"]);

function describe(e: AuditRow): string {
  const d = e.detail as Record<string, string | number | boolean | string[] | undefined>;
  switch (e.event) {
    case "document.received":
      return `Document received by ${d.channel}${d.via === "pasted" ? " (pasted in the demo)" : ""}`;
    case "ai.proposed":
      return `Proposed ${String(d.doc_type).replace(/_/g, " ")} → ${d.suggested_queue}, ${d.status}${
        Array.isArray(d.failed_checks) && d.failed_checks.length ? `; failed: ${d.failed_checks.join(", ").replace(/_/g, " ")}` : ""
      }`;
    case "ai.failed":
      return `Could not read the document: ${d.reason}`;
    case "field.corrected":
      return `Corrected ${String(d.field).replace(/_/g, " ")}${d.cleared ? " (cleared)" : ""}`;
    case "document.routed":
      return `Routed to ${d.queue}${d.overridden ? `, overriding the suggested ${d.suggested_queue}` : ""} · task #${d.task_id}`;
    case "knowledge.asked":
      return `Asked the SOPs · ${d.covered ? "answered" : "not covered"}${Array.isArray(d.sections) && d.sections.length ? ` · searched ${d.sections.join(", ")}` : ""}`;
    case "knowledge.edited":
      return `Edited ${d.section}: v${d.from_version} → v${d.to_version}`;
    case "demo.reset":
      return "Reset the demo";
    default:
      return e.event;
  }
}

const time = (d: Date) =>
  new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ only?: string }> }) {
  const { only = "" } = await searchParams;
  const filter = FILTERS.some((f) => f.key === only) ? only : "";
  const [events, [m]] = await Promise.all([
    q<AuditRow & { sender: string | null }>(
      `select a.*, d.sender from intake.audit_log a left join intake.documents d on d.id = a.document_id
       where ($1 = '' or a.event like $1 || '%') order by a.at desc, a.id desc limit 300`,
      [filter],
    ),
    q<{ read: number; ready: number; corrected: number; routed: number; overridden: number; spend: string; per_doc: string; latency: number }>(
      `select
         (select count(distinct document_id)::int from intake.proposals) as read,
         (select count(*)::int from intake.audit_log a where a.event = 'ai.proposed' and a.detail->>'status' = 'ready'
            and a.id = (select min(id) from intake.audit_log b where b.document_id = a.document_id and b.event = 'ai.proposed')) as ready,
         (select count(*)::int from intake.audit_log where event = 'field.corrected') as corrected,
         (select count(*)::int from intake.audit_log where event = 'document.routed') as routed,
         (select count(*)::int from intake.audit_log where event = 'document.routed' and (detail->>'overridden')::boolean) as overridden,
         (select coalesce(sum(cost_usd), 0)::text from intake.proposals) as spend,
         (select coalesce(avg(cost_usd), 0)::text from intake.proposals) as per_doc,
         (select coalesce(avg(latency_ms), 0)::int from intake.proposals) as latency`,
    ),
  ]);

  return (
    <main className={s.wrap}>
      <header className={s.head}>
        <h1>Audit trail</h1>
        <p>
          Append-only: the database refuses to change or delete an entry. Entries name the fields that changed, never their values,
          so the log does not become a second copy of patient data.
        </p>
      </header>

      <dl className={s.ledger}>
        <div><dt>Documents read</dt><dd>{m.read}</dd></div>
        <div><dt>Clean on first read</dt><dd>{m.ready}<small>of {m.read}</small></dd></div>
        <div><dt>Corrected by people</dt><dd className="pen">{m.corrected}</dd></div>
        <div><dt>Routed</dt><dd className="pen">{m.routed}<small>{m.overridden ? `${m.overridden} against the suggestion` : "all as suggested"}</small></dd></div>
        <div><dt>Cost per read</dt><dd>${Number(m.per_doc).toFixed(3)}<small>${Number(m.spend).toFixed(2)} in total</small></dd></div>
        <div><dt>Average read time</dt><dd>{(m.latency / 1000).toFixed(1)} s<small>per document</small></dd></div>
      </dl>

      <nav className={s.filters} aria-label="Filter events">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key ? `/audit?only=${f.key}` : "/audit"} className={f.key === filter ? s.on : undefined}>
            {f.label}
          </Link>
        ))}
      </nav>

      <ol className={s.log}>
        {events.map((e) => (
          <li key={e.id}>
            <time>{time(e.at)}</time>
            <span className={MACHINE.has(e.actor) ? s.machine : `${s.person} pen`}>{e.actor}</span>
            <span className={s.what}>
              {describe(e)}
              {e.document_id && e.sender && (
                <Link href={`/?doc=${e.document_id}`} className={s.doc}>
                  {e.sender}
                </Link>
              )}
            </span>
          </li>
        ))}
        {events.length === 0 && <li className={s.empty}>No events of this kind yet.</li>}
      </ol>
    </main>
  );
}
