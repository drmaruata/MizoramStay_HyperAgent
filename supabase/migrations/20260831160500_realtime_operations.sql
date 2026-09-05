-- Phase 4 realtime and scheduled-operation foundations.
-- Realtime only exposes tables whose SELECT policies already constrain each authenticated user.

create table public.scheduled_job_runs (
  id bigint generated always as identity primary key,
  job_name text not null check (char_length(btrim(job_name)) between 1 and 120),
  invocation_key text not null check (char_length(btrim(invocation_key)) between 1 and 255),
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed')),
  items_processed integer not null default 0 check (items_processed >= 0),
  error_summary text check (error_summary is null or char_length(error_summary) <= 1000),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (job_name, invocation_key),
  check (finished_at is null or finished_at >= started_at),
  check (
    (status = 'running' and finished_at is null)
    or (status in ('succeeded', 'failed') and finished_at is not null)
  )
);

create index scheduled_job_runs_job_started_idx
  on public.scheduled_job_runs (job_name, started_at desc);
create index scheduled_job_runs_failures_idx
  on public.scheduled_job_runs (started_at desc)
  where status = 'failed';

comment on table public.scheduled_job_runs is
  'Service-worker audit trail for scheduled invocations. Store only sanitized counts and diagnostics; never credentials, authorization headers, provider payloads, or customer data.';
comment on column public.scheduled_job_runs.invocation_key is
  'Non-secret scheduler or worker invocation identifier used as an idempotency fence.';
comment on column public.scheduled_job_runs.metadata is
  'Non-sensitive operational metadata only; secrets and request/provider payloads are prohibited.';
comment on column public.scheduled_job_runs.error_summary is
  'Sanitized failure summary only; omit secrets, provider payloads, and customer data.';

alter table public.scheduled_job_runs enable row level security;

create policy scheduled_job_runs_admin_read
  on public.scheduled_job_runs for select to authenticated
  using (public.is_admin());

revoke all on table public.scheduled_job_runs from public, anon, authenticated;
grant select on table public.scheduled_job_runs to authenticated;
grant all on table public.scheduled_job_runs to service_role;

-- supabase_realtime normally exists in hosted and local Supabase. Create it only when a
-- minimal PostgreSQL test environment has not provisioned the standard publication yet.
do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end
$$;

-- PostgreSQL does not support ALTER PUBLICATION ... ADD TABLE IF NOT EXISTS. Consult the
-- publication catalog first so migration replay and environments with preconfigured tables
-- remain safe. Realtime applies each table's RLS SELECT policy before delivering row changes.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'bookings',
    'verification_requests',
    'support_cases',
    'notification_outbox'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      execute format(
        'alter publication supabase_realtime add table %I.%I',
        'public',
        v_table
      );
    end if;
  end loop;
end
$$;

-- Recommended external worker cadence (documentation only; no schedules or commands are
-- installed here):
--   * release-expired-holds: every minute, because booking holds expire on minute-scale SLAs.
--   * send-notification: every minute, with bounded batches and worker-owned retry/backoff.
--   * process-payouts: every five minutes, with provider idempotency keys and bounded batches.
--   * complete-stays: hourly shortly after the hour; the RPC is lock-safe and idempotent.
-- Workers should authenticate scheduler requests with CRON_SECRET, use the service role only
-- inside the Edge Function, and record a sanitized scheduled_job_runs row per invocation.
-- Keep function URLs and credentials in the deployment secret store (or Supabase Vault when
-- pg_cron/pg_net is deliberately adopted); never persist plaintext secrets or cron commands in
-- application tables or migrations.
