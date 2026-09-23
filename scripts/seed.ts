// Loads the SOPs and the synthetic documents, then runs the assistant on any seed
// document that has no proposal yet (real model calls, a few cents in total).
import { DOCUMENTS } from "@/data/documents";
import { SOPS } from "@/data/sops";
import { planNextSteps } from "@/lib/agent";
import { resetCrm } from "@/lib/crm";
import { q } from "@/lib/db";
import { audit, documentView } from "@/lib/desk";
import { runAssistant } from "@/lib/ingest";

async function main() {
  const [{ n }] = await q<{ n: number }>(`select count(*)::int n from intake.sop_sections`);
  if (n === 0) {
    for (const sop of SOPS)
      for (const s of sop.sections)
        await q(
          `insert into intake.sop_sections (sop_id, sop_title, owner, n, heading, body) values ($1, $2, $3, $4, $5, $6)`,
          [sop.id, sop.title, sop.owner, s.n, s.heading, s.body],
        );
    console.log("SOP sections loaded");
  }

  for (const d of DOCUMENTS) {
    const inserted = await q<{ id: number }>(
      `insert into intake.documents (slug, channel, sender, received_at, pages, body, is_seed)
       values ($1, $2, $3, $4, $5, $6, true) on conflict (slug) do nothing returning id`,
      [d.slug, d.channel, d.sender, d.receivedAt, d.pages, d.text],
    );
    if (inserted[0]) await audit("system", "document.received", inserted[0].id, { channel: d.channel, pages: d.pages });
  }

  const pending = await q<{ id: number; slug: string }>(
    `select d.id, d.slug from intake.documents d
     where d.is_seed and not exists (select 1 from intake.proposals p where p.document_id = d.id) order by d.received_at`,
  );
  for (const d of pending) {
    const r = await runAssistant(d.id, "assistant");
    console.log(d.slug, r.ok ? "proposed" : r.error);
  }

  const [{ n: patients }] = await q<{ n: number }>(`select count(*)::int n from intake.crm_patients`);
  if (patients === 0) {
    await resetCrm();
    console.log("CRM patients loaded");
  }

  // Plan next steps for every seed document the agent may act on, so visitors see a plan without waiting.
  const unplanned = await q<{ id: number; slug: string }>(
    `select d.id, d.slug from intake.documents d
     where d.is_seed and not exists (select 1 from intake.agent_runs r where r.document_id = d.id) order by d.received_at`,
  );
  for (const d of unplanned) {
    const v = await documentView(d.id);
    if (!v?.assessment || v.assessment.routing.status === "escalated" || v.assessment.docType === "unclassifiable") continue;
    const r = await planNextSteps(v.doc, v.assessment, "assistant");
    console.log(d.slug, r.ok ? "planned" : r.error);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
