import { describe, expect, it } from "vitest";
import { DOCUMENTS } from "@/data/documents";
import { checkFields, datesIn, isValidNpi, locate, type ExtractedField } from "./checks";
import type { DocType } from "./fields";
import { route, type Clinical } from "./routing";

const doc = (slug: string) => DOCUMENTS.find((d) => d.slug === slug)!;
const f = (key: ExtractedField["key"], value: string | null, quote: string | null): ExtractedField => ({ key, value, quote });
const noClinical: Clinical = { present: false, red_flag: false, quote: null };

function run(slug: string, docType: DocType, fields: ExtractedField[], opts: { urgency?: "urgent" | "routine" | "not_stated"; clinical?: Clinical } = {}) {
  const d = doc(slug);
  const receivedAt = new Date(d.receivedAt);
  const checks = checkFields(docType, fields, d.text, receivedAt);
  const routing = route({ docType, urgency: opts.urgency ?? "not_stated", clinical: opts.clinical ?? noClinical, checks, receivedAt });
  return { checks, routing, byKey: (k: string) => checks.find((c) => c.key === k)! };
}

describe("locate", () => {
  it("ignores case and whitespace runs, and returns offsets into the original", () => {
    const text = "Reason for referral: Right knee pain\nwith   physical therapy.";
    const span = locate(text, "right knee pain with physical therapy");
    expect(span).not.toBeNull();
    expect(text.slice(span![0], span![1])).toBe("Right knee pain\nwith   physical therapy");
  });
  it("returns null when the quote is not in the text", () => {
    expect(locate("Member ID: CHP-1", "Member ID: CHP-2")).toBeNull();
  });
});

describe("validators", () => {
  it("accepts NPIs with a valid check digit and rejects the rest", () => {
    expect(isValidNpi("1482035718")).toBe(true);
    expect(isValidNpi("1629503845")).toBe(false);
    expect(isValidNpi("123")).toBe(false);
  });
  it("reads US dates, including two-digit years", () => {
    expect(datesIn("DOB 3/4/61 and 10/02/2026")).toEqual(["1961-03-04", "2026-10-02"]);
  });
});

describe("referral, complete", () => {
  const fields = [
    f("patient_name", "Maria Okafor", "Patient name: Maria Okafor"),
    f("dob", "1961-03-14", "Date of birth: 03/14/1961"),
    f("referring_provider", "Dr. Alan Brierley, MD", "Referring provider: Dr. Alan Brierley, MD"),
    f("referring_npi", "1482035718", "NPI: 1482035718"),
    f("reason", "Right knee pain, evaluation", "Reason for referral: Right knee pain for 4 months"),
    f("insurance_plan", "Crestline Health Plan PPO", "Insurance: Crestline Health Plan PPO"),
    f("member_id", "CHP-77310554", "Member ID: CHP-77310554"),
  ];
  it("is ready for Scheduling when every field is grounded and valid", () => {
    const { routing, checks } = run("referral-okafor", "referral", fields);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(routing).toMatchObject({ queue: "Scheduling", status: "ready" });
  });
  it("flags a value the model changed from what the document says", () => {
    const tampered = fields.map((x) => (x.key === "dob" ? f("dob", "1961-04-14", x.quote) : x));
    const { byKey, routing } = run("referral-okafor", "referral", tampered);
    expect(byKey("dob")).toMatchObject({ status: "invalid", problem: "Date does not match the source text" });
    expect(routing.status).toBe("attention");
  });
  it("flags a quote that is not in the document", () => {
    const invented = fields.map((x) => (x.key === "member_id" ? f("member_id", "CHP-1", "Member ID: CHP-1") : x));
    const { byKey } = run("referral-okafor", "referral", invented);
    expect(byKey("member_id").status).toBe("ungrounded");
  });
});

describe("referral rules", () => {
  it("sends a referral with a failing NPI to Intake Review, not Scheduling", () => {
    const { routing, byKey } = run("referral-osei", "referral", [
      f("patient_name", "Kwame Osei", "Patient: Kwame Osei"),
      f("dob", "2009-02-17", "DOB: 02/17/2009"),
      f("referring_provider", "Dr. Helen Marsh", "Referring provider: Dr. Helen Marsh"),
      f("referring_npi", "1629503845", "NPI: 1629503845"),
      f("reason", "Recurrent headaches", "Reason for referral: Recurrent headaches"),
      f("insurance_plan", "Prairie Kids CHIP", "Insurance: Prairie Kids CHIP"),
      f("member_id", "PKC-0092217", "Member ID: PKC-0092217"),
    ]);
    expect(byKey("referring_npi").problem).toBe("NPI fails the check-digit test");
    expect(routing.queue).toBe("Intake Review");
    expect(routing.tags.map((t) => t.sop)).toContain("SOP-101 §4");
  });
  it("keeps an urgent referral with no member ID in Scheduling, tagged insurance pending", () => {
    const { routing } = run(
      "referral-farrow",
      "referral",
      [
        f("patient_name", "Dennis Farrow", "Patient: Dennis Farrow"),
        f("dob", "1954-11-02", "DOB: 11/02/1954"),
        f("referring_provider", "Priya Raman, MD", "Referring: Priya Raman, MD"),
        f("referring_npi", "1938460270", "NPI 1938460270"),
        f("reason", "Cardiology evaluation", "Requesting\ncardiology evaluation"),
        f("insurance_plan", "Medicare Part B", "Insurance: Medicare Part B, ID to follow"),
        f("member_id", null, null),
      ],
      { urgency: "urgent" },
    );
    expect(routing.queue).toBe("Scheduling");
    expect(routing.status).toBe("attention");
    expect(routing.tags.map((t) => t.label)).toEqual(["Insurance pending", "Urgent: book within 3 business days"]);
  });
});

describe("other document types", () => {
  it("tags an approval that ends within 14 days of receipt as expiring", () => {
    const { routing } = run("auth-okafor", "prior_auth_determination", [
      f("patient_name", "Maria Okafor", "Member: OKAFOR, MARIA"),
      f("dob", "1961-03-14", "Member DOB: 03/14/1961"),
      f("payer", "Crestline Health Plan", "CRESTLINE HEALTH PLAN"),
      f("determination", "approved", "Determination: APPROVED"),
      f("auth_number", "PA-2026-0918-4471", "Authorization #: PA-2026-0918-4471"),
      f("cpt_code", "73721", "CPT: 73721"),
      f("units", "1", "Units approved: 1"),
      f("valid_from", "2026-09-10", "Valid from: 09/10/2026"),
      f("valid_through", "2026-10-02", "Valid through: 10/02/2026"),
    ]);
    expect(routing).toMatchObject({ queue: "Authorizations", status: "ready" });
    expect(routing.tags[0]).toMatchObject({ sop: "SOP-102 §2", tone: "note" });
  });
  it("holds a third-party records request whose authorization has no expiration", () => {
    const { routing } = run("records-hale", "records_request", [
      f("patient_name", "Thomas Beck", "Our client: Thomas Beck"),
      f("dob", "1979-05-09", "DOB 05/09/1979"),
      f("requester", "Hale & Norquist LLP", "HALE & NORQUIST LLP"),
      f("requester_type", "attorney", "Attorneys at Law"),
      f("auth_expiration", null, "This authorization expires on: ______"),
      f("auth_signed", "yes", "Patient signature: Thomas Beck"),
    ]);
    expect(routing.queue).toBe("Health Information");
    expect(routing.tags.map((t) => t.sop)).toEqual(["SOP-104 §3", "SOP-104 §4"]);
    expect(routing.status).toBe("attention");
  });
  it("accepts a classified value whose quote exists, and rejects one outside the allowed set", () => {
    const d = doc("records-hale");
    const at = new Date(d.receivedAt);
    const ok = checkFields("records_request", [f("requester_type", "attorney", "Attorneys at Law")], d.text, at);
    expect(ok.find((c) => c.key === "requester_type")!.status).toBe("ok");
    const bad = checkFields("records_request", [f("requester_type", "lawyer", "Attorneys at Law")], d.text, at);
    expect(bad.find((c) => c.key === "requester_type")!.status).toBe("invalid");
  });
  it("does not require an authorization from a treating provider", () => {
    const d = doc("records-hale");
    const checks = checkFields("records_request", [f("requester_type", "treating_provider", "Attorneys at Law")], d.text, new Date(d.receivedAt));
    expect(checks.map((c) => c.key)).not.toContain("auth_expiration");
  });
  it("sends clinical content to Nurse Triage whatever the document asks for", () => {
    const { routing } = run(
      "message-whitfield",
      "patient_message",
      [
        f("patient_name", "James Whitfield", "From: James Whitfield"),
        f("dob", "1957-04-22", "DOB 04/22/1957"),
        f("request", "Reschedule follow-up after 3pm", "I need to move my follow-up on 09/29"),
      ],
      { clinical: { present: true, red_flag: true, quote: "chest tightness" } },
    );
    expect(routing).toMatchObject({ queue: "Nurse Triage", status: "escalated" });
    expect(routing.tags[0].label).toBe("Call nurse line ext. 4410 now");
  });
  it("sends an unclassifiable fragment to Intake Review", () => {
    const { routing } = run("fax-fragment", "unclassifiable", []);
    expect(routing).toMatchObject({ queue: "Intake Review", status: "attention" });
  });
});

describe("human edits", () => {
  it("accepts a well-formed value a person typed, and rejects a malformed one", () => {
    const d = doc("referral-farrow");
    const at = new Date(d.receivedAt);
    const ok = checkFields("referral", [f("member_id", "1EG4-TE5-MK72", null)], d.text, at, new Set(["member_id"]));
    expect(ok.find((c) => c.key === "member_id")!.status).toBe("edited");
    const bad = checkFields("referral", [f("dob", "11/02/1954", null)], d.text, at, new Set(["dob"]));
    expect(bad.find((c) => c.key === "dob")!.problem).toBe("Use YYYY-MM-DD");
  });
});
