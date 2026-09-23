import { cookies } from "next/headers";

// The demo has no login: a visitor picks who they are, and the server enforces
// what that person may do. In production the role comes from the identity provider.
export const ROLES = {
  coordinator: { label: "Intake coordinator", short: "Coordinator" },
  nurse: { label: "Triage nurse", short: "Nurse" },
  admin: { label: "Operations admin", short: "Admin" },
} as const;
export type Role = keyof typeof ROLES;

export async function currentRole(): Promise<Role> {
  const v = (await cookies()).get("role")?.value;
  return v === "nurse" || v === "admin" ? v : "coordinator";
}

export const can = {
  /** Approve routing of non-clinical documents. */
  route: (r: Role) => r === "coordinator" || r === "admin",
  /** Take ownership of documents escalated for clinical content. */
  routeClinical: (r: Role) => r === "nurse" || r === "admin",
  editFields: (r: Role) => r === "coordinator" || r === "admin",
  runModel: (r: Role) => r === "coordinator" || r === "admin",
  editKnowledge: (r: Role) => r === "admin",
};
