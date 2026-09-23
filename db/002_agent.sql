-- Next-steps agent: the assistant looks things up on its own, but every action
-- that changes something waits for a person.

set search_path = intake;

-- Stand-in for the practice-management / CRM system the agent talks to.
create table if not exists crm_patients (
  id                 text primary key,
  name               text not null,
  dob                date not null,
  phone              text,
  plan               text,
  member_id          text,
  coverage_effective date,
  created_by         text not null default 'seed',
  created_at         timestamptz not null default now()
);

create table if not exists outbound_messages (
  id           bigserial primary key,
  document_id  bigint references documents(id) on delete cascade,
  channel      text not null check (channel in ('fax', 'email')),
  recipient    text not null,
  subject      text not null,
  body         text not null,
  status       text not null default 'queued',
  created_by   text not null,
  created_at   timestamptz not null default now()
);

alter table queue_tasks add column if not exists due_on date;
alter table queue_tasks add column if not exists origin text not null default 'routing';
alter table queue_tasks add column if not exists patient_id text;

-- Original files for documents that arrived as PDFs.
alter table documents add column if not exists original_pdf bytea;

create table if not exists agent_runs (
  id            bigserial primary key,
  document_id   bigint not null references documents(id) on delete cascade,
  model         text not null,
  prompt_version text not null,
  summary       text not null,
  steps         jsonb not null,        -- lookups the agent ran, in order
  input_tokens  int not null,
  output_tokens int not null,
  cost_usd      numeric(10, 5) not null,
  latency_ms    int not null,
  created_by    text not null,
  created_at    timestamptz not null default now()
);
create index if not exists agent_runs_doc on agent_runs (document_id, created_at desc);

create table if not exists agent_actions (
  id           bigserial primary key,
  run_id       bigint not null references agent_runs(id) on delete cascade,
  document_id  bigint not null references documents(id) on delete cascade,
  seq          int not null,
  tool         text not null,
  input        jsonb not null,
  status       text not null default 'proposed' check (status in ('proposed', 'done', 'dismissed', 'failed')),
  result       jsonb,
  decided_by   text,
  decided_at   timestamptz
);
create index if not exists agent_actions_run on agent_actions (run_id, seq);

grant select, insert, update, delete on
  intake.crm_patients, intake.outbound_messages, intake.agent_runs, intake.agent_actions
  to intake_app;
grant usage on all sequences in schema intake to intake_app;
