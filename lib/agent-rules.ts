// What the next-steps agent may propose, checked in code. The prompt asks for good
// behaviour; these rules make the bad kind impossible to approve.
import { z } from "zod";
import { QUEUES } from "@/data/sops";
import type { FieldCheck } from "./checks";
import { parseIsoDate } from "./checks";

export const MAX_ACTIONS = 4;

const why = { reason: z.string().min(3).max(240), sop: z.string().regex(/^SOP-\d{3} §\d$/) };

export const ActionInputs = {
  create_patient: z.object({ name: z.string().min(2).max(80), dob: z.string(), phone: z.string().max(20).nullable(), ...why }),
  update_coverage: z.object({
    patient_id: z.string().regex(/^P-\d{5}$/),
    plan: z.string().min(2).max(80),
    member_id: z.string().min(2).max(40),
    effective_date: z.string(),
    ...why,
  }),
  create_task: z.object({
    queue: z.enum(QUEUES),
    title: z.string().min(5).max(90),
    due_on: z.string().nullable(),
    patient_id: z.string().regex(/^P-\d{5}$/).nullable(),
    ...why,
  }),
  send_fax: z.object({ recipient: z.string().min(2).max(120), subject: z.string().min(3).max(120), body: z.string().min(20).max(1200), ...why }),
} as const;
export type ActionTool = keyof typeof ActionInputs;
export const ACTION_TOOLS = Object.keys(ActionInputs) as ActionTool[];

export type Facts = {
  checks: FieldCheck[];
  channel: "fax" | "portal" | "email";
  sender: string;
  /** Patients the agent's own lookups returned during this run. */
  found: { id: string; name: string; dob: string }[];
  /** Patient ids that exist or were proposed in this run. */
  knownPatientIds: Set<string>;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A value the agent writes must be one the checks verified, not one it made up. */
function verified(facts: Facts, key: string): string | null {
  const c = facts.checks.find((x) => x.key === key);
  return c && (c.status === "ok" || c.status === "edited") ? c.value : null;
}

// Words that describe a clinical picture have no place in a task title (SOP-100 §4).
const CLINICAL_WORDS = /\b(pain|fibrillation|afib|a-fib|headache|symptom|diagnos|medication|chest|breath|mri|ecg|ekg|cancer|tumou?r|fracture|anticoag)/i;

export function checkAction(tool: string, input: unknown, facts: Facts): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!(tool in ActionInputs)) return { ok: false, error: `Unknown action ${tool}.` };
  const parsed = ActionInputs[tool as ActionTool].safeParse(input);
  if (!parsed.success) return { ok: false, error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
  const v = parsed.data as Record<string, string | null>;

  switch (tool as ActionTool) {
    case "create_patient": {
      const name = verified(facts, "patient_name");
      const dob = verified(facts, "dob");
      if (!name || !dob) return { ok: false, error: "Patient name and date of birth must be verified on the document before creating a patient." };
      if (norm(v.name!) !== norm(name) || v.dob !== dob) return { ok: false, error: `Use the verified values: ${name}, ${dob}.` };
      const phone = verified(facts, "phone");
      if (v.phone && v.phone !== phone) return { ok: false, error: "Phone must be the verified value from the document, or null." };
      if (facts.found.some((p) => p.dob === dob)) return { ok: false, error: "find_patient returned a patient with this date of birth. Do not create a duplicate." };
      return { ok: true, value: v };
    }
    case "update_coverage": {
      const plan = verified(facts, "insurance_plan");
      const member = verified(facts, "member_id");
      const eff = verified(facts, "effective_date");
      if (!plan || !member || !eff) return { ok: false, error: "Plan, member ID and effective date must all be verified on the document." };
      if (v.plan !== plan || v.member_id !== member || v.effective_date !== eff) {
        return { ok: false, error: `Use the verified values: ${plan}, ${member}, ${eff}.` };
      }
      if (!facts.found.some((p) => p.id === v.patient_id)) return { ok: false, error: "Look the patient up with find_patient first and use the id it returns." };
      return { ok: true, value: v };
    }
    case "create_task": {
      if (v.queue === "Nurse Triage") return { ok: false, error: "The assistant does not create clinical tasks." };
      if (v.due_on && !parseIsoDate(v.due_on)) return { ok: false, error: "due_on must be YYYY-MM-DD or null." };
      if (CLINICAL_WORDS.test(v.title!)) return { ok: false, error: "Keep clinical details out of task titles (SOP-100 §4)." };
      if (v.patient_id && !facts.knownPatientIds.has(v.patient_id)) return { ok: false, error: "patient_id must come from find_patient or a patient created in this plan." };
      return { ok: true, value: v };
    }
    case "send_fax": {
      // The assistant may answer the office that faxed the document. It never contacts patients (SOP-100 §3).
      if (facts.channel !== "fax") return { ok: false, error: "Only documents that arrived by fax can be answered by fax; the assistant does not contact patients." };
      if (norm(v.recipient!) !== norm(facts.sender) && !norm(v.recipient!).includes(norm(facts.sender))) {
        return { ok: false, error: `A fax can only go back to the sender, ${facts.sender}.` };
      }
      if (CLINICAL_WORDS.test(v.subject!)) return { ok: false, error: "Keep clinical details out of the subject line." };
      return { ok: true, value: v };
    }
  }
}

/** One line a person can read on the action card. */
export function describeAction(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "create_patient":
      return `Create patient record for ${input.name}`;
    case "update_coverage":
      return `Update coverage on ${input.patient_id} to ${input.plan} from ${input.effective_date}`;
    case "create_task":
      return `Create task in ${input.queue}: ${input.title}`;
    case "send_fax":
      return `Fax ${input.recipient}: ${input.subject}`;
    default:
      return tool;
  }
}
