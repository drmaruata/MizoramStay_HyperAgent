-- Phase 3: atomic booking cancellation, refunds, payouts, and notification outbox.
-- All external provider calls remain outside the database; these records are the durable
-- idempotency and reconciliation boundary for workers using the service role.

create type public.cancellation_request_status as enum ('completed', 'rejected');
create type public.refund_status as enum ('requested', 'processing', 'completed', 'failed');
create type public.payout_status as enum ('pending', 'processing', 'paid', 'failed', 'cancelled');
create type public.notification_outbox_status as enum ('pending', 'processing', 'sent', 'failed', 'dead');

-- Keep legacy rows valid: provider order IDs and payment idempotency keys are nullable for
-- pre-Phase-3 data, while every new application/provider flow can populate them.
alter table public.payments
  add column provider_order_id text,
  add column idempotency_key text,
  add constraint payments_provider_order_id_length
    check (provider_order_id is null or char_length(provider_order_id) between 1 and 255),
  add constraint payments_idempotency_key_length
    check (idempotency_key is null or char_length(idempotency_key) between 1 and 255);

update public.payments
set provider_order_id = nullif(btrim(provider_payload ->> 'order_id'), '')
where provider_order_id is null
  and nullif(btrim(provider_payload ->> 'order_id'), '') is not null;

create unique index payments_provider_order_id_uidx
  on public.payments (provider, provider_order_id)
  where provider_order_id is not null;
create unique index payments_provider_idempotency_uidx
  on public.payments (provider, idempotency_key)
  where idempotency_key is not null;

-- A booking-level release marker is the durable exactly-once fence for restoring inventory.
alter table public.bookings
  add column inventory_released_at timestamptz,
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references public.profiles(id) on delete set null,
  add column cancellation_reason text,
  add constraint bookings_cancellation_reason_length
    check (cancellation_reason is null or char_length(cancellation_reason) between 10 and 500);

create table public.cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  actor_kind text not null check (actor_kind in ('guest', 'host', 'admin')),
  policy_code text not null check (char_length(policy_code) between 1 and 100),
  reason text not null check (char_length(reason) between 10 and 500),
  status public.cancellation_request_status not null default 'completed',
  refundable_amount numeric(12,2) not null default 0 check (refundable_amount >= 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requested_by, idempotency_key),
  check ((status = 'completed') = (completed_at is not null))
);

create unique index cancellation_requests_one_completed_per_booking_idx
  on public.cancellation_requests (booking_id)
  where status = 'completed';
create index cancellation_requests_booking_created_idx
  on public.cancellation_requests (booking_id, created_at desc);
create index cancellation_requests_actor_created_idx
  on public.cancellation_requests (requested_by, created_at desc);

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments(id) on delete restrict,
  booking_id uuid not null references public.bookings(id) on delete restrict,
  cancellation_request_id uuid references public.cancellation_requests(id) on delete restrict,
  provider text not null check (char_length(provider) between 1 and 100),
  provider_refund_id text,
  status public.refund_status not null default 'requested',
  amount numeric(12,2) not null check (amount > 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(reason) between 1 and 500),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  completion_idempotency_key text check (completion_idempotency_key is null or char_length(completion_idempotency_key) between 1 and 255),
  provider_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_payload) = 'object'),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 1000),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, idempotency_key),
  unique (cancellation_request_id, payment_id),
  check (provider_refund_id is null or char_length(provider_refund_id) between 1 and 255),
  check ((status = 'completed') = (completed_at is not null)),
  check (status <> 'failed' or failure_reason is not null)
);

create unique index refunds_provider_refund_id_uidx
  on public.refunds (provider, provider_refund_id)
  where provider_refund_id is not null;
create unique index refunds_completion_idempotency_uidx
  on public.refunds (provider, completion_idempotency_key)
  where completion_idempotency_key is not null;
create index refunds_booking_created_idx on public.refunds (booking_id, created_at desc);
create index refunds_payment_status_idx on public.refunds (payment_id, status);
create index refunds_work_queue_idx
  on public.refunds (requested_at, id)
  where status in ('requested', 'failed');

create table public.host_payouts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete restrict,
  host_id uuid not null references public.profiles(id) on delete restrict,
  provider text not null default 'razorpay' check (char_length(provider) between 1 and 100),
  provider_payout_id text,
  payout_account_ref text not null check (char_length(payout_account_ref) between 1 and 255),
  status public.payout_status not null default 'pending',
  gross_amount numeric(12,2) not null check (gross_amount >= 0),
  refund_amount numeric(12,2) not null default 0 check (refund_amount >= 0),
  platform_fee numeric(12,2) not null default 0 check (platform_fee >= 0),
  amount numeric(12,2) not null check (amount > 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  provider_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(provider_payload) = 'object'),
  failure_reason text check (failure_reason is null or char_length(failure_reason) <= 1000),
  available_at timestamptz not null default now(),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, idempotency_key),
  check (amount = gross_amount - refund_amount - platform_fee),
  check (refund_amount + platform_fee <= gross_amount),
  check ((status = 'paid') = (paid_at is not null)),
  check (status <> 'failed' or failure_reason is not null)
);

create unique index host_payouts_provider_payout_id_uidx
  on public.host_payouts (provider, provider_payout_id)
  where provider_payout_id is not null;
create index host_payouts_host_created_idx on public.host_payouts (host_id, created_at desc);
create index host_payouts_work_queue_idx
  on public.host_payouts (available_at, id)
  where status in ('pending', 'failed');

create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.profiles(id) on delete set null,
  channel text not null check (channel in ('email', 'sms', 'push', 'webhook')),
  template_key text not null check (char_length(template_key) between 1 and 120),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  status public.notification_outbox_status not null default 'pending',
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 255),
  available_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 100),
  locked_at timestamptz,
  locked_by text check (locked_by is null or char_length(locked_by) between 1 and 255),
  sent_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel, idempotency_key),
  check ((locked_at is null) = (locked_by is null)),
  check ((status = 'sent') = (sent_at is not null)),
  check (status <> 'processing' or locked_at is not null)
);

create index notification_outbox_work_queue_idx
  on public.notification_outbox (available_at, created_at, id)
  where status in ('pending', 'failed');
create index notification_outbox_recipient_created_idx
  on public.notification_outbox (recipient_id, created_at desc)
  where recipient_id is not null;

create trigger cancellation_requests_updated_at
  before update on public.cancellation_requests
  for each row execute function public.set_updated_at();
create trigger refunds_updated_at
  before update on public.refunds
  for each row execute function public.set_updated_at();
create trigger host_payouts_updated_at
  before update on public.host_payouts
  for each row execute function public.set_updated_at();
create trigger notification_outbox_updated_at
  before update on public.notification_outbox
  for each row execute function public.set_updated_at();

-- Append-only audit history for every operational status transition, including worker-owned
-- processing/failed/sent transitions that occur after these RPCs return.
create or replace function public.audit_operational_status_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      auth.uid(),
      tg_table_name,
      new.id,
      'status_changed',
      jsonb_build_object('from_status', old.status, 'to_status', new.status)
    );
  end if;
  return new;
end;
$$;

create trigger refunds_status_audit
  after update of status on public.refunds
  for each row execute function public.audit_operational_status_transition();
create trigger host_payouts_status_audit
  after update of status on public.host_payouts
  for each row execute function public.audit_operational_status_transition();
create trigger notification_outbox_status_audit
  after update of status on public.notification_outbox
  for each row execute function public.audit_operational_status_transition();
create trigger payments_status_audit
  after update of status on public.payments
  for each row execute function public.audit_operational_status_transition();
create trigger bookings_status_audit
  after update of status on public.bookings
  for each row execute function public.audit_operational_status_transition();

-- Preserve compatibility with the existing Razorpay confirmation RPC: extracting the order
-- ID from its provider payload means old callers need no signature or payload changes.
create or replace function public.set_payment_provider_order_id()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider_order_id is null then
    new.provider_order_id := nullif(btrim(new.provider_payload ->> 'order_id'), '');
  end if;
  return new;
end;
$$;

create trigger payments_set_provider_order_id
  before insert or update of provider_payload, provider_order_id on public.payments
  for each row execute function public.set_payment_provider_order_id();

-- Only workflow functions may mark inventory as released or transition a booking to the
-- terminal states that require inventory restoration.
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
     and v_operation not in ('cancel', 'expire') then
    raise exception 'booking inventory must be released through the booking workflow' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and new.status = 'cancelled'
     and v_operation <> 'cancel' then
    raise exception 'booking cancellation must use cancel_booking' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and new.status = 'expired'
     and v_operation <> 'expire' then
    raise exception 'booking expiration must use release_expired_booking_holds' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger bookings_inventory_release_guard
  before update of status, inventory_released_at on public.bookings
  for each row execute function public.guard_booking_inventory_release();

create or replace function public.restore_booking_inventory_once(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_item public.booking_items;
  v_updated integer;
  v_expected integer;
begin
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_booking.inventory_released_at is not null then
    return false;
  end if;
  if v_booking.status not in ('hold', 'confirmed') then
    raise exception 'booking inventory cannot be released from status %', v_booking.status using errcode = 'P0001';
  end if;

  for v_item in
    select *
    from public.booking_items
    where booking_id = p_booking_id
    order by room_id
  loop
    v_expected := v_booking.check_out - v_booking.check_in;
    update public.nightly_inventory
    set available_units = available_units + v_item.quantity,
        updated_at = now()
    where room_id = v_item.room_id
      and stay_date >= v_booking.check_in
      and stay_date < v_booking.check_out;
    get diagnostics v_updated = row_count;

    if v_updated <> v_expected then
      raise exception 'inventory is incomplete for booking item %', v_item.id using errcode = 'P0001';
    end if;
  end loop;

  if not found then
    raise exception 'booking has no items' using errcode = 'P0001';
  end if;

  update public.bookings
  set inventory_released_at = now(), updated_at = now()
  where id = p_booking_id;
  return true;
end;
$$;

create or replace function public.release_expired_booking_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_released integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  for v_booking in
    select *
    from public.bookings
    where status = 'hold'
      and hold_expires_at <= now()
    order by hold_expires_at, id
    for update skip locked
  loop
    perform set_config('mizoramstay.booking_operation', 'expire', true);
    perform public.restore_booking_inventory_once(v_booking.id);

    update public.bookings
    set status = 'expired', hold_expires_at = null, updated_at = now()
    where id = v_booking.id;

    insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
    values (
      null,
      'booking',
      v_booking.id,
      'hold_expired',
      jsonb_build_object('inventory_released', true, 'hold_expires_at', v_booking.hold_expires_at)
    );

    insert into public.notification_outbox (
      recipient_id, channel, template_key, payload, idempotency_key
    ) values (
      v_booking.guest_id,
      'email',
      'booking_hold_expired',
      jsonb_build_object('booking_id', v_booking.id),
      'booking-hold-expired:' || v_booking.id::text
    ) on conflict (channel, idempotency_key) do nothing;

    v_released := v_released + 1;
  end loop;

  return v_released;
end;
$$;

-- Compatibility entry point used by the existing scheduled Edge Function.
create or replace function public.release_expired_holds()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.release_expired_booking_holds();
$$;

create or replace function public.cancel_booking(
  p_booking_id uuid,
  p_reason text,
  p_idempotency_key text default null
)
returns public.cancellation_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role public.app_role;
  v_actor_kind text;
  v_policy_code text;
  v_key text;
  v_reason text := nullif(btrim(p_reason), '');
  v_booking public.bookings;
  v_host_id uuid;
  v_request public.cancellation_requests;
  v_payment public.payments;
  v_already_refunded numeric(12,2);
  v_refund_amount numeric(12,2);
  v_total_refund numeric(12,2) := 0;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if v_reason is null or char_length(v_reason) not between 10 and 500 then
    raise exception 'cancellation reason must be between 10 and 500 characters' using errcode = '22023';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'cancel-booking:' || p_booking_id::text);
  if char_length(v_key) > 255 then
    raise exception 'idempotency key is too long' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cancel:' || v_actor_id::text || ':' || v_key, 0));
  select * into v_request
  from public.cancellation_requests
  where requested_by = v_actor_id and idempotency_key = v_key;
  if found then
    if v_request.booking_id <> p_booking_id then
      raise exception 'idempotency key was already used for another booking' using errcode = '23505';
    end if;
    return v_request;
  end if;

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;

  select p.host_id into v_host_id
  from public.properties p
  where p.id = v_booking.property_id;
  select role into v_actor_role from public.profiles where id = v_actor_id;

  if v_actor_role = 'admin' then
    v_actor_kind := 'admin';
    v_policy_code := 'admin_override_full_refund';
  elsif v_host_id = v_actor_id then
    v_actor_kind := 'host';
    v_policy_code := 'host_cancellation_full_refund';
  elsif v_booking.guest_id = v_actor_id then
    v_actor_kind := 'guest';
    v_policy_code := 'guest_pre_arrival_full_refund';
  else
    raise exception 'booking access denied' using errcode = '42501';
  end if;

  if v_booking.status = 'cancelled' then
    select * into v_request
    from public.cancellation_requests
    where booking_id = p_booking_id and status = 'completed'
    order by created_at desc
    limit 1;
    if found then return v_request; end if;
    raise exception 'booking was cancelled outside the cancellation workflow' using errcode = 'P0001';
  end if;
  if v_booking.status not in ('hold', 'confirmed') then
    raise exception 'booking cannot be cancelled from status %', v_booking.status using errcode = 'P0001';
  end if;
  if v_actor_kind <> 'admin' and v_booking.check_in <= current_date then
    raise exception 'only an administrator may cancel on or after check-in' using errcode = '42501';
  end if;

  if v_booking.status = 'hold' then
    v_policy_code := v_actor_kind || '_hold_cancellation';
  end if;

  insert into public.cancellation_requests (
    booking_id, requested_by, actor_kind, policy_code, reason, status,
    refundable_amount, currency_code, idempotency_key, completed_at
  ) values (
    p_booking_id, v_actor_id, v_actor_kind, v_policy_code, v_reason, 'completed',
    0, v_booking.currency_code, v_key, now()
  ) returning * into v_request;

  -- Serialize payment/refund accounting in payment UUID order. Only money that has
  -- actually reached captured/partially-refunded state can produce a refund request.
  for v_payment in
    select *
    from public.payments
    where booking_id = p_booking_id
      and status in ('captured', 'partially_refunded')
    order by id
    for update
  loop
    select coalesce(sum(r.amount), 0)::numeric(12,2)
    into v_already_refunded
    from public.refunds r
    where r.payment_id = v_payment.id
      and r.status = 'completed';

    v_refund_amount := v_payment.amount - v_already_refunded;
    if v_refund_amount > 0 then
      insert into public.refunds (
        payment_id, booking_id, cancellation_request_id, provider, status,
        amount, currency_code, reason, idempotency_key
      ) values (
        v_payment.id, p_booking_id, v_request.id, v_payment.provider, 'requested',
        v_refund_amount, v_payment.currency_code, v_reason,
        'cancel:' || v_request.id::text || ':payment:' || v_payment.id::text
      );
      v_total_refund := v_total_refund + v_refund_amount;

      insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
      values (
        v_actor_id,
        'payment',
        v_payment.id,
        'refund_requested',
        jsonb_build_object(
          'booking_id', p_booking_id,
          'cancellation_request_id', v_request.id,
          'amount', v_refund_amount,
          'currency_code', v_payment.currency_code
        )
      );
    end if;
  end loop;

  update public.cancellation_requests
  set refundable_amount = v_total_refund
  where id = v_request.id
  returning * into v_request;

  perform set_config('mizoramstay.booking_operation', 'cancel', true);
  perform public.restore_booking_inventory_once(p_booking_id);

  update public.bookings
  set status = 'cancelled',
      hold_expires_at = null,
      cancelled_at = now(),
      cancelled_by = v_actor_id,
      cancellation_reason = v_reason,
      updated_at = now()
  where id = p_booking_id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'booking',
    p_booking_id,
    'cancelled',
    jsonb_build_object(
      'cancellation_request_id', v_request.id,
      'actor_kind', v_actor_kind,
      'policy_code', v_policy_code,
      'refund_amount', v_total_refund,
      'currency_code', v_booking.currency_code,
      'inventory_released', true
    )
  );

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    v_booking.guest_id,
    'email',
    'booking_cancelled_guest',
    jsonb_build_object(
      'booking_id', p_booking_id,
      'cancellation_request_id', v_request.id,
      'refund_amount', v_total_refund,
      'currency_code', v_booking.currency_code
    ),
    'booking-cancelled:guest:' || p_booking_id::text
  ) on conflict (channel, idempotency_key) do nothing;

  if v_host_id is not null then
    insert into public.notification_outbox (
      recipient_id, channel, template_key, payload, idempotency_key
    ) values (
      v_host_id,
      'email',
      'booking_cancelled_host',
      jsonb_build_object('booking_id', p_booking_id, 'cancellation_request_id', v_request.id),
      'booking-cancelled:host:' || p_booking_id::text
    ) on conflict (channel, idempotency_key) do nothing;
  end if;

  return v_request;
end;
$$;

create or replace function public.complete_refund(
  p_refund_id uuid,
  p_provider_refund_id text,
  p_idempotency_key text default null,
  p_provider_payload jsonb default '{}'::jsonb
)
returns public.refunds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_refund public.refunds;
  v_payment public.payments;
  v_booking public.bookings;
  v_payment_id uuid;
  v_booking_id uuid;
  v_key text;
  v_provider_refund_id text := nullif(btrim(p_provider_refund_id), '');
  v_completed_total numeric(12,2);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if v_provider_refund_id is null or char_length(v_provider_refund_id) > 255 then
    raise exception 'invalid provider refund id' using errcode = '22023';
  end if;
  if p_provider_payload is null or jsonb_typeof(p_provider_payload) <> 'object' then
    raise exception 'provider payload must be an object' using errcode = '22023';
  end if;

  select payment_id, booking_id into v_payment_id, v_booking_id
  from public.refunds
  where id = p_refund_id;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;

  -- Global lock order is booking -> payment -> refund.
  select * into v_booking from public.bookings where id = v_booking_id for update;
  select * into v_payment from public.payments where id = v_payment_id for update;
  select * into v_refund from public.refunds where id = p_refund_id for update;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'complete-refund:' || p_refund_id::text);
  if char_length(v_key) > 255 then
    raise exception 'idempotency key is too long' using errcode = '22023';
  end if;

  if v_refund.status = 'completed' then
    if v_refund.provider_refund_id <> v_provider_refund_id
       or v_refund.completion_idempotency_key is distinct from v_key then
      raise exception 'refund is already completed by another idempotent operation' using errcode = '23505';
    end if;
    return v_refund;
  end if;
  if exists (
    select 1 from public.refunds r
    where r.provider = v_refund.provider
      and r.completion_idempotency_key = v_key
      and r.id <> p_refund_id
  ) then
    raise exception 'completion idempotency key is already in use' using errcode = '23505';
  end if;
  if v_refund.status not in ('requested', 'processing', 'failed') then
    raise exception 'refund cannot be completed from status %', v_refund.status using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.refunds r
    where r.provider = v_refund.provider
      and r.provider_refund_id = v_provider_refund_id
      and r.id <> p_refund_id
  ) then
    raise exception 'provider refund id is already in use' using errcode = '23505';
  end if;

  update public.refunds
  set status = 'completed',
      provider_refund_id = v_provider_refund_id,
      completion_idempotency_key = v_key,
      provider_payload = p_provider_payload,
      failure_reason = null,
      completed_at = now(),
      updated_at = now()
  where id = p_refund_id
  returning * into v_refund;

  select coalesce(sum(r.amount), 0)::numeric(12,2)
  into v_completed_total
  from public.refunds r
  where r.payment_id = v_payment.id and r.status = 'completed';

  if v_completed_total > v_payment.amount then
    raise exception 'completed refunds exceed captured payment amount' using errcode = '23514';
  end if;

  update public.payments
  set status = case
        when v_completed_total = amount then 'refunded'::public.payment_status
        else 'partially_refunded'::public.payment_status
      end,
      updated_at = now()
  where id = v_payment.id;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    null,
    'refund',
    v_refund.id,
    'completed',
    jsonb_build_object(
      'booking_id', v_refund.booking_id,
      'payment_id', v_refund.payment_id,
      'provider_refund_id', v_provider_refund_id,
      'idempotency_key', v_key,
      'amount', v_refund.amount,
      'currency_code', v_refund.currency_code
    )
  );

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    v_booking.guest_id,
    'email',
    'refund_completed',
    jsonb_build_object(
      'booking_id', v_booking.id,
      'refund_id', v_refund.id,
      'amount', v_refund.amount,
      'currency_code', v_refund.currency_code
    ),
    'refund-completed:' || v_refund.id::text
  ) on conflict (channel, idempotency_key) do nothing;

  return v_refund;
end;
$$;

create or replace function public.create_payout(
  p_booking_id uuid,
  p_idempotency_key text default null
)
returns public.host_payouts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
  v_payout public.host_payouts;
  v_host_id uuid;
  v_payout_account_ref text;
  v_key text;
  v_gross numeric(12,2);
  v_refunded numeric(12,2);
  v_net numeric(12,2);
  v_currency char(3);
  v_currency_count integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'booking-payout:' || p_booking_id::text);
  if char_length(v_key) > 255 then
    raise exception 'idempotency key is too long' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('payout:' || v_key, 0));

  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;

  select * into v_payout from public.host_payouts where booking_id = p_booking_id for update;
  if found then return v_payout; end if;
  if exists (
    select 1 from public.host_payouts hp
    where hp.provider = 'razorpay' and hp.idempotency_key = v_key
  ) then
    raise exception 'idempotency key was already used for another payout' using errcode = '23505';
  end if;

  if v_booking.status <> 'completed' then
    raise exception 'payout requires a completed booking' using errcode = 'P0001';
  end if;
  if v_booking.check_out > current_date then
    raise exception 'payout cannot be created before check-out' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.refunds r
    where r.booking_id = p_booking_id and r.status in ('requested', 'processing', 'failed')
  ) then
    raise exception 'payout is blocked by an unresolved refund' using errcode = 'P0001';
  end if;

  select p.host_id, hp.payout_account_ref
  into v_host_id, v_payout_account_ref
  from public.properties p
  join public.host_profiles hp on hp.user_id = p.host_id
  where p.id = v_booking.property_id;
  if v_host_id is null or nullif(btrim(v_payout_account_ref), '') is null then
    raise exception 'host payout account is not configured' using errcode = 'P0001';
  end if;

  -- Lock all payment rows before computing the immutable payout basis.
  perform 1
  from public.payments
  where booking_id = p_booking_id
  order by id
  for update;

  select
    coalesce(sum(p.amount), 0)::numeric(12,2),
    min(p.currency_code),
    count(distinct p.currency_code)
  into v_gross, v_currency, v_currency_count
  from public.payments p
  where p.booking_id = p_booking_id
    and p.status in ('captured', 'partially_refunded', 'refunded');

  if v_gross <= 0 or v_currency_count <> 1 or v_currency <> v_booking.currency_code then
    raise exception 'booking has no consistent captured payment balance' using errcode = 'P0001';
  end if;

  select coalesce(sum(r.amount), 0)::numeric(12,2)
  into v_refunded
  from public.refunds r
  where r.booking_id = p_booking_id and r.status = 'completed';

  v_net := v_gross - v_refunded;
  if v_net <= 0 then
    raise exception 'booking has no positive payout balance' using errcode = 'P0001';
  end if;

  insert into public.host_payouts (
    booking_id, host_id, provider, payout_account_ref, status,
    gross_amount, refund_amount, platform_fee, amount, currency_code,
    idempotency_key, available_at
  ) values (
    p_booking_id, v_host_id, 'razorpay', v_payout_account_ref, 'pending',
    v_gross, v_refunded, 0, v_net, v_currency,
    v_key, now()
  ) returning * into v_payout;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    null,
    'host_payout',
    v_payout.id,
    'created',
    jsonb_build_object(
      'booking_id', p_booking_id,
      'host_id', v_host_id,
      'gross_amount', v_gross,
      'refund_amount', v_refunded,
      'amount', v_net,
      'currency_code', v_currency,
      'idempotency_key', v_key
    )
  );

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    v_host_id,
    'email',
    'host_payout_created',
    jsonb_build_object(
      'booking_id', p_booking_id,
      'payout_id', v_payout.id,
      'amount', v_net,
      'currency_code', v_currency
    ),
    'host-payout-created:' || v_payout.id::text
  ) on conflict (channel, idempotency_key) do nothing;

  return v_payout;
end;
$$;

create or replace function public.enqueue_notification(
  p_recipient_id uuid,
  p_channel text,
  p_template_key text,
  p_payload jsonb,
  p_idempotency_key text,
  p_available_at timestamptz default now()
)
returns public.notification_outbox
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_notification public.notification_outbox;
  v_channel text := lower(btrim(p_channel));
  v_template_key text := nullif(btrim(p_template_key), '');
  v_key text := nullif(btrim(p_idempotency_key), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if v_channel not in ('email', 'sms', 'push', 'webhook') then
    raise exception 'invalid notification channel' using errcode = '22023';
  end if;
  if v_template_key is null or char_length(v_template_key) > 120 then
    raise exception 'invalid notification template key' using errcode = '22023';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'notification payload must be an object' using errcode = '22023';
  end if;
  if v_key is null or char_length(v_key) > 255 then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_available_at is null then
    raise exception 'available_at is required' using errcode = '22023';
  end if;
  if p_recipient_id is not null and not exists (
    select 1 from public.profiles where id = p_recipient_id
  ) then
    raise exception 'notification recipient not found' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('notification:' || v_channel || ':' || v_key, 0));
  select * into v_notification
  from public.notification_outbox
  where channel = v_channel and idempotency_key = v_key;
  if found then
    if v_notification.recipient_id is distinct from p_recipient_id
       or v_notification.template_key <> v_template_key
       or v_notification.payload <> p_payload then
      raise exception 'idempotency key was reused with different notification content' using errcode = '23505';
    end if;
    return v_notification;
  end if;

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key, available_at
  ) values (
    p_recipient_id, v_channel, v_template_key, p_payload, v_key, p_available_at
  ) returning * into v_notification;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    null,
    'notification_outbox',
    v_notification.id,
    'enqueued',
    jsonb_build_object(
      'recipient_id', p_recipient_id,
      'channel', v_channel,
      'template_key', v_template_key,
      'idempotency_key', v_key
    )
  );

  return v_notification;
end;
$$;

alter table public.cancellation_requests enable row level security;
alter table public.refunds enable row level security;
alter table public.host_payouts enable row level security;
alter table public.notification_outbox enable row level security;

create policy cancellation_requests_parties_read
  on public.cancellation_requests for select to authenticated
  using (
    requested_by = (select auth.uid())
    or exists (
      select 1
      from public.bookings b
      join public.properties p on p.id = b.property_id
      where b.id = booking_id
        and (b.guest_id = (select auth.uid()) or p.host_id = (select auth.uid()))
    )
    or public.is_admin()
  );

create policy refunds_booking_parties_read
  on public.refunds for select to authenticated
  using (
    exists (
      select 1
      from public.bookings b
      join public.properties p on p.id = b.property_id
      where b.id = booking_id
        and (b.guest_id = (select auth.uid()) or p.host_id = (select auth.uid()))
    )
    or public.is_admin()
  );

create policy host_payouts_host_or_admin_read
  on public.host_payouts for select to authenticated
  using (host_id = (select auth.uid()) or public.is_admin());

create policy notification_outbox_admin_read
  on public.notification_outbox for select to authenticated
  using (public.is_admin());

-- Tables are read-only to eligible authenticated parties under RLS; all state changes are RPC-only.
revoke all on table public.cancellation_requests from anon, authenticated;
revoke all on table public.refunds from anon, authenticated;
revoke all on table public.host_payouts from anon, authenticated;
revoke all on table public.notification_outbox from anon, authenticated;
grant select on table public.cancellation_requests to authenticated;
grant select on table public.refunds to authenticated;
grant select on table public.host_payouts to authenticated;
grant select on table public.notification_outbox to authenticated;
grant all on table public.cancellation_requests to service_role;
grant all on table public.refunds to service_role;
grant all on table public.host_payouts to service_role;
grant all on table public.notification_outbox to service_role;

-- Remove the legacy direct-update cancellation path; cancellation now has one atomic entry point.
revoke update on table public.bookings from anon, authenticated;

revoke all on function public.audit_operational_status_transition() from public, anon, authenticated, service_role;
revoke all on function public.set_payment_provider_order_id() from public, anon, authenticated, service_role;
revoke all on function public.guard_booking_inventory_release() from public, anon, authenticated, service_role;
revoke all on function public.restore_booking_inventory_once(uuid) from public, anon, authenticated, service_role;

revoke all on function public.release_expired_booking_holds() from public, anon, authenticated;
grant execute on function public.release_expired_booking_holds() to service_role;
revoke all on function public.release_expired_holds() from public, anon, authenticated;
grant execute on function public.release_expired_holds() to service_role;

revoke all on function public.cancel_booking(uuid, text, text) from public, anon;
grant execute on function public.cancel_booking(uuid, text, text) to authenticated;

revoke all on function public.complete_refund(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.complete_refund(uuid, text, text, jsonb) to service_role;

revoke all on function public.create_payout(uuid, text) from public, anon, authenticated;
grant execute on function public.create_payout(uuid, text) to service_role;

revoke all on function public.enqueue_notification(uuid, text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_notification(uuid, text, text, jsonb, text, timestamptz) to service_role;
