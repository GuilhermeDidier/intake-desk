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
 * Terms are OR-ed and ranked, so a plain question still finds the right sections.
 * At a few dozen sections this is exact and free; past a few thousand, add pgvector
 * next to it and merge the two rankings.
 */
export async function search(question: string, limit = 4): Promise<Section[]> {
  const terms = (question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).slice(0, 24);
  if (terms.length === 0) return [];
  return q<Section>(
    `with query as (
       select to_tsquery('english', string_agg(plainto_tsquery('english', t)::text, ' | ')) as tsq
       from unnest($1::text[]) as t
       where plainto_tsquery('english', t)::text <> ''
     )
     select s.id, s.sop_id, s.sop_title, s.n, s.heading, s.body, s.version,
            ts_rank_cd(s.tsv, query.tsq) as rank
     from intake.sop_sections s, query
     where s.is_current and query.tsq is not null and s.tsv @@ query.tsq
     order by rank desc, s.sop_id, s.n
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

Answer in two to four short sentences, in plain language, starting with what the staff member should do. Every statement must be supported by the provided sections. If the sections do not answer the question, reply with exactly: NOT_COVERED

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
