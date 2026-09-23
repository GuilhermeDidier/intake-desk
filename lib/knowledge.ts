import Anthropic from "@anthropic-ai/sdk";
import { q } from "./db";
import { MODEL, costOf } from "./extract";

export type Section = {
  id: number;
  sop_id: string;
  sop_title: string;
  n: number;
  heading: string;
  body: string;
  version: number;
  rank: number;
};

/**
 * Full-text retrieval over the current version of every SOP section.
 * Each query term is weighted by how rare it is across sections (inverse document
 * frequency), so "chest pain" outweighs "patient message", which is everywhere.
 * At a few dozen sections this is exact and free; past a few thousand, add pgvector
 * next to it and merge the two rankings.
 */
// Sections are short, so the model gets a generous handful: recall matters more than precision
// here, because the model cites only what answers the question.
export const RETRIEVE_K = 8;

export async function search(question: string, limit = RETRIEVE_K): Promise<Section[]> {
  const terms = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].slice(0, 24);
  if (terms.length === 0) return [];
  return q<Section>(
    `with cur as (select * from intake.sop_sections where is_current),
     terms as (
       select distinct on (tq::text) tq
       from (select plainto_tsquery('english', t) as tq from unnest($1::text[]) as t) x
       where tq::text <> ''
     ),
     weighted as (
       select tq, ln(((select count(*) from cur) + 1)::float / (1 + (select count(*) from cur c where c.tsv @@ tq))) as idf
       from terms
     )
     select c.id, c.sop_id, c.sop_title, c.n, c.heading, c.body, c.version, sum(w.idf) as rank
     from cur c join weighted w on c.tsv @@ w.tq
     group by c.id, c.sop_id, c.sop_title, c.n, c.heading, c.body, c.version
     having sum(w.idf) > 0.5
     order by rank desc, c.sop_id, c.n
     limit $2`,
    [terms, limit],
  );
}

export type Citation = { sectionId: number; ref: string; heading: string; cited: string };
export type AnswerPart = { text: string; citations: Citation[] };
export type Answer = {
  covered: boolean;
  parts: AnswerPart[];
  sources: Section[];
  costUsd: number;
};

const SYSTEM = `You answer questions from intake staff at an outpatient specialty clinic group, using only the SOP sections provided as documents.

Answer in two to four short sentences, in plain language, starting with what the staff member should do. Every statement must be supported by the provided sections. If they answer only part of the question, answer that part and leave the rest out. Do not talk about the sections, documents or citations themselves. If the sections do not answer the question at all, reply with exactly: NOT_COVERED

Never give clinical advice, even if asked. If the question is clinical, say that it goes to Nurse Triage and cite the section that says so, if one is provided.`;

const client = new Anthropic();

export async function ask(question: string): Promise<Answer> {
  const sources = await search(question);
  // Nothing retrieved means nothing to ground an answer in: say so without calling the model.
  if (sources.length === 0) return { covered: false, parts: [], sources, costUsd: 0 };

  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          ...sources.map((s) => ({
            type: "document" as const,
            source: { type: "text" as const, media_type: "text/plain" as const, data: s.body },
            title: `${s.sop_id} §${s.n} ${s.heading}`,
            citations: { enabled: true },
          })),
          { type: "text" as const, text: question },
        ],
      },
    ],
  });

  const u = response.usage;
  const costUsd = costOf(u.input_tokens, u.cache_creation_input_tokens ?? 0, u.cache_read_input_tokens ?? 0, u.output_tokens);

  if (response.stop_reason === "refusal") return { covered: false, parts: [], sources, costUsd };

  const parts: AnswerPart[] = [];
  for (const block of response.content) {
    if (block.type !== "text") continue;
    const citations: Citation[] = [];
    for (const c of block.citations ?? []) {
      if (c.type !== "char_location") continue;
      const s = sources[c.document_index];
      if (!s) continue;
      const ref = `${s.sop_id} §${s.n}`;
      const same = citations.find((x) => x.ref === ref);
      // Two citations of one section in a sentence show as one chip; both passages still get highlighted.
      if (same) same.cited += `\u0000${c.cited_text}`;
      else citations.push({ sectionId: s.id, ref, heading: s.heading, cited: c.cited_text });
    }
    parts.push({ text: block.text, citations });
  }

  const text = parts.map((p) => p.text).join("").trim();
  const cited = parts.some((p) => p.citations.length > 0);
  // An answer with no citation is not grounded, so it is not shown as one.
  if (text === "NOT_COVERED" || text.includes("NOT_COVERED") || !cited) {
    return { covered: false, parts: [], sources, costUsd };
  }
  return { covered: true, parts, sources, costUsd };
}
