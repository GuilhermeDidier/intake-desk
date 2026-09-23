// Deterministic checks on what the model extracted. Nothing here trusts the model:
// every value must be found in the document, parse, and agree with its own quote.

import { CHOICES, FIELD_SPEC, OPTIONAL, REQUIRED, type DocType, type FieldKey } from "./fields";

export type ExtractedField = { key: FieldKey; value: string | null; quote: string | null };

export type FieldStatus = "ok" | "missing" | "ungrounded" | "invalid" | "edited";

export type FieldCheck = {
  key: FieldKey;
  label: string;
  value: string | null;
  quote: string | null;
  required: boolean;
  status: FieldStatus;
  problem: string | null;
  span: [number, number] | null;
};

// ---------- locating a quote in the source text ----------

/** Finds `quote` in `text` ignoring case and runs of whitespace. Returns offsets into `text`. */
export function locate(text: string, quote: string): [number, number] | null {
  const q = quote.trim().replace(/\s+/g, " ").toLowerCase();
  if (!q) return null;
  let norm = "";
  const map: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      norm += " ";
      prevSpace = true;
    } else {
      norm += ch.toLowerCase();
      prevSpace = false;
    }
    map.push(i);
  }
  const at = norm.indexOf(q);
  if (at < 0) return null;
  return [map[at], map[at + q.length - 1] + 1];
}

// ---------- format validators ----------

export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  // NPI check digit: Luhn over the number prefixed with 80840.
  const s = "80840" + npi;
  let sum = 0;
  let double = false;
  for (let i = s.length - 1; i >= 0; i--) {
    let d = s.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function parseIsoDate(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  return d;
}

/** US-style dates written in the quote, as ISO strings. */
export function datesIn(quote: string): string[] {
  const out: string[] = [];
  for (const m of quote.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/g)) {
    let y = +m[3];
    if (m[3].length === 2) y += y > 40 ? 1900 : 2000;
    out.push(`${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  return out;
}

const digits = (s: string) => s.replace(/\D/g, "");
const words = (s: string) => s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [];
// Enough to match "attorney" with "Attorneys"; a value that needs more than this is not a copy.
const stem = (w: string) => w.replace(/(es|s)$/, "");

/** Why a present value is not acceptable, or null if it is. */
function formatProblem(key: FieldKey, value: string, quote: string, receivedAt: Date): string | null {
  const format = FIELD_SPEC[key].format;
  switch (format) {
    case "date": {
      const d = parseIsoDate(value);
      if (!d) return "Not a valid date";
      if (!datesIn(quote).includes(value)) return "Date does not match the source text";
      if (key === "dob") {
        if (d > receivedAt) return "Date of birth is in the future";
        if (receivedAt.getUTCFullYear() - d.getUTCFullYear() > 120) return "Date of birth is implausible";
      }
      return null;
    }
    case "npi":
      if (!/^\d{10}$/.test(value)) return "NPI must be 10 digits";
      if (!digits(quote).includes(value)) return "NPI does not match the source text";
      if (!isValidNpi(value)) return "NPI fails the check-digit test";
      return null;
    case "phone":
      if (digits(value).length !== 10) return "Phone must have 10 digits";
      if (!digits(quote).includes(digits(value))) return "Phone does not match the source text";
      return null;
    case "cpt":
      if (!/^\d{4}[0-9A-Z]$/.test(value)) return "CPT must be 5 characters";
      if (!quote.includes(value)) return "CPT does not match the source text";
      return null;
    case "int":
      if (!/^\d+$/.test(value)) return "Must be a whole number";
      if (!digits(quote).includes(value)) return "Number does not match the source text";
      return null;
    case "yesno":
      return value === "yes" || value === "no" ? null : "Must be yes or no";
    case "choice":
      return CHOICES[key]?.includes(value) ? null : `Must be one of: ${CHOICES[key]?.join(", ")}`;
    case "text": {
      const vw = words(value).map(stem);
      if (vw.length === 0) return null;
      const qw = new Set(words(quote).map(stem));
      const hits = vw.filter((w) => qw.has(w)).length;
      return hits / vw.length >= 0.5 ? null : "Value is not supported by the quoted text";
    }
  }
}

// ---------- the field table ----------

export function requiredFor(docType: DocType, fields: ExtractedField[]): FieldKey[] {
  const req = REQUIRED[docType];
  if (docType !== "records_request") return req;
  // SOP-104 §2: treating providers do not need a patient authorization.
  const requester = fields.find((f) => f.key === "requester_type")?.value;
  return requester === "treating_provider" ? req.filter((k) => k !== "auth_expiration" && k !== "auth_signed") : req;
}

export function checkFields(
  docType: DocType,
  fields: ExtractedField[],
  text: string,
  receivedAt: Date,
  editedKeys: ReadonlySet<FieldKey> = new Set(),
): FieldCheck[] {
  const required = requiredFor(docType, fields);
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const keys = [...required, ...OPTIONAL[docType].filter((k) => !required.includes(k) && byKey.get(k)?.value)];

  return keys.map((key): FieldCheck => {
    const f = byKey.get(key);
    const value = f?.value?.trim() || null;
    const quote = f?.quote?.trim() || null;
    const base = { key, label: FIELD_SPEC[key].label, value, quote, required: required.includes(key) };
    const span = quote ? locate(text, quote) : null;

    if (!value) {
      return { ...base, status: "missing", problem: required.includes(key) ? "Not found in the document" : null, span };
    }
    if (editedKeys.has(key)) {
      // A person typed this value. It is their word, but it still has to be well-formed.
      const problem = formatOnly(key, value, receivedAt);
      return { ...base, status: problem ? "invalid" : "edited", problem, span };
    }
    if (!quote || !span) {
      return { ...base, status: "ungrounded", problem: "Quoted text was not found in the document", span: null };
    }
    const problem = formatProblem(key, value, text.slice(span[0], span[1]), receivedAt);
    return { ...base, status: problem ? "invalid" : "ok", problem, span };
  });
}

/** Format rules for a value a person typed (no quote to compare against). */
function formatOnly(key: FieldKey, value: string, receivedAt: Date): string | null {
  const format = FIELD_SPEC[key].format;
  if (format === "date") {
    const d = parseIsoDate(value);
    if (!d) return "Use YYYY-MM-DD";
    if (key === "dob" && d > receivedAt) return "Date of birth is in the future";
    return null;
  }
  if (format === "npi") return isValidNpi(value) ? null : "NPI fails the check-digit test";
  if (format === "phone") return digits(value).length === 10 ? null : "Phone must have 10 digits";
  if (format === "cpt") return /^\d{4}[0-9A-Z]$/.test(value) ? null : "CPT must be 5 characters";
  if (format === "int") return /^\d+$/.test(value) ? null : "Must be a whole number";
  if (format === "yesno") return value === "yes" || value === "no" ? null : "Must be yes or no";
  if (format === "choice") return CHOICES[key]?.includes(value) ? null : `Must be one of: ${CHOICES[key]?.join(", ")}`;
  return null;
}
