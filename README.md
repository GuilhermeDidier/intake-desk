# Intake Desk

Document triage for the intake desk of an outpatient clinic group. Faxes, portal forms and emails arrive; an AI assistant reads each one and extracts the index fields; rules written from the clinic's SOPs decide where it goes; a person approves. Every value on screen traces back to the exact place in the document it came from.

All data is synthetic. The clinic, patients, providers, payers and numbers are invented.

## What it shows

| | |
|---|---|
| **Grounded extraction** | The model returns each field with the exact text it read it from. Code then checks the quote is really in the document and the value agrees with it: dates are re-read from the quote, NPIs pass the check-digit test, phone digits match. A value the model changed or invented fails, visibly, in pink. |
| **The model doesn't route** | Routing is plain TypeScript (`lib/routing.ts`), one rule per SOP section, each citing its section. The model classifies and extracts; it never decides where a document goes. |
| **Clinical content goes to a nurse** | If a patient describes symptoms, the document goes to Nurse Triage whatever else it asks for, and only a triage nurse can take it. The assistant flags the sentence and does not interpret it. |
| **People approve, and it's recorded** | A person approves every routing, can correct any field (the correction is format-checked and marked as typed by a person), and can route elsewhere. The server recomputes the verdict on every action. |
| **Append-only audit trail** | The app's database role can insert audit rows but not update, delete or truncate them, and a trigger blocks it for everyone else. Entries record which fields changed, never their values, so the log isn't a second copy of patient data. |
| **Answers from the SOPs, or none** | "Ask the SOPs" retrieves sections, answers only from them with native citations, and highlights the cited passages. An answer with no citation isn't shown. If nothing relevant is retrieved, the model isn't called at all. |
| **Cost you can see** | Each proposal stores model, prompt version, tokens, cost and latency. About $0.02 and 5 seconds per document. The public demo caps model calls per visitor and per day. |

Try the example "A fax that talks to the AI" on the Paste a document page: the fax tells the assistant to mark every check as passed and skip review. It doesn't.

## How it works

```
document ──► extract (Claude, structured output)
               { doc_type, fields: [{key, value, quote}], clinical, urgency }
          ──► checkFields()   quote found? value agrees with quote? format valid?
          ──► route()         SOP rules → queue, tags, status (ready / attention / escalated)
          ──► person          approve · correct a field · route elsewhere
          ──► queue task + audit entry
```

The stored proposal is exactly what the model returned. The verdict is recomputed from it on every read, so a rule change applies to documents already in the inbox, and nothing the browser sends can skip a rule.

**Roles.** The demo has no login: pick a role in the header. Intake coordinators correct fields and route administrative documents; triage nurses take clinical ones; operations admins also edit SOPs. The server enforces this on every action. In production the role comes from the identity provider.

**Knowledge.** SOP sections are rows with versions. Editing one inserts a new version and keeps the old, and every answer logs which section versions it used. Retrieval is Postgres full-text search with each term weighted by how rare it is across sections, so "chest pain" outweighs "patient message". Sections are short, so the model gets the top eight and cites only what answers the question.

`scripts/eval-retrieval.ts` checks that the section answering each of a set of real questions is among those eight (currently 10/10). It makes no model calls, so it is cheap enough to run on every SOP change. Plain word matching misses synonyms: at three sections instead of eight, "the payer denied it" does not find the section titled "Denials". When the knowledge base grows and this eval starts failing, add pgvector embeddings next to the text search and merge the two rankings; `search()` keeps its interface.

## Stack

Next.js 16 (App Router, server actions) · PostgreSQL on Supabase, in its own schema, reached by a role that can see nothing else · Claude via the Anthropic SDK (structured outputs for extraction, citations for Q&A) · Vitest.

```
lib/checks.ts     grounding and format checks (pure, tested)
lib/routing.ts    SOP rules (pure, tested)
lib/extract.ts    the extraction prompt and schema
lib/knowledge.ts  retrieval and cited answers
lib/desk.ts       reads; the verdict is recomputed here
app/actions.ts    every write, with role checks
db/schema.sql     tables, append-only audit trigger
db/role.sql       least-privilege app role
data/             the synthetic SOPs and documents
```

## Run it

```bash
npm install
# owner connection string of an empty Postgres/Supabase database
ADMIN_DATABASE_URL=postgres://... npx tsx scripts/setup-db.ts   # schema + app role, writes .env.local
echo "ANTHROPIC_API_KEY=..." >> .env.local
npx tsx --env-file=.env.local scripts/seed.ts                     # SOPs, documents, first reads (~$0.20)
npm run dev
npm test
npx tsx --env-file=.env.local scripts/eval-retrieval.ts
```

## Not in this demo

Real integrations (fax server, EHR or CRM: the queue task table stands in for them), authentication, PDF and image input with OCR, and a BAA with the model provider, which a production deployment handling real patient data requires.
