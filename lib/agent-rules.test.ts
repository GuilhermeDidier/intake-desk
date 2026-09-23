import { describe, expect, it } from "vitest";
import { checkAction, type Facts } from "./agent-rules";
import type { FieldCheck } from "./checks";

const field = (key: string, value: string | null, status: FieldCheck["status"] = "ok"): FieldCheck =>
  ({ key, label: key, value, quote: null, required: true, status, problem: status === "ok" || status === "edited" ? null : "x", span: null }) as FieldCheck;

const why = { reason: "Because the SOP says so.", sop: "SOP-101 §2" };

function facts(over: Partial<Facts> = {}): Facts {
  return {
    checks: [
      field("patient_name", "Lena Park"),
      field("dob", "1988-07-30"),
      field("phone", "(555) 017-3345"),
      field("insurance_plan", "BlueHarbor Choice PPO"),
      field("member_id", "BHC-55017742"),
      field("effective_date", "2026-10-01"),
    ],
    channel: "fax",
    sender: "Riverton Internal Medicine",
    found: [],
    knownPatientIds: new Set(),
    ...over,
  };
}

describe("create_patient", () => {
  it("accepts the verified name and date of birth", () => {
    expect(checkAction("create_patient", { name: "Lena Park", dob: "1988-07-30", phone: null, ...why }, facts()).ok).toBe(true);
  });
  it("rejects a date of birth that is not the verified one", () => {
    const r = checkAction("create_patient", { name: "Lena Park", dob: "1988-07-03", phone: null, ...why }, facts());
    expect(r).toMatchObject({ ok: false });
  });
  it("refuses to create a duplicate of a patient the lookup found", () => {
    const f = facts({ found: [{ id: "P-10231", name: "Lena Park", dob: "1988-07-30" }] });
    expect(checkAction("create_patient", { name: "Lena Park", dob: "1988-07-30", phone: null, ...why }, f)).toMatchObject({ ok: false });
  });
  it("refuses when the date of birth failed validation", () => {
    const f = facts({ checks: [field("patient_name", "Lena Park"), field("dob", "1988-07-30", "invalid")] });
    expect(checkAction("create_patient", { name: "Lena Park", dob: "1988-07-30", phone: null, ...why }, f)).toMatchObject({ ok: false });
  });
});

describe("update_coverage", () => {
  const input = { patient_id: "P-09877", plan: "BlueHarbor Choice PPO", member_id: "BHC-55017742", effective_date: "2026-10-01", ...why };
  it("needs the patient id to come from a lookup", () => {
    expect(checkAction("update_coverage", input, facts())).toMatchObject({ ok: false });
    const f = facts({ found: [{ id: "P-09877", name: "Rosa Alvarez", dob: "1970-12-01" }] });
    expect(checkAction("update_coverage", input, f).ok).toBe(true);
  });
  it("rejects a member ID that differs from the verified one", () => {
    const f = facts({ found: [{ id: "P-09877", name: "Rosa Alvarez", dob: "1970-12-01" }] });
    expect(checkAction("update_coverage", { ...input, member_id: "BHC-55017743" }, f)).toMatchObject({ ok: false });
  });
});

describe("create_task", () => {
  const task = { queue: "Scheduling", title: "Book urgent visit within 3 business days", due_on: "2026-09-28", patient_id: null, ...why };
  it("accepts a plain administrative task", () => {
    expect(checkAction("create_task", task, facts()).ok).toBe(true);
  });
  it("keeps clinical details out of titles", () => {
    expect(checkAction("create_task", { ...task, title: "Book visit for new atrial fibrillation" }, facts())).toMatchObject({ ok: false });
  });
  it("never creates Nurse Triage tasks", () => {
    expect(checkAction("create_task", { ...task, queue: "Nurse Triage" }, facts())).toMatchObject({ ok: false });
  });
  it("rejects a patient id nobody looked up", () => {
    expect(checkAction("create_task", { ...task, patient_id: "P-99999" }, facts())).toMatchObject({ ok: false });
  });
});

describe("send_fax", () => {
  const fax = { recipient: "Riverton Internal Medicine", subject: "Missing member ID", body: "Please send the member ID for the referral dated 09/22.", ...why };
  it("may answer the office that sent the fax", () => {
    expect(checkAction("send_fax", fax, facts()).ok).toBe(true);
  });
  it("may not write to anyone else", () => {
    expect(checkAction("send_fax", { ...fax, recipient: "Some Other Clinic" }, facts())).toMatchObject({ ok: false });
  });
  it("never contacts a patient who wrote through the portal", () => {
    expect(checkAction("send_fax", { ...fax, recipient: "Patient portal · Message" }, facts({ channel: "portal", sender: "Patient portal · Message" }))).toMatchObject({ ok: false });
  });
});

it("rejects unknown tools and malformed input", () => {
  expect(checkAction("delete_patient", {}, facts())).toMatchObject({ ok: false });
  expect(checkAction("create_task", { queue: "Scheduling" }, facts())).toMatchObject({ ok: false });
});
