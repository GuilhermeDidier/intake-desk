-- Run as the database owner before the migrations (scripts/setup-db.ts sets the password).
-- The app role sees only the intake schema; each migration grants it what it needs.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'intake_app') then
    create role intake_app login;
  end if;
end $$;

revoke all on schema public from intake_app;
grant usage on schema intake to intake_app;
alter role intake_app set search_path = intake;
