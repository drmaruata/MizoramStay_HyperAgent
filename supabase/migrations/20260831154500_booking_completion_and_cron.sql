-- Phase 3 closure: complete departed stays and hand their host payouts to the existing worker.
-- Provider calls remain outside PostgreSQL; this transaction only creates durable payout and
-- notification work while holding each booking row lock.

create index if not exists bookings_confirmed_checkout_idx
  on public.bookings (check_out, id)
  where status = 'confirmed';

-- Extend the booking workflow guard so even privileged table writes cannot bypass the atomic
-- completion workflow. `IS DISTINCT FROM` is intentional because an unset custom setting is NULL.
create or replace function public.guard_booking_inventory_release()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := current_setting('mizoramstay.booking_operation', true);
begin
  if new.inventory_released_at is distinct from old.inventory_released_at
     and v_operation is distinct from 'cancel'
     and v_operation is distinct from 'expire' then
    raise exception 'booking inventory must be released through the booking workflow' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and new.status = 'cancelled'
     and v_operation is distinct from 'cancel' then
    raise exception 'booking cancellation must use cancel_booking' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and new.status = 'expired'
     and v_operation is distinct from 'expire' then
    raise exception 'booking expiration must use release_expired_booking_holds' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and new.status = 'completed'
     and v_operation is distinct from 'complete' then
    raise exception 'booking completion must use complete_departed_bookings' using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.complete_departed_bookings()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_payout public.host_payouts;
  v_completed integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  for v_booking in
    select b.*
    from public.bookings b
    where b.status = 'confirmed'
      and b.check_out <= current_date
    order by b.check_out, b.id
    for update of b skip locked
  loop
    perform set_config('mizoramstay.booking_operation', 'complete', true);

    update public.bookings
    set status = 'completed',
        updated_at = now()
    where id = v_booking.id
      and status = 'confirmed';

    if not found then
      continue;
    end if;

    -- create_payout owns payment/refund locking, payout calculations, its durable unique fence,
    -- audit event, and the idempotent host payout notification.
    v_payout := public.create_payout(
      v_booking.id,
      'booking-payout:' || v_booking.id::text
    );

    -- The existing notification worker accepts explicit subject/text payloads before resolving
    -- a named template, so this does not require a coupled worker deployment.
    perform public.enqueue_notification(
      v_booking.guest_id,
      'email',
      'booking_completed_guest',
      jsonb_build_object(
        'booking_id', v_booking.id,
        'payout_id', v_payout.id,
        'subject', 'Your stay is complete',
        'text', 'Your stay for booking ' || v_booking.id::text || ' is complete. You can now leave a review.'
      ),
      'booking-completed:guest:' || v_booking.id::text,
      now()
    );

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      null,
      'booking',
      v_booking.id,
      'completed',
      jsonb_build_object('check_out', v_booking.check_out, 'payout_id', v_payout.id)
    );

    v_completed := v_completed + 1;
  end loop;

  return v_completed;
end;
$$;

-- Trigger functions remain internal-only.
revoke all on function public.guard_booking_inventory_release() from public, anon, authenticated, service_role;

-- Completion is callable only with a service-role JWT (the function also checks auth.role()).
revoke all on function public.complete_departed_bookings() from public, anon, authenticated;
grant execute on function public.complete_departed_bookings() to service_role;

-- Reassert the existing hold-release worker boundary. The compatibility wrapper delegates to
-- release_expired_booking_holds(), whose service-role check remains authoritative.
revoke all on function public.release_expired_booking_holds() from public, anon, authenticated;
grant execute on function public.release_expired_booking_holds() to service_role;
revoke all on function public.release_expired_holds() from public, anon, authenticated;
grant execute on function public.release_expired_holds() to service_role;

comment on function public.complete_departed_bookings() is
  'Service-role-only cron RPC: atomically completes confirmed departed bookings and creates idempotent payout/notification work.';

-- Optional scheduling guidance (documentation only; this migration does not create a schedule):
-- Prefer a trusted external scheduler that POSTs to the complete-stays Edge Function with
-- x-cron-secret. If pg_cron + pg_net are used, first store BOTH the function URL and CRON_SECRET
-- in Supabase Vault, then read them from vault.decrypted_secrets in the cron command. Never put a
-- service-role key or plaintext secret in a migration, cron.job.command, or request URL. Example:
--
-- select cron.schedule(
--   'complete-departed-stays-hourly',
--   '5 * * * *',
--   $cron$
--   select net.http_post(
--     url := (select decrypted_secret from vault.decrypted_secrets where name = 'complete_stays_url'),
--     headers := jsonb_build_object(
--       'content-type', 'application/json',
--       'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
--     ),
--     body := '{}'::jsonb
--   );
--   $cron$
-- );
