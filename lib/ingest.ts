import { q } from "./db";
import { assess, audit, DOC_COLS, type DocRow, type ProposalRow } from "./desk";
import { extract, ExtractionError, PROMPT_VERSION } from "./extract";

/** Runs the assistant on one document and stores exactly what it returned. */
export async function runAssistant(documentId: number, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [doc] = await q<DocRow>(`select ${DOC_COLS} from intake.documents where id = $1`, [documentId]);
  if (!doc) return { ok: false, error: "Document not found." };

  try {
    const r = await extract({ body: doc.body, channel: doc.channel, sender: doc.sender, receivedAt: new Date(doc.received_at) });
    const [proposal] = await q<ProposalRow>(
      `insert into intake.proposals (document_id, model, prompt_version, extraction, input_tokens, output_tokens, cost_usd, latency_ms)
       values ($1, $2, $3, $4, $5, $6, $7, $8) returning *`,
      [documentId, r.model, PROMPT_VERSION, JSON.stringify(r.extraction), r.inputTokens, r.outputTokens, r.costUsd.toFixed(5), r.latencyMs],
    );
    await q(`update intake.documents set state = 'proposed' where id = $1`, [documentId]);
    const a = assess(doc, proposal, new Map());
    await audit(actor, "ai.proposed", documentId, {
      proposal_id: proposal.id,
      model: r.model,
      prompt_version: PROMPT_VERSION,
      doc_type: a.docType,
      suggested_queue: a.routing.queue,
      status: a.routing.status,
      failed_checks: a.checks.filter((c) => c.problem).map((c) => c.key),
      input_tokens: r.inputTokens,
      output_tokens: r.outputTokens,
      cost_usd: Number(r.costUsd.toFixed(5)),
      latency_ms: r.latencyMs,
    });
    return { ok: true };
  } catch (e) {
    const message = e instanceof ExtractionError ? e.message : "The assistant could not be reached.";
    await audit(actor, "ai.failed", documentId, { reason: message });
    if (!(e instanceof ExtractionError)) console.error(e);
    return { ok: false, error: message };
  }
}
