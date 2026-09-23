"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideAction, planNextSteps } from "@/app/actions";
import { describeAction } from "@/lib/agent-rules";
import s from "./NextSteps.module.css";

export type AgentData = {
  runId: number;
  summary: string;
  steps: { tool: string; input: Record<string, unknown>; output: string }[];
  costUsd: number;
  latencyMs: number;
  actions: {
    id: number;
    seq: number;
    tool: string;
    input: Record<string, unknown>;
    status: "proposed" | "done" | "dismissed" | "failed";
    result: Record<string, unknown> | null;
    decidedBy: string | null;
  }[];
} | null;

function stepLine(step: { tool: string; input: Record<string, unknown>; output: string }): { text: string; blocked: boolean } {
  if (step.output.startsWith("rejected: ")) {
    return { text: `Tried to ${describeAction(step.tool, step.input).toLowerCase()}. Blocked: ${step.output.slice(10)}`, blocked: true };
  }
  switch (step.tool) {
    case "find_patient":
      return { text: `Looked up ${step.input.name}, ${step.input.dob}: ${step.output === "no match" ? "not on file" : step.output}`, blocked: false };
    case "list_patient_tasks":
      return { text: `Checked open tasks for ${step.input.patient_id}: ${step.output}`, blocked: false };
    default:
      return { text: step.tool, blocked: false };
  }
}

function resultLine(r: Record<string, unknown> | null): string {
  if (!r) return "";
  if (r.error) return String(r.error);
  if (r.task_id) return `task #${r.task_id}`;
  if (r.message_id) return `fax #${r.message_id} queued`;
  if (r.patient_id) return String(r.patient_id);
  return "";
}

export function NextSteps({
  documentId,
  agent,
  canPlan,
  canApprove,
  blockedReason,
}: {
  documentId: number;
  agent: AgentData;
  canPlan: boolean;
  canApprove: boolean;
  blockedReason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [openFax, setOpenFax] = useState<number | null>(null);

  const run = (key: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string) =>
    start(async () => {
      setBusy(key);
      setMessage(null);
      const r = await fn();
      setMessage(r.ok ? { tone: "ok", text: done } : { tone: "error", text: r.error });
      setBusy(null);
      router.refresh();
    });

  return (
    <section className={s.wrap} aria-labelledby="next-steps">
      <h3 id="next-steps" className={s.h3}>Next steps</h3>

      {blockedReason ? (
        <p className={s.lede}>{blockedReason}</p>
      ) : !agent ? (
        <>
          <p className={s.lede}>
            The assistant can look the patient up and propose the follow-up work the SOPs call for. It only sees the verified fields,
            and nothing runs until you approve it.
          </p>
          {canPlan && (
            <button className={s.plan} disabled={pending} onClick={() => run("plan", () => planNextSteps(documentId), "Plan ready.")}>
              {busy === "plan" ? "Planning… (15 to 60 seconds)" : "Plan next steps"}
            </button>
          )}
        </>
      ) : (
        <>
          <p className={s.summary}>{agent.summary}</p>

          {agent.steps.length > 0 && (
            <ul className={s.trace} aria-label="What the assistant checked">
              {agent.steps.map((st, i) => {
                const line = stepLine(st);
                return (
                  <li key={i} className={line.blocked ? s.blocked : undefined}>
                    {line.text}
                  </li>
                );
              })}
            </ul>
          )}

          {agent.actions.length === 0 ? (
            <p className={s.none}>No follow-up actions proposed.</p>
          ) : (
            <ol className={s.actions}>
              {agent.actions.map((a) => {
                const reason = String(a.input.reason ?? "");
                const sop = String(a.input.sop ?? "");
                return (
                  <li key={a.id} className={s.action} data-status={a.status}>
                    <p className={s.what}>
                      <span className={s.seq}>{a.seq}</span> {describeAction(a.tool, a.input)}
                    </p>
                    {a.tool === "create_task" && a.input.due_on ? <p className={s.meta}>Due {String(a.input.due_on)}</p> : null}
                    <p className={s.why}>
                      {reason} <a className={s.sop} href={`/ask#${sop.replace(/\s§/, "-")}`}>{sop}</a>
                    </p>
                    {a.tool === "send_fax" && (
                      <>
                        <button type="button" className={s.toggle} onClick={() => setOpenFax(openFax === a.id ? null : a.id)}>
                          {openFax === a.id ? "Hide the fax" : "Read the fax"}
                        </button>
                        {openFax === a.id && <pre className={s.fax}>{String(a.input.body)}</pre>}
                      </>
                    )}
                    {a.status === "proposed" && canApprove && (
                      <div className={s.buttons}>
                        <button
                          className={s.approve}
                          disabled={pending}
                          onClick={() => run(`a${a.id}`, () => decideAction(a.id, "approve"), `Done: ${describeAction(a.tool, a.input)}.`)}
                        >
                          {busy === `a${a.id}` ? "Running…" : "Approve and run"}
                        </button>
                        <button className={s.dismiss} disabled={pending} onClick={() => run(`d${a.id}`, () => decideAction(a.id, "dismiss"), "Dismissed.")}>
                          Dismiss
                        </button>
                      </div>
                    )}
                    {a.status === "proposed" && !canApprove && <p className={s.meta}>Waiting for an intake coordinator to approve.</p>}
                    {a.status === "done" && (
                      <p className={`${s.receipt} pen`}>
                        Done by {a.decidedBy} · {resultLine(a.result)}
                      </p>
                    )}
                    {a.status === "dismissed" && <p className={s.meta}>Dismissed by {a.decidedBy}</p>}
                    {a.status === "failed" && <p className={s.failed}>Not run: {resultLine(a.result)}</p>}
                  </li>
                );
              })}
            </ol>
          )}

          <p className={s.foot}>
            Planned in {(agent.latencyMs / 1000).toFixed(1)} s · ${agent.costUsd.toFixed(3)}
            {canPlan && (
              <>
                {" · "}
                <button type="button" className={s.again} disabled={pending} onClick={() => run("plan", () => planNextSteps(documentId), "New plan ready.")}>
                  {busy === "plan" ? "Planning…" : "Plan again"}
                </button>
              </>
            )}
          </p>
        </>
      )}
      <p className={message?.tone === "error" ? s.error : s.ok} role="status" aria-live="polite">
        {message?.text}
      </p>
    </section>
  );
}
