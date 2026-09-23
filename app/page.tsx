import Link from "next/link";
import { notFound } from "next/navigation";
import { InboxList } from "@/components/InboxList";
import { Workbench, type WorkbenchData } from "@/components/Workbench";
import { documentView, inbox } from "@/lib/desk";
import { DOC_TYPE_LABEL } from "@/lib/fields";
import { ROLES, can, currentRole } from "@/lib/roles";
import s from "./page.module.css";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ doc?: string }> }) {
  const { doc } = await searchParams;
  const [items, role] = await Promise.all([inbox(), currentRole()]);
  const order = { escalated: 0, attention: 1, ready: 2, new: 3 } as const;
  const sorted = [...items].sort((a, b) => {
    const ra = a.doc.state === "closed" ? 9 : order[a.status];
    const rb = b.doc.state === "closed" ? 9 : order[b.status];
    return ra - rb || +new Date(b.doc.received_at) - +new Date(a.doc.received_at);
  });

  const selectedId = doc ? Number(doc) : sorted[0]?.doc.id;
  const view = selectedId ? await documentView(selectedId) : null;
  if (doc && !view) notFound();

  let data: WorkbenchData | null = null;
  if (view) {
    const routed = [...view.audit].reverse().find((e) => e.event === "document.routed");
    data = {
      doc: {
        id: view.doc.id,
        channel: view.doc.channel,
        sender: view.doc.sender,
        receivedAt: new Date(view.doc.received_at).toISOString(),
        pages: view.doc.pages,
        body: view.doc.body,
        closed: view.doc.state === "closed",
      },
      proposal: view.proposal && {
        id: view.proposal.id,
        model: view.proposal.model,
        promptVersion: view.proposal.prompt_version,
        summary: view.proposal.extraction.summary,
        clinicalQuote: view.proposal.extraction.clinical.present ? view.proposal.extraction.clinical.quote : null,
        inputTokens: view.proposal.input_tokens,
        outputTokens: view.proposal.output_tokens,
        costUsd: Number(view.proposal.cost_usd),
        latencyMs: view.proposal.latency_ms,
        createdAt: new Date(view.proposal.created_at).toISOString(),
      },
      assessment: view.assessment && {
        docType: view.assessment.docType,
        docTypeLabel: DOC_TYPE_LABEL[view.assessment.docType],
        checks: view.assessment.checks,
        routing: view.assessment.routing,
      },
      routed: view.task && {
        queue: view.task.queue,
        taskId: view.task.id,
        by: view.task.created_by,
        at: new Date(view.task.created_at).toISOString(),
        tags: view.task.tags,
        suggested: (routed?.detail.suggested_queue as string | undefined) ?? null,
      },
      audit: view.audit.map((e) => ({ id: e.id, at: new Date(e.at).toISOString(), actor: e.actor, event: e.event, detail: e.detail })),
      perms: {
        route: can.route(role),
        routeClinical: can.routeClinical(role),
        edit: can.editFields(role),
        run: can.runModel(role),
      },
      roleLabel: ROLES[role].label,
    };
  }

  return (
    <main className={s.desk}>
      <aside className={s.rail}>
        <div className={s.railHead}>
          <h1>Inbox</h1>
          <Link href="/new" className={s.newDoc}>
            Paste a document
          </Link>
        </div>
        <InboxList
          items={sorted.map((i) => ({
            id: i.doc.id,
            sender: i.doc.sender,
            channel: i.doc.channel,
            receivedAt: new Date(i.doc.received_at).toISOString(),
            label: i.label,
            patient: i.patient,
            status: i.doc.state === "closed" ? "routed" : i.status,
            queue: i.task?.queue ?? i.queue,
          }))}
          selectedId={selectedId ?? null}
        />
      </aside>
      {data ? (
        <Workbench key={`${data.doc.id}:${data.proposal?.id ?? 0}`} data={data} />
      ) : (
        <section className={s.empty}>
          <p>The inbox is empty.</p>
          <Link href="/new">Paste a document to see the assistant work.</Link>
        </section>
      )}
    </main>
  );
}
