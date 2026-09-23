import type { Queue } from "@/data/sops";
import { checkFields, type ExtractedField, type FieldCheck } from "./checks";
import { q } from "./db";
import type { Extraction } from "./extract";
import { DOC_TYPE_LABEL, type DocType, type FieldKey } from "./fields";
import { route, type Routing } from "./routing";

export type DocRow = {
  id: number;
  slug: string | null;
  channel: "fax" | "portal" | "email";
  sender: string;
  received_at: Date;
  pages: number;
  body: string;
  is_seed: boolean;
  state: "new" | "proposed" | "closed";
};

export type ProposalRow = {
  id: number;
  model: string;
  prompt_version: string;
  extraction: Extraction;
  input_tokens: number;
  output_tokens: number;
  cost_usd: string;
  latency_ms: number;
  created_at: Date;
};

export type TaskRow = { id: number; queue: Queue; title: string; tags: string[]; created_by: string; created_at: Date };

export type Assessment = { docType: DocType; checks: FieldCheck[]; routing: Routing };

export type AuditRow = { id: number; at: Date; actor: string; event: string; document_id: number | null; detail: Record<string, unknown> };

/** Recomputed on every read: the stored record is what the model said, the verdict is ours. */
export function assess(doc: DocRow, proposal: ProposalRow, edits: Map<FieldKey, string | null>): Assessment {
  const x = proposal.extraction;
  const docType = x.doc_type as DocType;
  const fields: ExtractedField[] = x.fields.map((f) => ({ key: f.key as FieldKey, value: f.value, quote: f.quote }));
  for (const [key, value] of edits) {
    const i = fields.findIndex((f) => f.key === key);
    if (i >= 0) fields[i] = { ...fields[i], value };
    else fields.push({ key, value, quote: null });
  }
  const receivedAt = new Date(doc.received_at);
  const checks = checkFields(docType, fields, doc.body, receivedAt, new Set(edits.keys()));
  const routing = route({ docType, urgency: x.urgency, clinical: x.clinical, checks, receivedAt });
  return { docType, checks, routing };
}

export type InboxItem = {
  doc: DocRow;
  docType: DocType | null;
  label: string;
  patient: string | null;
  status: Routing["status"] | "new";
  queue: Queue | null;
  task: TaskRow | null;
};

export async function inbox(): Promise<InboxItem[]> {
  const docs = await q<DocRow>(`select * from intake.documents order by received_at desc, id desc`);
  if (docs.length === 0) return [];
  const ids = docs.map((d) => d.id);
  const proposals = await q<ProposalRow & { document_id: number }>(
    `select distinct on (document_id) * from intake.proposals where document_id = any($1) order by document_id, created_at desc`,
    [ids],
  );
  const edits = await q<{ document_id: number; proposal_id: number; field_key: FieldKey; value: string | null }>(
    `select distinct on (proposal_id, field_key) document_id, proposal_id, field_key, value
     from intake.field_edits where document_id = any($1) order by proposal_id, field_key, created_at desc`,
    [ids],
  );
  const tasks = await q<TaskRow & { document_id: number }>(
    `select distinct on (document_id) * from intake.queue_tasks where document_id = any($1) order by document_id, created_at desc`,
    [ids],
  );

  return docs.map((doc) => {
    const p = proposals.find((x) => x.document_id === doc.id);
    const task = tasks.find((t) => t.document_id === doc.id) ?? null;
    if (!p) return { doc, docType: null, label: "Waiting for the assistant", patient: null, status: "new", queue: null, task };
    const e = new Map(edits.filter((x) => x.proposal_id === p.id).map((x) => [x.field_key, x.value]));
    const a = assess(doc, p, e);
    return {
      doc,
      docType: a.docType,
      label: DOC_TYPE_LABEL[a.docType],
      patient: a.checks.find((c) => c.key === "patient_name")?.value ?? null,
      status: a.routing.status,
      queue: a.routing.queue,
      task,
    };
  });
}

export type DocumentView = {
  doc: DocRow;
  proposal: ProposalRow | null;
  edits: Map<FieldKey, string | null>;
  assessment: Assessment | null;
  task: TaskRow | null;
  audit: AuditRow[];
};

export async function documentView(id: number): Promise<DocumentView | null> {
  const [doc] = await q<DocRow>(`select * from intake.documents where id = $1`, [id]);
  if (!doc) return null;
  const [proposal] = await q<ProposalRow>(
    `select * from intake.proposals where document_id = $1 order by created_at desc limit 1`,
    [id],
  );
  const editRows = proposal
    ? await q<{ field_key: FieldKey; value: string | null }>(
        `select distinct on (field_key) field_key, value from intake.field_edits
         where proposal_id = $1 order by field_key, created_at desc`,
        [proposal.id],
      )
    : [];
  const edits = new Map(editRows.map((r) => [r.field_key, r.value]));
  const [task] = await q<TaskRow>(
    `select * from intake.queue_tasks where document_id = $1 order by created_at desc limit 1`,
    [id],
  );
  const audit = await q<AuditRow>(`select * from intake.audit_log where document_id = $1 order by at, id`, [id]);
  return {
    doc,
    proposal: proposal ?? null,
    edits,
    assessment: proposal ? assess(doc, proposal, edits) : null,
    task: task ?? null,
    audit,
  };
}

export async function audit(actor: string, event: string, documentId: number | null, detail: Record<string, unknown> = {}) {
  await q(`insert into intake.audit_log (actor, event, document_id, detail) values ($1, $2, $3, $4)`, [
    actor,
    event,
    documentId,
    JSON.stringify(detail),
  ]);
}
