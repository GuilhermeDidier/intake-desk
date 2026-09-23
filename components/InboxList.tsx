import Link from "next/link";
import s from "./InboxList.module.css";

export type InboxEntry = {
  id: number;
  sender: string;
  channel: "fax" | "portal" | "email";
  receivedAt: string;
  label: string;
  patient: string | null;
  status: "escalated" | "attention" | "ready" | "new" | "routed";
  queue: string | null;
};

const GROUPS: { status: InboxEntry["status"]; title: string; hint: string }[] = [
  { status: "escalated", title: "For a nurse", hint: "Clinical content, same day" },
  { status: "attention", title: "Needs a look", hint: "A check failed or a rule applies" },
  { status: "ready", title: "Ready to route", hint: "Every check passed" },
  { status: "new", title: "Waiting for the assistant", hint: "" },
  { status: "routed", title: "Routed", hint: "" },
];

const CHANNEL = { fax: "Fax", portal: "Portal", email: "Email" };

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });

export function InboxList({ items, selectedId }: { items: InboxEntry[]; selectedId: number | null }) {
  return (
    <div className={s.list}>
      {GROUPS.map((g) => {
        const group = items.filter((i) => i.status === g.status);
        if (group.length === 0) return null;
        return (
          <section key={g.status} className={s.group} data-status={g.status}>
            <h2>
              <span className={s.swatch} aria-hidden />
              {g.title}
              <span className={s.count}>{group.length}</span>
            </h2>
            <ul>
              {group.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/?doc=${i.id}`}
                    className={i.id === selectedId ? `${s.item} ${s.selected}` : s.item}
                    aria-current={i.id === selectedId ? "true" : undefined}
                    scroll={false}
                  >
                    <span className={s.row}>
                      <span className={s.type}>{i.label}</span>
                      <span className={s.time}>{time(i.receivedAt)}</span>
                    </span>
                    <span className={s.patient}>{i.patient ?? i.sender}</span>
                    <span className={s.meta}>
                      {i.patient ? `${CHANNEL[i.channel]} · ${i.sender}` : `${CHANNEL[i.channel]} · no patient identified`}
                    </span>
                    {i.queue && (
                      <span className={s.queue}>
                        {i.status === "routed" ? "In" : "To"} {i.queue}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
