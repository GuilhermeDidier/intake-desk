// Fictitious standard operating procedures for a fictitious clinic group.
// They are the only knowledge the assistant is allowed to answer from.

export type SopSection = { n: number; heading: string; body: string };
export type Sop = { id: string; title: string; owner: string; sections: SopSection[] };

export const SOPS: Sop[] = [
  {
    id: "SOP-100",
    title: "Document intake and triage",
    owner: "Patient Access",
    sections: [
      {
        n: 1,
        heading: "Scope and turnaround",
        body: "Covers every fax, portal message and email that reaches the central intake inbox. Each document is classified, indexed and routed within 4 business hours of receipt.",
      },
      {
        n: 2,
        heading: "Queues",
        body: "Scheduling takes new referrals and appointment requests. Authorizations takes payer prior-authorization determinations. Registration takes new-patient intake forms and insurance or demographic changes. Health Information takes requests for medical records. Nurse Triage takes anything that describes symptoms, side effects, medications or clinical status. Intake Review takes anything that cannot be classified or verified.",
      },
      {
        n: 3,
        heading: "What the assistant may and may not do",
        body: "The AI assistant may classify a document, extract index fields and suggest a queue. It may not contact patients, interpret clinical content, or complete a routing on its own. A staff member approves every routing and is accountable for the indexed values.",
      },
      {
        n: 4,
        heading: "Minimum necessary",
        body: "Index only the fields the receiving queue needs. The full document stays in the document store. Never copy symptoms, diagnoses or medication details into task titles or notes.",
      },
    ],
  },
  {
    id: "SOP-101",
    title: "Incoming referrals",
    owner: "Scheduling",
    sections: [
      {
        n: 1,
        heading: "Required fields",
        body: "A referral must carry the patient's full name, date of birth, the referring provider's name and 10-digit NPI, the reason for referral, the insurance plan and the member ID.",
      },
      {
        n: 2,
        heading: "Missing insurance",
        body: "A referral with no insurance plan or no member ID is still accepted and routed to Scheduling, tagged insurance pending. Scheduling calls the referring office within 1 business day and does not book the visit until coverage is verified.",
      },
      {
        n: 3,
        heading: "Urgency",
        body: "Referrals marked urgent, STAT or expedite are booked within 3 business days. Routine referrals are booked within 15 business days.",
      },
      {
        n: 4,
        heading: "Invalid or missing NPI",
        body: "If the referring NPI is missing or fails validation, do not schedule. Route to Intake Review so the sending office can confirm the referring provider.",
      },
    ],
  },
  {
    id: "SOP-102",
    title: "Prior authorization determinations",
    owner: "Authorizations",
    sections: [
      {
        n: 1,
        heading: "Indexing",
        body: "Payer determinations route to Authorizations. Index the patient, date of birth, payer, authorization number, determination, CPT code, approved units and the valid-from and valid-through dates.",
      },
      {
        n: 2,
        heading: "Expiring approvals",
        body: "If an approval's valid-through date is 14 days away or less, tag it expiring so Scheduling books the service inside the window.",
      },
      {
        n: 3,
        heading: "Denials",
        body: "Denials route to Authorizations tagged appeal review. Intake never notifies the patient of a denial.",
      },
    ],
  },
  {
    id: "SOP-103",
    title: "New patient registration",
    owner: "Registration",
    sections: [
      {
        n: 1,
        heading: "Required fields",
        body: "An intake form needs the patient's name, date of birth, phone, address, insurance plan, member ID, an emergency contact and a signed consent to treat and financial responsibility.",
      },
      {
        n: 2,
        heading: "Unsigned consent",
        body: "If the consent is not signed, route to Registration tagged signature required. The patient signs at check-in. Do not cancel the appointment.",
      },
    ],
  },
  {
    id: "SOP-104",
    title: "Release of medical records",
    owner: "Health Information",
    sections: [
      {
        n: 1,
        heading: "Third-party requests need authorization",
        body: "A request from an attorney, an insurer or anyone other than a treating provider requires a HIPAA authorization signed by the patient. It must describe the information, name the recipient, state an expiration date or event, and carry the patient's signature and date.",
      },
      {
        n: 2,
        heading: "Treating providers",
        body: "A treating provider requesting records for continuity of care does not need a patient authorization.",
      },
      {
        n: 3,
        heading: "Incomplete authorization",
        body: "If any required element is missing, route to Health Information tagged authorization incomplete. Health Information sends a deficiency letter. No records are released.",
      },
      {
        n: 4,
        heading: "Deadline",
        body: "Records requests are answered within 30 days of receipt.",
      },
    ],
  },
  {
    id: "SOP-105",
    title: "Insurance and demographic updates",
    owner: "Registration",
    sections: [
      {
        n: 1,
        heading: "Routing",
        body: "Patient-reported changes to insurance, address or phone route to Registration. Index the new plan, the new member ID and the effective date.",
      },
      {
        n: 2,
        heading: "Future effective dates",
        body: "Verify eligibility before the next appointment. If the new coverage starts in the future, keep the current coverage on file until the effective date.",
      },
    ],
  },
  {
    id: "SOP-106",
    title: "Clinical content in administrative channels",
    owner: "Nursing",
    sections: [
      {
        n: 1,
        heading: "Always route to Nurse Triage",
        body: "Any message that describes symptoms, side effects or medication problems, or that asks for clinical advice, routes to Nurse Triage the same day, whatever else it asks for.",
      },
      {
        n: 2,
        heading: "Red flags",
        body: "Chest pain or tightness, shortness of breath, fainting, sudden weakness or numbness, and thoughts of self-harm are red flags. Intake staff call the nurse line at extension 4410 immediately instead of waiting for the queue.",
      },
      {
        n: 3,
        heading: "No clinical advice",
        body: "Intake staff and the AI assistant never give clinical advice, never reassure a patient about symptoms, and never tell a patient to wait for their appointment.",
      },
    ],
  },
];

export const QUEUES = [
  "Scheduling",
  "Authorizations",
  "Registration",
  "Health Information",
  "Nurse Triage",
  "Intake Review",
] as const;
export type Queue = (typeof QUEUES)[number];
