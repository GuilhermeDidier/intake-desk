// The next-steps agent. It looks things up on its own (read-only tools), then proposes
// actions (write tools) that wait for a person. It never sees the raw document: only the
// facts the checks verified, so instructions hidden in a fax cannot reach it.
import Anthropic from "@anthropic-ai/sdk";
import { q, tx } from "./db";
import { crm } from "./crm";
import { checkAction, MAX_ACTIONS, ACTION_TOOLS, type Facts } from "./agent-rules";
import { audit, type DocRow } from "./desk";
import { costOf, MODEL } from "./extract";
import { DOC_TYPE_LABEL } from "./fields";
import type { Assessment } from "./desk";

export const AGENT_PROMPT_VERSION = "next-steps-v3";
const MAX_TURNS = 8;

type Tool = Anthropic.Beta.BetaTool;
const reasonProps = {
  reason: { type: "string", description: "Why, in one sentence a staff member can check." },
  sop: { type: "string", description: 'The SOP section that calls for this, like "SOP-101 §2".' },
};

const TOOLS: Tool[] = [
  {
    name: "find_patient",
    description: "Look up a patient in the practice-management system by name and date of birth. Read-only; runs immediately.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, dob: { type: "string", description: "YYYY-MM-DD" } },
      required: ["name", "dob"],
      additionalProperties: false,
    },
  },
  {
    name: "list_patient_tasks",
    description: "List recent tasks already open for a patient, to avoid duplicates. Read-only; runs immediately.",
    strict: true,
    input_schema: { type: "object", properties: { patient_id: { type: "string" } }, required: ["patient_id"], additionalProperties: false },
  },
  {
    name: "create_patient",
    description: "Propose creating a patient record. Only when find_patient found no match. Waits for staff approval.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, dob: { type: "string" }, phone: { type: ["string", "null"] }, ...reasonProps },
      required: ["name", "dob", "phone", "reason", "sop"],
      additionalProperties: false,
    },
  },
  {
    name: "update_coverage",
    description: "Propose updating a patient's insurance on file. Waits for staff approval.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        patient_id: { type: "string" },
        plan: { type: "string" },
        member_id: { type: "string" },
        effective_date: { type: "string", description: "YYYY-MM-DD" },
        ...reasonProps,
      },
      required: ["patient_id", "plan", "member_id", "effective_date", "reason", "sop"],
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    description:
      "Propose a follow-up task in a work queue. Not for the routing of this document itself, which staff do separately. Waits for staff approval.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        queue: { type: "string", enum: ["Scheduling", "Authorizations", "Registration", "Health Information", "Intake Review"] },
        title: { type: "string", description: "Short, no clinical details." },
        due_on: { type: ["string", "null"], description: "YYYY-MM-DD" },
        patient_id: { type: ["string", "null"] },
        ...reasonProps,
      },
      required: ["queue", "title", "due_on", "patient_id", "reason", "sop"],
      additionalProperties: false,
    },
  },
  {
    name: "send_fax",
    description: "Propose a fax back to the organization that sent this document, for example to request missing information. Waits for staff approval.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { recipient: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, ...reasonProps },
      required: ["recipient", "subject", "body", "reason", "sop"],
      additionalProperties: false,
    },
  },
];

const SYSTEM = `You plan follow-up work for the central intake desk of an outpatient specialty clinic group.

You get the verified facts of one inbound document: its type, the fields that passed validation, the fields that did not, the queue it is being routed to and the tags the routing rules applied. Staff route the document itself; you plan what else has to happen so the receiving team can act without chasing anything.

Work like this:
1. Look the patient up with find_patient, then check their open tasks with list_patient_tasks if they exist. The SOPs are included below; you do not need to look them up.
2. Propose only the actions the SOPs call for, at most ${MAX_ACTIONS}. Each must name its SOP section. Examples: a patient record for a new patient; a coverage update the patient reported; a task with a due date the SOP sets; a fax asking the sending office for a missing required field.
3. Use only verified values. Never fill in a field that failed validation; ask the sender for it instead, if the SOPs call for that.
4. Keep symptoms, diagnoses, tests and medications out of task titles and fax subjects. A fax body may say which document it concerns and what is missing, nothing clinical.
5. You never contact patients, never touch clinical content, and never decide the routing.
6. Tasks for a patient you are proposing to create use patient_id null.

Proposed actions do nothing until a staff member approves each one. When you are done, reply with at most two short sentences for the staff member: what you found and what you propose. If nothing needs doing, say so.`;

export type AgentStep = { tool: string; input: Record<string, unknown>; output: string };

function factsBlock(doc: DocRow, a: Assessment): string {
  const ok = a.checks.filter((c) => c.status === "ok" || c.status === "edited");
  const bad = a.checks.filter((c) => c.problem);
  return [
    `Document: ${DOC_TYPE_LABEL[a.docType]}, received ${new Date(doc.received_at).toISOString().slice(0, 10)} by ${doc.channel} from "${doc.sender}".`,
    `Being routed to: ${a.routing.queue}.`,
    `Routing reasons: ${a.routing.reasons.map((r) => `${r.text} (${r.sop})`).join("; ") || "none"}.`,
    `Tags: ${a.routing.tags.map((t) => `${t.label} (${t.sop})`).join("; ") || "none"}.`,
    `Verified fields:\n${ok.map((c) => `- ${c.key}: ${c.value}`).join("\n") || "- none"}`,
    `Fields that failed validation (do not use their values):\n${bad.map((c) => `- ${c.key}: ${c.problem}`).join("\n") || "- none"}`,
  ].join("\n\n");
}

const client = new Anthropic();

export async function planNextSteps(
  doc: DocRow,
  a: Assessment,
  actor: string,
): Promise<{ ok: true; runId: number } | { ok: false; error: string }> {
  if (a.routing.status === "escalated") return { ok: false, error: "The assistant does not plan actions on clinical content." };
  if (a.docType === "unclassifiable") return { ok: false, error: "Identify the document before planning next steps." };

  const started = Date.now();
  const facts: Facts = { checks: a.checks, channel: doc.channel, sender: doc.sender, found: [], knownPatientIds: new Set() };
  const steps: AgentStep[] = [];
  const proposed: { tool: string; input: Record<string, unknown> }[] = [];
  let cost = 0;
  let inTok = 0;
  let outTok = 0;
  let summary = "";

  // The SOPs are small enough to hand over whole, which saves the round trips of looking them up.
  const sops = await q<{ sop_id: string; sop_title: string; n: number; heading: string; body: string }>(
    `select sop_id, sop_title, n, heading, body from intake.sop_sections where is_current order by sop_id, n`,
  );
  const sopText = sops.map((r) => `${r.sop_id} §${r.n} (${r.sop_title}: ${r.heading}) ${r.body}`).join("\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `<sops>\n${sopText}\n</sops>\n\n${factsBlock(doc, a)}` },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      system: SYSTEM,
      tools: TOOLS,
      messages,
    });
    const u = response.usage;
    cost += costOf(u.input_tokens, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.output_tokens);
    inTok += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    outTok += u.output_tokens;

    if (response.stop_reason === "refusal") return { ok: false, error: "The model declined to plan for this document." };
    messages.push({ role: "assistant", content: response.content });

    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || uses.length === 0) {
      summary = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("")
        .trim();
      break;
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of uses) {
      const input = (use.input ?? {}) as Record<string, string>;
      let content: string;
      let isError = false;
      if (use.name === "find_patient") {
        const found = await crm.findPatients(String(input.name ?? ""), String(input.dob ?? ""));
        for (const p of found) {
          facts.found.push({ id: p.id, name: p.name, dob: p.dob });
          facts.knownPatientIds.add(p.id);
        }
        content = found.length ? JSON.stringify(found) : "No patient on file with that name and date of birth.";
        steps.push({ tool: use.name, input, output: found.length ? found.map((p) => p.id).join(", ") : "no match" });
      } else if (use.name === "list_patient_tasks") {
        const tasks = await crm.openTasks(String(input.patient_id ?? ""));
        content = tasks.length ? JSON.stringify(tasks) : "No open tasks.";
        steps.push({ tool: use.name, input, output: `${tasks.length} open` });
      } else if ((ACTION_TOOLS as string[]).includes(use.name)) {
        const check = checkAction(use.name, use.input, facts);
        if (proposed.length >= MAX_ACTIONS) {
          content = `Limit of ${MAX_ACTIONS} actions reached. Stop proposing and summarise.`;
          isError = true;
        } else if (!check.ok) {
          content = `Rejected: ${check.error}`;
          isError = true;
          steps.push({ tool: use.name, input, output: `rejected: ${check.error}` });
        } else {
          proposed.push({ tool: use.name, input: check.value as Record<string, unknown> });
          content = `Proposed as action ${proposed.length}. It runs only if a staff member approves it. Do not propose it again.`;
        }
      } else {
        content = `Unknown tool ${use.name}.`;
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content, is_error: isError });
    }
    messages.push({ role: "user", content: results });
  }

  if (!summary) summary = proposed.length ? "The plan is below." : "Nothing further to do for this document.";

  const runId = await tx(async (query) => {
    const [run] = await query<{ id: number }>(
      `insert into intake.agent_runs (document_id, model, prompt_version, summary, steps, input_tokens, output_tokens, cost_usd, latency_ms, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [doc.id, MODEL, AGENT_PROMPT_VERSION, summary, JSON.stringify(steps), inTok, outTok, cost.toFixed(5), Date.now() - started, actor],
    );
    for (const [i, p] of proposed.entries()) {
      await query(`insert into intake.agent_actions (run_id, document_id, seq, tool, input) values ($1, $2, $3, $4, $5)`, [
        run.id,
        doc.id,
        i + 1,
        p.tool,
        JSON.stringify(p.input),
      ]);
    }
    return run.id;
  });
  await audit("assistant", "agent.planned", doc.id, {
    run_id: runId,
    lookups: steps.filter((s) => !(ACTION_TOOLS as string[]).includes(s.tool)).map((s) => s.tool),
    proposed: proposed.map((p) => p.tool),
    rejected: steps.filter((s) => s.output.startsWith("rejected")).length,
    cost_usd: Number(cost.toFixed(5)),
  });
  return { ok: true, runId };
}
