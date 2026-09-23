"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { resetDemo, setRole } from "@/app/actions";
import type { Role } from "@/lib/roles";
import s from "./Header.module.css";

const ROLE_OPTIONS: { value: Role; label: string; hint: string }[] = [
  { value: "coordinator", label: "Intake coordinator", hint: "Corrects fields and routes documents" },
  { value: "nurse", label: "Triage nurse", hint: "Takes documents with clinical content" },
  { value: "admin", label: "Operations admin", hint: "Everything, plus editing SOPs" },
];

const NAV = [
  { href: "/", label: "Inbox" },
  { href: "/ask", label: "Ask the SOPs" },
  { href: "/audit", label: "Audit trail" },
];

export function Header({ role }: { role: Role }) {
  const path = usePathname();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  return (
    <header className={s.bar}>
      <Link href="/" className={s.brand}>
        <span className={s.mark} aria-hidden />
        <span>
          <strong>Intake Desk</strong>
          <span className={s.org}>Kestrel Valley Specialty Care</span>
        </span>
      </Link>

      <nav className={s.nav} aria-label="Main">
        {NAV.map((n) => {
          const active = n.href === "/" ? path === "/" || path.startsWith("/new") : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} className={active ? s.active : undefined} aria-current={active ? "page" : undefined}>
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className={s.tools}>
        <span className={s.synthetic} title="Every patient, provider and number in this demo is invented.">
          Synthetic data
        </span>
        <label className={s.role}>
          <span className={s.roleLabel}>Working as</span>
          <select
            value={role}
            disabled={pending}
            onChange={(e) => start(async () => {
              await setRole(e.target.value as Role);
              router.refresh();
            })}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value} title={r.hint}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        {confirming ? (
          <span className={s.confirm}>
            Clear routings and edits?
            <button
              type="button"
              disabled={pending}
              onClick={() => start(async () => {
                await resetDemo();
                setConfirming(false);
                router.push("/");
                router.refresh();
              })}
            >
              Reset
            </button>
            <button type="button" className={s.ghost} onClick={() => setConfirming(false)}>
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className={s.ghost} onClick={() => setConfirming(true)}>
            Reset demo
          </button>
        )}
      </div>
    </header>
  );
}
