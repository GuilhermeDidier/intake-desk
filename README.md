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
| **An agent that proposes, a person who approves** | After triage, the next-steps agent looks the patient up in the practice-management system (read-only tools it runs itself) and proposes the follow-up work the SOPs call for: a patient record, a coverage update, a task with a due date, a fax asking the sender for a missing field. Each proposal waits for a coordinator to approve it. |
| **The agent can't invent data** | It never sees the raw document, only the fields that passed the checks, so instructions hidden in a fax can't reach it. Every proposal is re-checked in code (`lib/agent-rules.ts`): values must equal the verified ones, no duplicate patients, no clinical words in task titles, faxes only back to the sender and never to patients, nothing on clinical documents. Blocked attempts are shown on screen. |
| **PDFs, typed or scanned** | Upload a PDF and the assistant transcribes it first; the checks and highlights run on the transcription, with the original one click away. Try the sample scan on the Add a document page. |
| **Answers from the SOPs, or none** | "Ask the SOPs" retrieves sections, answers only from them with native citations, and highlights the cited passages. An answer with no citation isn't shown. If nothing relevant is retrieved, the model isn't called at all. |
| **Cost you can see** | Each proposal and plan stores model, prompt version, tokens, cost and latency. About $0.01 and 5 seconds to read a document, about $0.04 and 10 seconds to plan next steps (Claude Sonnet 5). The public demo caps model calls per visitor and per day. |

Try the example "A fax that talks to the AI" on the Paste a document page: the fax tells the assistant to mark every check as passed and skip review. It doesn't.

## How it works

```
document ──► extract (Claude, structured output)
               { doc_type, fields: [{key, value, quote}], clinical, urgency }
          ──► checkFields()   quote found? value agrees with quote? format valid?
          ──► route()         SOP rules → queue, tags, status (ready / attention / escalated)
          ──► person          approve · correct a field · route elsewhere
          ──► queue task + audit entry
          ──► next-steps agent  find_patient, list_patient_tasks   (runs itself, read-only)
                                create_patient, update_coverage,
                                create_task, send_fax              (proposals, re-checked in code)
          ──► person          approve and run · dismiss   → CRM + audit entry
```

The stored proposal is exactly what the model returned. The verdict is recomputed from it on every read, so a rule change applies to documents already in the inbox, and nothing the browser sends can skip a rule.

**The CRM.** The agent acts through one interface (`lib/crm.ts`). Here it is backed by tables; in production the same interface wraps the practice-management or CRM vendor's API, and the agent doesn't change. Approval re-runs the checks against the document as it is at that moment, so a field corrected after the plan was made is respected.

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
lib/agent.ts      the next-steps agent loop
lib/agent-rules.ts what the agent may propose (pure, tested)
lib/crm.ts        the system the agent acts on
lib/desk.ts       reads; the verdict is recomputed here
app/actions.ts    every write, with role checks
db/001_schema.sql tables, append-only audit trigger
db/002_agent.sql  agent runs, proposed actions, CRM tables
db/role.sql       least-privilege app role
data/             the synthetic SOPs and documents
```

## Run it

```bash
npm install
# owner connection string of an empty Postgres/Supabase database
ADMIN_DATABASE_URL=postgres://... npx tsx scripts/setup-db.ts   # schema + app role, writes .env.local
echo "ANTHROPIC_API_KEY=..." >> .env.local
npx tsx --env-file=.env.local scripts/seed.ts                     # SOPs, documents, first reads and plans (~$0.40)
npm run dev
npm test
npx tsx --env-file=.env.local scripts/eval-retrieval.ts
```

## Not in this demo

Real integrations (fax server, EHR or CRM: tables stand in for them behind the same interface), authentication, and a BAA with the model provider, which a production deployment handling real patient data requires.
