-- Intake Desk schema. Lives in its own schema; the app connects as a role
-- that can see nothing else in the database.

create schema if not exists intake;
set search_path = intake;

-- Knowledge: one row per SOP section. Editing a section inserts a new version;
-- old versions stay so every answer and routing can be traced to the text it used.
create table if not exists sop_sections (
  id          bigserial primary key,
  sop_id      text not null,
  sop_title   text not null,
  owner       text not null,
  n           int  not null,
  heading     text not null,
  body        text not null,
  version     int  not null default 1,
  is_current  boolean not null default true,
  edited_by   text not null default 'seed',
  created_at  timestamptz not null default now(),
  tsv         tsvector generated always as (
                setweight(to_tsvector('english', heading), 'A') ||
                setweight(to_tsvector('english', sop_title), 'B') ||
                setweight(to_tsvector('english', body), 'C')) stored
);
create unique index if not exists sop_sections_current on sop_sections (sop_id, n) where is_current;
create index if not exists sop_sections_tsv on sop_sections using gin (tsv);

create table if not exists documents (
  id           bigserial primary key,
  slug         text unique,
  channel      text not null check (channel in ('fax', 'portal', 'email')),
  sender       text not null,
  received_at  timestamptz not null,
  pages        int not null default 1,
  body         text not null,
  is_seed      boolean not null default false,
  -- new: waiting for the model; proposed: waiting for a person; closed: routed or returned
  state        text not null default 'new' check (state in ('new', 'proposed', 'closed')),
  created_at   timestamptz not null default now()
);

-- What the model returned, exactly, plus what it cost.
create table if not exists proposals (
  id              bigserial primary key,
  document_id     bigint not null references documents(id) on delete cascade,
  model           text not null,
  prompt_version  text not null,
  extraction      jsonb not null,
  input_tokens    int not null,
  output_tokens   int not null,
  cost_usd        numeric(10, 5) not null,
  latency_ms      int not null,
  created_at      timestamptz not null default now()
);
create index if not exists proposals_doc on proposals (document_id, created_at desc);

-- Values a person typed over the model's. Kept apart from the proposal so both survive.
create table if not exists field_edits (
  id           bigserial primary key,
  document_id  bigint not null references documents(id) on delete cascade,
  proposal_id  bigint not null references proposals(id) on delete cascade,
  field_key    text not null,
  value        text,
  actor        text not null,
  created_at   timestamptz not null default now()
);

-- The downstream system. In production this is the CRM / practice-management API.
create table if not exists queue_tasks (
  id           bigserial primary key,
  document_id  bigint not null references documents(id) on delete cascade,
  queue        text not null,
  title        text not null,
  tags         text[] not null default '{}',
  created_by   text not null,
  created_at   timestamptz not null default now()
);

-- Append-only. Details carry field names and ids, never field values:
-- the audit trail should not become a second copy of patient data.
create table if not exists audit_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  actor        text not null,
  event        text not null,
  document_id  bigint,
  detail       jsonb not null default '{}'
);
create index if not exists audit_log_doc on audit_log (document_id, at);

create or replace function audit_log_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_append_only();

-- Spend guard for the public demo: model calls per visitor per day.
create table if not exists usage_counter (
  bucket  text not null,
  day     date not null default current_date,
  n       int not null default 0,
  primary key (bucket, day)
);

-- What the app role may do. On audit_log it can only read and append.
grant select, insert, update, delete on
  intake.sop_sections, intake.documents, intake.proposals,
  intake.field_edits, intake.queue_tasks, intake.usage_counter
  to intake_app;
grant select, insert on intake.audit_log to intake_app;
grant usage on all sequences in schema intake to intake_app;
