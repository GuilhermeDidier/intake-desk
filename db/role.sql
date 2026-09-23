-- Run once as the database owner. :'app_password' is supplied by scripts/setup-db.ts.
-- The app role sees only the intake schema, and can only append to the audit log.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'intake_app') then
    create role intake_app login;
  end if;
end $$;

revoke all on schema public from intake_app;
grant usage on schema intake to intake_app;
alter role intake_app set search_path = intake;

grant select, insert, update, delete on
  intake.sop_sections, intake.documents, intake.proposals,
  intake.field_edits, intake.queue_tasks, intake.usage_counter
  to intake_app;
grant select, insert on intake.audit_log to intake_app;
grant usage on all sequences in schema intake to intake_app;
