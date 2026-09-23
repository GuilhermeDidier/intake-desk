// The practice-management / CRM system the agent acts on. In this demo it is a set of
// tables behind this interface; in production the same interface wraps the vendor's API,
// and nothing in the agent changes.
import { CRM_PATIENTS } from "@/data/crm";
import { q } from "./db";

export type Patient = {
  id: string;
  name: string;
  dob: string;
  phone: string | null;
  plan: string | null;
  member_id: string | null;
  coverage_effective: string | null;
};

export interface Crm {
  findPatients(name: string, dob: string): Promise<Patient[]>;
  openTasks(patientId: string): Promise<{ id: number; queue: string; title: string; due_on: string | null }[]>;
  createPatient(p: { name: string; dob: string; phone: string | null }, actor: string): Promise<Patient>;
  updateCoverage(patientId: string, c: { plan: string; member_id: string; effective: string }): Promise<Patient>;
  createTask(
    t: { documentId: number; queue: string; title: string; dueOn: string | null; patientId: string | null },
    actor: string,
  ): Promise<{ id: number }>;
  queueMessage(
    m: { documentId: number; channel: "fax" | "email"; recipient: string; subject: string; body: string },
    actor: string,
  ): Promise<{ id: number }>;
}

const PATIENT_COLS = `id, name, to_char(dob, 'YYYY-MM-DD') as dob, phone, plan, member_id,
  to_char(coverage_effective, 'YYYY-MM-DD') as coverage_effective`;

export const crm: Crm = {
  async findPatients(name, dob) {
    // Date of birth must match exactly; the last name must appear. Enough to catch
    // "OKAFOR, MARIA" and "Maria Okafor" as the same person without fuzzy guessing.
    const words: string[] = name.toLowerCase().match(/[a-z]{2,}/g) ?? [];
    if (words.length === 0) return [];
    const rows = await q<Patient>(`select ${PATIENT_COLS} from intake.crm_patients where dob = $1::date`, [dob]);
    return rows.filter((p) => {
      const have = p.name.toLowerCase().match(/[a-z]{2,}/g) ?? [];
      return have.length > 0 && words.includes(have[have.length - 1]);
    });
  },

  async openTasks(patientId) {
    return q(
      `select id, queue, title, to_char(due_on, 'YYYY-MM-DD') as due_on from intake.queue_tasks
       where patient_id = $1 order by created_at desc limit 10`,
      [patientId],
    );
  },

  async createPatient(p, actor) {
    // New records number from P-20001 up. Two simultaneous approvals would pick the same id and the
    // second fails on the primary key, never a silent duplicate.
    const [row] = await q<Patient>(
      `insert into intake.crm_patients (id, name, dob, phone, created_by)
       select 'P-' || (coalesce(max(substring(id from 3)::int) filter (where id like 'P-2%'), 20000) + 1), $1, $2, $3, $4
       from intake.crm_patients
       returning ${PATIENT_COLS}`,
      [p.name, p.dob, p.phone, actor],
    );
    return row;
  },

  async updateCoverage(patientId, c) {
    const [row] = await q<Patient>(
      `update intake.crm_patients set plan = $2, member_id = $3, coverage_effective = $4
       where id = $1 returning ${PATIENT_COLS}`,
      [patientId, c.plan, c.member_id, c.effective],
    );
    if (!row) throw new Error(`No patient ${patientId}`);
    return row;
  },

  async createTask(t, actor) {
    const [row] = await q<{ id: number }>(
      `insert into intake.queue_tasks (document_id, queue, title, due_on, patient_id, origin, created_by)
       values ($1, $2, $3, $4, $5, 'agent', $6) returning id`,
      [t.documentId, t.queue, t.title, t.dueOn, t.patientId, actor],
    );
    return row;
  },

  async queueMessage(m, actor) {
    const [row] = await q<{ id: number }>(
      `insert into intake.outbound_messages (document_id, channel, recipient, subject, body, created_by)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [m.documentId, m.channel, m.recipient, m.subject, m.body, actor],
    );
    return row;
  },
};

/** Restores the simulated CRM to its starting state (demo reset and seeding). */
export async function resetCrm(query: typeof q = q) {
  await query(`delete from intake.crm_patients`);
  for (const p of CRM_PATIENTS) {
    await query(
      `insert into intake.crm_patients (id, name, dob, phone, plan, member_id, coverage_effective) values ($1, $2, $3, $4, $5, $6, $7)`,
      [p.id, p.name, p.dob, p.phone, p.plan, p.member_id, p.coverage_effective],
    );
  }
}
