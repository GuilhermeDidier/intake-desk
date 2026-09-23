"use client";

import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { askSops, editSection } from "@/app/actions";
import { locate } from "@/lib/checks";
import type { Answer } from "@/lib/knowledge";
import s from "./KnowledgeDesk.module.css";

export type SectionView = {
  id: number;
  sop_id: string;
  sop_title: string;
  owner: string;
  n: number;
  heading: string;
  body: string;
  version: number;
  edited_by: string;
  created_at: string;
};

const SUGGESTED = [
  "A referral came in without a member ID. What do I do?",
  "Can we send records to a patient's attorney?",
  "A patient mentioned chest pain in a portal message. What now?",
  "Where do staff park during the garage renovation?",
];

const anchor = (sop: string, n: number) => `${sop}-${n}`;

export function KnowledgeDesk({ sections, canEdit }: { sections: SectionView[]; canEdit: boolean }) {
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (text: string) => {
    setQuestion(text);
    start(async () => {
      setError(null);
      const r = await askSops(text);
      if (r.ok) {
        setAnswer(r.answer);
        setAsked(text);
      } else setError(r.error);
    });
  };

  // What to highlight in the library: every passage the answer cites, by section id.
  const cited = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const p of answer?.parts ?? []) for (const c of p.citations) m.set(c.sectionId, [...(m.get(c.sectionId) ?? []), ...c.cited.split("\u0000")]);
    return m;
  }, [answer]);
  const retrieved = useMemo(() => new Set(answer?.sources.map((x) => x.id) ?? []), [answer]);

  const bySop = useMemo(() => {
    const out: { sop: string; title: string; owner: string; items: SectionView[] }[] = [];
    for (const sec of sections) {
      const last = out[out.length - 1];
      if (last?.sop === sec.sop_id) last.items.push(sec);
      else out.push({ sop: sec.sop_id, title: sec.sop_title, owner: sec.owner, items: [sec] });
    }
    return out;
  }, [sections]);

  const jump = (sop: string, n: number) => {
    const el = document.getElementById(anchor(sop, n));
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    el?.classList.remove(s.flash);
    void el?.offsetWidth;
    el?.classList.add(s.flash);
  };

  return (
    <main className={s.wrap}>
      <section className={s.askCol}>
        <h1>Ask the SOPs</h1>
        <p className={s.lede}>
          Answers come only from the procedures on the right, and every answer cites the passages it rests on. If the procedures do
          not cover a question, the assistant says so instead of guessing.
        </p>
        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            if (question.trim()) submit(question);
          }}
        >
          <label htmlFor="q" className="sr-only">Your question</label>
          <textarea
            id="q"
            rows={3}
            value={question}
            maxLength={400}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (question.trim()) submit(question);
              }
            }}
            placeholder="What do I do when…"
          />
          <button type="submit" disabled={pending || question.trim().length < 8}>
            {pending ? "Looking it up…" : "Ask"}
          </button>
        </form>
        <ul className={s.suggested} aria-label="Example questions">
          {SUGGESTED.map((t) => (
            <li key={t}>
              <button type="button" disabled={pending} onClick={() => submit(t)}>
                {t}
              </button>
            </li>
          ))}
        </ul>

        {error && <p className={s.error} role="alert">{error}</p>}

        {answer && asked && (
          <article className={s.answer} aria-live="polite">
            <p className={s.askedLabel}>You asked</p>
            <p className={s.asked}>{asked}</p>
            {answer.covered ? (
              <p className={s.answerText}>
                {answer.parts.map((p, i) => (
                  <Fragment key={i}>
                    {p.text}
                    {p.citations.map((c, j) => (
                      <button key={j} type="button" className={s.cite} onClick={() => jump(c.ref.split(" §")[0], Number(c.ref.split("§")[1]))}>
                        {c.ref}
                      </button>
                    ))}
                  </Fragment>
                ))}
              </p>
            ) : (
              <div className={s.notCovered}>
                <p><strong>The SOPs don&apos;t cover this.</strong></p>
                <p>
                  {answer.sources.length === 0
                    ? "No procedure mentions these terms."
                    : `The closest sections (${answer.sources.map((x) => `${x.sop_id} §${x.n}`).join(", ")}) do not answer it.`}{" "}
                  Ask your supervisor, and consider adding it to the procedures.
                </p>
              </div>
            )}
            <p className={s.cost}>
              Searched {answer.sources.length} section{answer.sources.length === 1 ? "" : "s"}
              {answer.costUsd > 0 ? ` · $${answer.costUsd.toFixed(4)}` : " · no model call needed"}
            </p>
          </article>
        )}
      </section>

      <section className={s.library} aria-label="Standard operating procedures">
        <div className={s.libraryHead}>
          <h2>Procedures</h2>
          <p>{canEdit ? "You can edit sections. Each edit is a new version; old versions are kept." : "Operations admins can edit these."}</p>
        </div>
        {bySop.map((g) => (
          <div key={g.sop} className={s.sop}>
            <h3>
              <span className={s.sopId}>{g.sop}</span> {g.title}
              <span className={s.owner}>{g.owner}</span>
            </h3>
            {g.items.map((sec) => (
              <SectionBlock
                key={sec.id}
                section={sec}
                cited={cited.get(sec.id) ?? []}
                retrieved={retrieved.has(sec.id)}
                canEdit={canEdit}
              />
            ))}
          </div>
        ))}
      </section>
    </main>
  );
}

function SectionBlock({ section, cited, retrieved, canEdit }: { section: SectionView; cited: string[]; retrieved: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(section.body);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const pieces = useMemo(() => {
    const spans = cited
      .map((c) => locate(section.body, c))
      .filter((x): x is [number, number] => !!x)
      .sort((a, b) => a[0] - b[0]);
    const out: { text: string; hit: boolean }[] = [];
    let at = 0;
    for (const [a, b] of spans) {
      if (a < at) continue;
      if (a > at) out.push({ text: section.body.slice(at, a), hit: false });
      out.push({ text: section.body.slice(a, b), hit: true });
      at = b;
    }
    if (at < section.body.length) out.push({ text: section.body.slice(at), hit: false });
    return out;
  }, [cited, section.body]);

  return (
    <div id={anchor(section.sop_id, section.n)} className={`${s.section} ${retrieved ? s.retrieved : ""}`}>
      <p className={s.secHead}>
        <span className={s.secNum}>§{section.n}</span> {section.heading}
        {section.version > 1 && <span className={`${s.version} pen`}>v{section.version} · {section.edited_by}</span>}
      </p>
      {editing ? (
        <form
          className={s.editForm}
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await editSection(section.id, draft);
              if (r.ok) {
                setEditing(false);
                setError(null);
                router.refresh();
              } else setError(r.error);
            });
          }}
        >
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={5} aria-label={`Edit ${section.sop_id} §${section.n}`} />
          <div>
            <button type="submit" disabled={pending}>Save as v{section.version + 1}</button>
            <button type="button" onClick={() => { setEditing(false); setDraft(section.body); }}>Cancel</button>
          </div>
          {error && <p className={s.error}>{error}</p>}
        </form>
      ) : (
        <p className={s.body}>
          {pieces.map((p, i) => (p.hit ? <mark key={i} className="hl hl-blue">{p.text}</mark> : <Fragment key={i}>{p.text}</Fragment>))}
          {canEdit && (
            <button type="button" className={s.editBtn} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </p>
      )}
    </div>
  );
}
