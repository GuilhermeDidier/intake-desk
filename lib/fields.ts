// The index vocabulary: which fields exist, how they are validated,
// and which ones each document type must carry.

export const DOC_TYPES = [
  "referral",
  "prior_auth_determination",
  "new_patient_intake",
  "records_request",
  "insurance_update",
  "patient_message",
  "unclassifiable",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  referral: "Referral",
  prior_auth_determination: "Prior auth determination",
  new_patient_intake: "New patient intake",
  records_request: "Records request",
  insurance_update: "Insurance update",
  patient_message: "Patient message",
  unclassifiable: "Unclassifiable",
};

export type FieldFormat = "text" | "date" | "npi" | "phone" | "cpt" | "yesno" | "int" | "choice";

// Fields the model classifies rather than copies. The quote must exist; the value must be one of these.
export const CHOICES: Partial<Record<string, readonly string[]>> = {
  determination: ["approved", "denied", "pending", "partial"],
  requester_type: ["attorney", "insurer", "treating_provider", "patient", "other"],
};

export const FIELD_SPEC = {
  patient_name: { label: "Patient", format: "text" },
  dob: { label: "Date of birth", format: "date" },
  phone: { label: "Phone", format: "phone" },
  address: { label: "Address", format: "text" },
  referring_provider: { label: "Referring provider", format: "text" },
  referring_npi: { label: "Referring NPI", format: "npi" },
  reason: { label: "Reason", format: "text" },
  urgency: { label: "Urgency", format: "text" },
  insurance_plan: { label: "Insurance plan", format: "text" },
  member_id: { label: "Member ID", format: "text" },
  payer: { label: "Payer", format: "text" },
  determination: { label: "Determination", format: "choice" },
  auth_number: { label: "Authorization #", format: "text" },
  cpt_code: { label: "CPT", format: "cpt" },
  units: { label: "Units", format: "int" },
  valid_from: { label: "Valid from", format: "date" },
  valid_through: { label: "Valid through", format: "date" },
  emergency_contact: { label: "Emergency contact", format: "text" },
  consent_signed: { label: "Consent signed", format: "yesno" },
  requester: { label: "Requester", format: "text" },
  requester_type: { label: "Requester type", format: "choice" },
  auth_expiration: { label: "Authorization expires", format: "text" },
  auth_signed: { label: "Authorization signed", format: "yesno" },
  effective_date: { label: "Effective date", format: "date" },
  request: { label: "Request", format: "text" },
} as const satisfies Record<string, { label: string; format: FieldFormat }>;

export type FieldKey = keyof typeof FIELD_SPEC;
export const FIELD_KEYS = Object.keys(FIELD_SPEC) as FieldKey[];

export const REQUIRED: Record<DocType, FieldKey[]> = {
  referral: [
    "patient_name",
    "dob",
    "referring_provider",
    "referring_npi",
    "reason",
    "insurance_plan",
    "member_id",
  ],
  prior_auth_determination: [
    "patient_name",
    "dob",
    "payer",
    "determination",
    "auth_number",
    "cpt_code",
    "units",
    "valid_from",
    "valid_through",
  ],
  new_patient_intake: [
    "patient_name",
    "dob",
    "phone",
    "address",
    "insurance_plan",
    "member_id",
    "emergency_contact",
    "consent_signed",
  ],
  records_request: [
    "patient_name",
    "dob",
    "requester",
    "requester_type",
    "auth_expiration",
    "auth_signed",
  ],
  insurance_update: ["patient_name", "dob", "insurance_plan", "member_id", "effective_date"],
  patient_message: ["patient_name", "dob", "request"],
  unclassifiable: [],
};

// Optional fields worth showing when the document has them.
export const OPTIONAL: Record<DocType, FieldKey[]> = {
  referral: ["phone", "urgency"],
  prior_auth_determination: ["member_id"],
  new_patient_intake: [],
  records_request: [],
  insurance_update: ["phone"],
  patient_message: [],
  unclassifiable: [],
};
