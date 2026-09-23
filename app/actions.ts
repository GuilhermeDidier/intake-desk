"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { QUEUES, type Queue } from "@/data/sops";
import { q, tx } from "@/lib/db";
import { audit, documentView } from "@/lib/desk";
import { FIELD_SPEC, DOC_TYPE_LABEL, type FieldKey } from "@/lib/fields";
import { runAssistant } from "@/lib/ingest";
import { ask, type Answer } from "@/lib/knowledge";
import { spendModelCall } from "@/lib/limits";
import { ROLES, can, currentRole, type Role } from "@/lib/roles";

export type ActionResult = { ok: true } | { ok: false; error: string };

const actorLabel = (r: Role) => ROLES[r].label;

export async function setRole(role: Role) {
  if (!(role in ROLES)) return;
  (await cookies()).set("role", role, { path: "/", maxAge: 60 * 60 * 24 * 30, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function routeDocument(documentId: number, proposalId: number, queueOverride: Queue | null): Promise<ActionResult> {
  const role = await currentRole();
  const view = await documentView(documentId);
  if (!view?.proposal || !view.assessment) return { ok: false, error: "This document has no proposal to act on." };
  if (view.proposal.id !== proposalId) return { ok: false, error: "The assistant re-read this document. Review the new proposal first." };
  if (view.doc.state === "closed") return { ok: false, error: "This document was already routed." };

  const { routing, docType, checks } = view.assessment;
  // The server recomputes the verdict; nothing the browser sends can skip a rule.
  if (routing.status === "escalated" && !can.routeClinical(role)) {
    return { ok: false, error: "Documents with clinical content are taken by a triage nurse." };
  }
  if (routing.status !== "escalated" && !can.route(role)) {
    return { ok: false, error: "Only intake coordinators route administrative documents." };
  }
  if (queueOverride && !QUEUES.includes(queueOverride)) return { ok: false, error: "Unknown queue." };
  if (routing.status === "escalated" && queueOverride && queueOverride !== "Nurse Triage") {
    return { ok: false, error: "Clinical content stays with Nurse Triage (SOP-106 §1)." };
  }

  const queue = queueOverride ?? routing.queue;
  const patient = checks.find((c) => c.key === "patient_name")?.value;
  // Minimum necessary (SOP-100 §4): a task title names the document type and patient, nothing clinical.
  const title = `${DOC_TYPE_LABEL[docType]}${patient ? ` · ${patient}` : ""}`;
  const tags = routing.tags.map((t) => t.label);

  await tx(async (query) => {
    const [task] = await query<{ id: number }>(
      `insert into intake.queue_tasks (document_id, queue, title, tags, created_by) values ($1, $2, $3, $4, $5) returning id`,
      [documentId, queue, title, tags, actorLabel(role)],
    );
    await query(`update intake.documents set state = 'closed' where id = $1`, [documentId]);
    await query(`insert into intake.audit_log (actor, event, document_id, detail) values ($1, $2, $3, $4)`, [
      actorLabel(role),
      "document.routed",
      documentId,
      JSON.stringify({
        proposal_id: proposalId,
        queue,
        suggested_queue: routing.queue,
        overridden: queue !== routing.queue,
        status_at_approval: routing.status,
        edited_fields: [...view.edits.keys()],
        task_id: task.id,
      }),
    ]);
  });
  revalidatePath("/");
  return { ok: true };
}

export async function editField(documentId: number, proposalId: number, key: FieldKey, raw: string): Promise<ActionResult> {
  const role = await currentRole();
  if (!can.editFields(role)) return { ok: false, error: "Only intake coordinators correct index fields." };
  if (!(key in FIELD_SPEC)) return { ok: false, error: "Unknown field." };
  const [doc] = await q<{ state: string }>(`select state from intake.documents where id = $1`, [documentId]);
  if (!doc || doc.state === "closed") return { ok: false, error: "This document was already routed." };
  const value = raw.trim().slice(0, 200) || null;
  await q(`insert into intake.field_edits (document_id, proposal_id, field_key, value, actor) values ($1, $2, $3, $4, $5)`, [
    documentId,
    proposalId,
    key,
    value,
    actorLabel(role),
  ]);
  // The audit trail records which field changed and who changed it, not the value.
  await audit(actorLabel(role), "field.corrected", documentId, { proposal_id: proposalId, field: key, cleared: value === null });
  revalidatePath("/");
  return { ok: true };
}

export async function rerunAssistant(documentId: number): Promise<ActionResult> {
  const role = await currentRole();
  if (!can.runModel(role)) return { ok: false, error: "Only intake coordinators run the assistant." };
  const [doc] = await q<{ state: string }>(`select state from intake.documents where id = $1`, [documentId]);
  if (!doc || doc.state === "closed") return { ok: false, error: "This document was already routed." };
  const limited = await spendModelCall();
  if (limited) return { ok: false, error: limited };
  const r = await runAssistant(documentId, "assistant");
  revalidatePath("/");
  return r.ok ? { ok: true } : r;
}

export async function submitDocument(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const role = await currentRole();
  if (!can.runModel(role)) return { ok: false, error: "Switch to intake coordinator to send documents to the assistant." };
  const body = String(form.get("body") ?? "").trim();
  const sender = String(form.get("sender") ?? "").trim().slice(0, 80) || "Pasted document";
  const channel = String(form.get("channel") ?? "fax");
  if (body.length < 40) return { ok: false, error: "Paste the full document text (at least a few lines)." };
  if (body.length > 6000) return { ok: false, error: "Keep documents under 6,000 characters in this demo." };
  if (!["fax", "portal", "email"].includes(channel)) return { ok: false, error: "Unknown channel." };
  const limited = await spendModelCall();
  if (limited) return { ok: false, error: limited };

  const [doc] = await q<{ id: number }>(
    `insert into intake.documents (channel, sender, received_at, body) values ($1, $2, now(), $3) returning id`,
    [channel, sender, body],
  );
  await audit(actorLabel(role), "document.received", doc.id, { channel, pages: 1, via: "pasted" });
  const r = await runAssistant(doc.id, "assistant");
  revalidatePath("/");
  if (!r.ok) return r;
  redirect(`/?doc=${doc.id}`);
}

export async function askSops(question: string): Promise<{ ok: true; answer: Answer } | { ok: false; error: string }> {
  const text = question.trim().slice(0, 400);
  if (text.length < 8) return { ok: false, error: "Ask a full question." };
  const limited = await spendModelCall();
  if (limited) return { ok: false, error: limited };
  const role = await currentRole();
  try {
    const answer = await ask(text);
    // Questions can contain patient details, so the log keeps what was used, not what was asked.
    await audit(actorLabel(role), "knowledge.asked", null, {
      covered: answer.covered,
      sections: answer.sources.map((s) => `${s.sop_id} §${s.n} v${s.version}`),
      cost_usd: Number(answer.costUsd.toFixed(5)),
    });
    return { ok: true, answer };
  } catch (e) {
    console.error(e);
    return { ok: false, error: "The assistant could not be reached. Try again in a moment." };
  }
}

export async function editSection(sectionId: number, body: string): Promise<ActionResult> {
  const role = await currentRole();
  if (!can.editKnowledge(role)) return { ok: false, error: "Only operations admins edit SOPs." };
  const text = body.trim();
  if (text.length < 20 || text.length > 2000) return { ok: false, error: "A section needs between 20 and 2,000 characters." };
  const result = await tx(async (query) => {
    const [old] = await query<{ id: number; sop_id: string; sop_title: string; owner: string; n: number; heading: string; version: number; body: string }>(
      `select * from intake.sop_sections where id = $1 and is_current for update`,
      [sectionId],
    );
    if (!old) return null;
    if (old.body === text) return old;
    await query(`update intake.sop_sections set is_current = false where id = $1`, [old.id]);
    const [row] = await query<{ id: number; version: number }>(
      `insert into intake.sop_sections (sop_id, sop_title, owner, n, heading, body, version, edited_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning id, version`,
      [old.sop_id, old.sop_title, old.owner, old.n, old.heading, text, old.version + 1, actorLabel(role)],
    );
    await query(`insert into intake.audit_log (actor, event, detail) values ($1, 'knowledge.edited', $2)`, [
      actorLabel(role),
      JSON.stringify({ section: `${old.sop_id} §${old.n}`, from_version: old.version, to_version: row.version }),
    ]);
    return old;
  });
  if (!result) return { ok: false, error: "Someone else edited this section. Reload to see the current version." };
  revalidatePath("/ask");
  return { ok: true };
}

export async function resetDemo(): Promise<ActionResult> {
  const role = await currentRole();
  await tx(async (query) => {
    await query(`delete from intake.documents where not is_seed`);
    await query(`delete from intake.queue_tasks`);
    await query(`delete from intake.field_edits`);
    // Keep each seed document's first proposal; later re-runs go.
    await query(
      `delete from intake.proposals p where p.id <> (select min(id) from intake.proposals x where x.document_id = p.document_id)`,
    );
    await query(`update intake.documents set state = 'proposed'`);
    await query(`delete from intake.sop_sections where edited_by <> 'seed'`);
    await query(`update intake.sop_sections set is_current = true`);
    await query(`insert into intake.audit_log (actor, event, detail) values ($1, 'demo.reset', '{}')`, [actorLabel(role)]);
  });
  revalidatePath("/", "layout");
  return { ok: true };
}
