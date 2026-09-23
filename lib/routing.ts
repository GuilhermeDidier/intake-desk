// Routing is code, not model output. The model reads and extracts; these rules,
// each tied to an SOP section, decide where the document goes.

import type { Queue } from "@/data/sops";
import { parseIsoDate, type FieldCheck } from "./checks";
import type { DocType } from "./fields";

export type Clinical = { present: boolean; red_flag: boolean; quote: string | null };

export type Tag = { label: string; sop: string; tone: "block" | "note" };

export type Status = "ready" | "attention" | "escalated";

export type Routing = {
  queue: Queue;
  status: Status;
  tags: Tag[];
  reasons: { text: string; sop: string }[];
};

const DAY = 86_400_000;

function fmt(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function route(input: {
  docType: DocType;
  urgency: "urgent" | "routine" | "not_stated";
  clinical: Clinical;
  checks: FieldCheck[];
  receivedAt: Date;
}): Routing {
  const { docType, urgency, clinical, checks, receivedAt } = input;
  const val = (k: string) => checks.find((c) => c.key === k)?.value ?? null;
  const check = (k: string) => checks.find((c) => c.key === k);
  const tags: Tag[] = [];
  const reasons: Routing["reasons"] = [];

  const fieldProblems = checks.filter((c) => c.required && (c.status === "missing" || c.status === "ungrounded" || c.status === "invalid"));

  // SOP-106 wins over everything: clinical content goes to a nurse, whatever else the document asks.
  if (clinical.present) {
    reasons.push({ text: "Describes symptoms or medication problems", sop: "SOP-106 §1" });
    if (clinical.red_flag) tags.push({ label: "Call nurse line ext. 4410 now", sop: "SOP-106 §2", tone: "block" });
    tags.push({ label: "Same day", sop: "SOP-106 §1", tone: "block" });
    if (docType === "patient_message" && val("request")) {
      reasons.push({ text: "Handle the administrative request after nurse review", sop: "SOP-106 §1" });
    }
    return { queue: "Nurse Triage", status: "escalated", tags, reasons };
  }

  let queue: Queue;
  switch (docType) {
    case "referral": {
      const npi = check("referring_npi");
      if (!npi || (npi.status !== "ok" && npi.status !== "edited")) {
        queue = "Intake Review";
        reasons.push({ text: "Referring NPI is missing or fails validation", sop: "SOP-101 §4" });
        tags.push({ label: "Confirm referring provider", sop: "SOP-101 §4", tone: "block" });
      } else {
        queue = "Scheduling";
        reasons.push({ text: "New referral", sop: "SOP-100 §2" });
      }
      if (!val("insurance_plan") || !val("member_id")) {
        tags.push({ label: "Insurance pending", sop: "SOP-101 §2", tone: "block" });
      }
      if (urgency === "urgent") tags.push({ label: "Urgent: book within 3 business days", sop: "SOP-101 §3", tone: "note" });
      break;
    }
    case "prior_auth_determination": {
      queue = "Authorizations";
      reasons.push({ text: "Payer determination", sop: "SOP-102 §1" });
      const det = (val("determination") ?? "").toLowerCase();
      if (det.includes("den")) tags.push({ label: "Appeal review", sop: "SOP-102 §3", tone: "note" });
      const through = val("valid_through");
      const end = through ? parseIsoDate(through) : null;
      if (det.includes("approv") && end) {
        const days = Math.ceil((end.getTime() - receivedAt.getTime()) / DAY);
        if (days <= 14) tags.push({ label: `Expiring: valid through ${fmt(end)}`, sop: "SOP-102 §2", tone: "note" });
      }
      break;
    }
    case "new_patient_intake":
      queue = "Registration";
      reasons.push({ text: "New patient registration", sop: "SOP-100 §2" });
      if (val("consent_signed") === "no") tags.push({ label: "Signature required", sop: "SOP-103 §2", tone: "block" });
      break;
    case "records_request": {
      queue = "Health Information";
      reasons.push({ text: "Request for medical records", sop: "SOP-100 §2" });
      const thirdParty = val("requester_type") !== "treating_provider";
      if (thirdParty && (!val("auth_expiration") || val("auth_signed") !== "yes")) {
        tags.push({ label: "Authorization incomplete: release nothing", sop: "SOP-104 §3", tone: "block" });
      }
      tags.push({ label: `Respond by ${fmt(new Date(receivedAt.getTime() + 30 * DAY))}`, sop: "SOP-104 §4", tone: "note" });
      break;
    }
    case "insurance_update": {
      queue = "Registration";
      reasons.push({ text: "Patient-reported coverage change", sop: "SOP-105 §1" });
      const eff = val("effective_date");
      const start = eff ? parseIsoDate(eff) : null;
      if (start && start > receivedAt) {
        tags.push({ label: `Starts ${fmt(start)}: keep current coverage until then`, sop: "SOP-105 §2", tone: "note" });
      }
      break;
    }
    case "patient_message":
      queue = "Scheduling";
      reasons.push({ text: "Administrative request from a patient", sop: "SOP-100 §2" });
      break;
    case "unclassifiable":
      queue = "Intake Review";
      reasons.push({ text: "Document could not be classified", sop: "SOP-100 §2" });
      tags.push({ label: "Identify sender and missing pages", sop: "SOP-100 §2", tone: "block" });
      break;
  }

  const blocked = fieldProblems.length > 0 || tags.some((t) => t.tone === "block");
  return { queue, status: blocked ? "attention" : "ready", tags, reasons };
}
