-- Phase 1 foundation: Auth profile lifecycle, Storage boundaries, payment idempotency.
-- Apply through the project migration workflow; never expose service-role credentials to clients.

create table public.payment_webhook_events (
  provider text not null check (provider = 'razorpay'),
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

alter table public.payment_webhook_events enable row level security;
revoke all on table public.payment_webhook_events from anon, authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, display_name, phone)
  values (
    new.id,
    'tourist',
    coalesce(nullif(left(trim(new.raw_user_meta_data ->> 'display_name'), 120), ''), split_part(coalesce(new.email, 'Traveller'), '@', 1)),
    nullif(left(trim(new.phone), 30), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Public approved listing media is readable through the CDN. Upload writes stay server-managed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'property-media',
  'property-media',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Sensitive host documents are never public; only owner and admin can access their object prefix.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'verification-documents',
  'verification-documents',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy property_media_host_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'property-media'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and public.is_host()
);

create policy property_media_host_update
on storage.objects for update to authenticated
using (bucket_id = 'property-media' and owner_id = (select auth.uid()::text))
with check (bucket_id = 'property-media' and owner_id = (select auth.uid()::text));

create policy property_media_host_delete
on storage.objects for delete to authenticated
using (bucket_id = 'property-media' and owner_id = (select auth.uid()::text));

create policy verification_documents_owner_read
on storage.objects for select to authenticated
using (
  bucket_id = 'verification-documents'
  and ((storage.foldername(name))[1] = (select auth.uid()::text) or public.is_admin())
);

create policy verification_documents_owner_upload
on storage.objects for insert to authenticated
with check (
  bucket_id = 'verification-documents'
  and (storage.foldername(name))[1] = (select auth.uid()::text)
  and public.is_host()
);

create policy verification_documents_owner_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'verification-documents'
  and ((storage.foldername(name))[1] = (select auth.uid()::text) or public.is_admin())
);

create or replace function public.confirm_razorpay_payment(
  p_booking_id uuid,
  p_order_id text,
  p_payment_id text,
  p_event_id text
) returns public.bookings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking public.bookings;
begin
  if not exists (select 1 from public.payment_webhook_events where provider = 'razorpay' and event_id = p_event_id) then
    raise exception 'unclaimed webhook event' using errcode = '42501';
  end if;

  select * into v_booking from public.bookings where id = p_booking_id for update;
  if not found then raise exception 'booking not found' using errcode = 'P0002'; end if;
  if v_booking.status in ('confirmed', 'completed') then return v_booking; end if;
  if v_booking.status <> 'hold' or v_booking.hold_expires_at < now() then raise exception 'booking hold is not valid' using errcode = 'P0001'; end if;

  update public.payments
  set provider_payment_id = p_payment_id,
      provider_payload = jsonb_build_object('order_id', p_order_id),
      status = 'captured',
      paid_at = now(),
      updated_at = now()
  where booking_id = p_booking_id and provider = 'razorpay';
  if not found then
    insert into public.payments (booking_id, provider, provider_payment_id, provider_payload, amount, currency_code, status, paid_at)
    values (p_booking_id, 'razorpay', p_payment_id, jsonb_build_object('order_id', p_order_id), v_booking.total_amount, v_booking.currency_code, 'captured', now());
  end if;

  update public.bookings set status = 'confirmed', hold_expires_at = null, updated_at = now() where id = p_booking_id returning * into v_booking;
  update public.payment_webhook_events set processed_at = now() where provider = 'razorpay' and event_id = p_event_id;
  return v_booking;
end;
$$;

revoke all on function public.confirm_razorpay_payment(uuid, text, text, text) from public, anon, authenticated;
