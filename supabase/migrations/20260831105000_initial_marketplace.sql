-- MizoramStay marketplace baseline. Apply with the Supabase migration runner.

create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.app_role as enum ('tourist', 'host', 'admin');
create type public.property_status as enum ('draft', 'published', 'archived');
create type public.booking_status as enum ('hold', 'confirmed', 'cancelled', 'expired', 'completed');
create type public.payment_status as enum ('pending', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');
create type public.document_status as enum ('pending', 'approved', 'rejected', 'expired');
create type public.media_kind as enum ('image', 'video');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'tourist',
  display_name text not null check (char_length(trim(display_name)) between 1 and 120),
  phone text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.host_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  legal_name text not null check (char_length(trim(legal_name)) between 1 and 200),
  business_name text,
  tax_identifier text,
  payout_account_ref text,
  verification_status public.document_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.destinations (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null,
  state text not null default 'Mizoram',
  country_code char(2) not null default 'IN' check (country_code ~ '^[A-Z]{2}$'),
  description text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  host_id uuid references public.profiles(id) on delete restrict,
  destination_id uuid not null references public.destinations(id) on delete restrict,
  slug citext not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null check (char_length(trim(name)) between 2 and 180),
  summary text,
  description text,
  address_line1 text not null,
  address_line2 text,
  locality text,
  postal_code text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  check_in_time time not null default '14:00',
  check_out_time time not null default '11:00',
  status public.property_status not null default 'draft',
  published_at timestamptz,
  max_guests integer not null default 1 check (max_guests > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status <> 'published') or published_at is not null)
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  description text,
  capacity_adults integer not null check (capacity_adults > 0),
  capacity_children integer not null default 0 check (capacity_children >= 0),
  beds_description text,
  base_nightly_rate numeric(12,2) not null check (base_nightly_rate >= 0),
  currency_code char(3) not null default 'INR' check (currency_code ~ '^[A-Z]{3}$'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name),
  unique (id, property_id)
);

create table public.property_media (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  room_id uuid,
  foreign key (room_id, property_id) references public.rooms(id, property_id) on delete cascade,
  kind public.media_kind not null default 'image',
  storage_path text not null unique,
  alt_text text,
  sort_order integer not null default 0 check (sort_order >= 0),
  is_cover boolean not null default false,
  created_at timestamptz not null default now(),
  check (storage_path !~ '^https?://')
);
create unique index property_media_one_cover_per_property on public.property_media (property_id) where is_cover;

create table public.amenities (
  id uuid primary key default gen_random_uuid(),
  slug citext not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  name text not null unique,
  category text not null default 'general',
  icon_name text,
  created_at timestamptz not null default now()
);

create table public.property_amenities (
  property_id uuid not null references public.properties(id) on delete cascade,
  amenity_id uuid not null references public.amenities(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (property_id, amenity_id)
);

create table public.nightly_inventory (
  room_id uuid not null references public.rooms(id) on delete cascade,
  stay_date date not null,
  available_units integer not null check (available_units >= 0),
  nightly_rate numeric(12,2) not null check (nightly_rate >= 0),
  currency_code char(3) not null default 'INR' check (currency_code ~ '^[A-Z]{3}$'),
  minimum_nights integer not null default 1 check (minimum_nights > 0),
  closed_to_arrival boolean not null default false,
  closed_to_departure boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (room_id, stay_date)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references public.profiles(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  status public.booking_status not null default 'hold',
  check_in date not null,
  check_out date not null,
  guest_count integer not null check (guest_count > 0),
  contact_name text not null,
  contact_email citext not null,
  contact_phone text,
  currency_code char(3) not null default 'INR' check (currency_code ~ '^[A-Z]{3}$'),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  taxes numeric(12,2) not null default 0 check (taxes >= 0),
  total_amount numeric(12,2) not null default 0 check (total_amount >= 0),
  hold_expires_at timestamptz,
  idempotency_key uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (check_out > check_in),
  check ((status = 'hold') = (hold_expires_at is not null)),
  unique (guest_id, idempotency_key)
);

create table public.booking_items (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete restrict,
  quantity integer not null default 1 check (quantity > 0),
  nightly_rate numeric(12,2) not null check (nightly_rate >= 0),
  nights integer not null check (nights > 0),
  line_total numeric(12,2) not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (booking_id, room_id)
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  provider text not null,
  provider_payment_id text not null,
  status public.payment_status not null default 'pending',
  amount numeric(12,2) not null check (amount >= 0),
  currency_code char(3) not null check (currency_code ~ '^[A-Z]{3}$'),
  provider_payload jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create table public.property_documents (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  document_type text not null,
  storage_path text not null unique,
  status public.document_status not null default 'pending',
  reviewer_id uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  expires_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path !~ '^https?://')
);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  guest_id uuid not null references public.profiles(id) on delete restrict,
  property_id uuid not null references public.properties(id) on delete restrict,
  rating smallint not null check (rating between 1 and 5),
  title text,
  body text,
  is_published boolean not null default false,
  host_response text,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  entity_type text not null,
  entity_id uuid,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index properties_destination_published_idx on public.properties (destination_id, published_at desc) where status = 'published';
create index properties_host_idx on public.properties (host_id);
create index rooms_property_active_idx on public.rooms (property_id) where is_active;
create index property_media_property_sort_idx on public.property_media (property_id, sort_order);
create index inventory_room_date_idx on public.nightly_inventory (room_id, stay_date);
create index bookings_guest_created_idx on public.bookings (guest_id, created_at desc);
create index bookings_property_created_idx on public.bookings (property_id, created_at desc);
create index bookings_active_hold_idx on public.bookings (hold_expires_at) where status = 'hold';
create index booking_items_room_idx on public.booking_items (room_id);
create index payments_booking_idx on public.payments (booking_id);
create index documents_property_idx on public.property_documents (property_id);
create index reviews_property_published_idx on public.reviews (property_id, created_at desc) where is_published;
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_host()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'host');
$$;

create or replace function public.prevent_profile_role_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'only an administrator may change a profile role' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_role_immutable before update on public.profiles for each row execute function public.prevent_profile_role_change();
create trigger profiles_updated_at before update on public.profiles for each row execute function public.set_updated_at();
create trigger host_profiles_updated_at before update on public.host_profiles for each row execute function public.set_updated_at();
create trigger destinations_updated_at before update on public.destinations for each row execute function public.set_updated_at();
create trigger properties_updated_at before update on public.properties for each row execute function public.set_updated_at();
create trigger rooms_updated_at before update on public.rooms for each row execute function public.set_updated_at();
create trigger inventory_updated_at before update on public.nightly_inventory for each row execute function public.set_updated_at();
create trigger bookings_updated_at before update on public.bookings for each row execute function public.set_updated_at();
create trigger payments_updated_at before update on public.payments for each row execute function public.set_updated_at();
create trigger documents_updated_at before update on public.property_documents for each row execute function public.set_updated_at();
create trigger reviews_updated_at before update on public.reviews for each row execute function public.set_updated_at();

-- Booking hold is deliberately the only guest write path for bookings/inventory.
create or replace function public.create_booking_hold(
  p_property_id uuid,
  p_room_id uuid,
  p_check_in date,
  p_check_out date,
  p_guest_count integer,
  p_contact_name text,
  p_contact_email citext,
  p_contact_phone text default null,
  p_idempotency_key uuid default gen_random_uuid()
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_guest_id uuid := auth.uid();
  v_booking public.bookings;
  v_nights integer := p_check_out - p_check_in;
  v_subtotal numeric(12,2);
  v_currency char(3);
  v_locked_rows integer;
begin
  if v_guest_id is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if p_check_out <= p_check_in or p_check_in < current_date or p_guest_count < 1 then
    raise exception 'invalid stay dates or guest count' using errcode = '22023';
  end if;

  -- Serialize concurrent retries sharing one guest/idempotency key.
  perform pg_advisory_xact_lock(hashtextextended(v_guest_id::text || ':' || p_idempotency_key::text, 0));
  select * into v_booking from public.bookings
  where guest_id = v_guest_id and idempotency_key = p_idempotency_key;
  if found then return v_booking; end if;

  if not exists (select 1 from public.properties where id = p_property_id and status = 'published') then
    raise exception 'property is not bookable' using errcode = '22023';
  end if;
  if not exists (select 1 from public.rooms where id = p_room_id and property_id = p_property_id and is_active) then
    raise exception 'room is not bookable' using errcode = '22023';
  end if;

  -- Locks every requested nightly row in a stable order before decrementing availability.
  perform 1 from public.nightly_inventory
  where room_id = p_room_id and stay_date >= p_check_in and stay_date < p_check_out
  order by stay_date for update;
  get diagnostics v_locked_rows = row_count;
  if v_locked_rows <> v_nights then raise exception 'inventory is incomplete for requested dates' using errcode = 'P0001'; end if;
  if exists (select 1 from public.nightly_inventory where room_id = p_room_id and stay_date >= p_check_in and stay_date < p_check_out and (available_units < 1 or closed_to_arrival or closed_to_departure)) then
    raise exception 'room is unavailable' using errcode = 'P0001';
  end if;

  select sum(nightly_rate), min(currency_code) into v_subtotal, v_currency
  from public.nightly_inventory where room_id = p_room_id and stay_date >= p_check_in and stay_date < p_check_out;
  update public.nightly_inventory set available_units = available_units - 1
  where room_id = p_room_id and stay_date >= p_check_in and stay_date < p_check_out;

  insert into public.bookings (guest_id, property_id, status, check_in, check_out, guest_count, contact_name, contact_email, contact_phone, currency_code, subtotal, total_amount, hold_expires_at, idempotency_key)
  values (v_guest_id, p_property_id, 'hold', p_check_in, p_check_out, p_guest_count, p_contact_name, p_contact_email, p_contact_phone, v_currency, v_subtotal, v_subtotal, now() + interval '15 minutes', p_idempotency_key)
  returning * into v_booking;
  insert into public.booking_items (booking_id, room_id, quantity, nightly_rate, nights, line_total)
  values (v_booking.id, p_room_id, 1, v_subtotal / v_nights, v_nights, v_subtotal);
  return v_booking;
end;
$$;

alter table public.profiles enable row level security;
alter table public.host_profiles enable row level security;
alter table public.destinations enable row level security;
alter table public.properties enable row level security;
alter table public.rooms enable row level security;
alter table public.property_media enable row level security;
alter table public.amenities enable row level security;
alter table public.property_amenities enable row level security;
alter table public.nightly_inventory enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_items enable row level security;
alter table public.payments enable row level security;
alter table public.property_documents enable row level security;
alter table public.reviews enable row level security;
alter table public.audit_logs enable row level security;

-- Profile and host identity.
create policy profiles_self_select on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_self_insert on public.profiles for insert to authenticated with check (id = auth.uid() and role = 'tourist');
create policy profiles_self_update on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy host_profiles_self_manage on public.host_profiles for all to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin());

-- Public catalog; hosts retain full access to their own records.
create policy destinations_public_read on public.destinations for select using (is_active or public.is_admin());
create policy destinations_admin_write on public.destinations for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy properties_catalog_or_owner on public.properties for select using (status = 'published' or host_id = auth.uid() or public.is_admin());
create policy properties_host_insert on public.properties for insert to authenticated with check ((host_id = auth.uid() and public.is_host()) or public.is_admin());
create policy properties_host_update on public.properties for update to authenticated using ((host_id = auth.uid() and public.is_host()) or public.is_admin()) with check ((host_id = auth.uid() and public.is_host()) or public.is_admin());
create policy properties_host_delete on public.properties for delete to authenticated using ((host_id = auth.uid() and public.is_host()) or public.is_admin());
create policy rooms_catalog_or_owner on public.rooms for select using (exists (select 1 from public.properties p where p.id = property_id and (p.status = 'published' or p.host_id = auth.uid() or public.is_admin())));
create policy rooms_host_write on public.rooms for all to authenticated using (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())));
create policy media_catalog_or_owner on public.property_media for select using (exists (select 1 from public.properties p where p.id = property_id and (p.status = 'published' or p.host_id = auth.uid() or public.is_admin())));
create policy media_host_write on public.property_media for all to authenticated using (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())));
create policy amenities_public_read on public.amenities for select using (true);
create policy amenities_admin_write on public.amenities for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy property_amenities_catalog_or_owner on public.property_amenities for select using (exists (select 1 from public.properties p where p.id = property_id and (p.status = 'published' or p.host_id = auth.uid() or public.is_admin())));
create policy property_amenities_host_write on public.property_amenities for all to authenticated using (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())));
create policy inventory_catalog_or_owner on public.nightly_inventory for select using (exists (select 1 from public.rooms r join public.properties p on p.id = r.property_id where r.id = room_id and (p.status = 'published' or p.host_id = auth.uid() or public.is_admin())));
create policy inventory_host_write on public.nightly_inventory for all to authenticated using (exists (select 1 from public.rooms r join public.properties p on p.id = r.property_id where r.id = room_id and (p.host_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.rooms r join public.properties p on p.id = r.property_id where r.id = room_id and (p.host_id = auth.uid() or public.is_admin())));

create policy bookings_guest_or_host_read on public.bookings for select to authenticated using (guest_id = auth.uid() or exists (select 1 from public.properties p where p.id = property_id and p.host_id = auth.uid()) or public.is_admin());
create policy bookings_guest_cancel on public.bookings for update to authenticated using (guest_id = auth.uid() and status in ('hold', 'confirmed')) with check (guest_id = auth.uid() and status = 'cancelled');
create policy booking_items_guest_or_host_read on public.booking_items for select to authenticated using (exists (select 1 from public.bookings b join public.properties p on p.id = b.property_id where b.id = booking_id and (b.guest_id = auth.uid() or p.host_id = auth.uid() or public.is_admin())));
create policy payments_guest_or_host_read on public.payments for select to authenticated using (exists (select 1 from public.bookings b join public.properties p on p.id = b.property_id where b.id = booking_id and (b.guest_id = auth.uid() or p.host_id = auth.uid() or public.is_admin())));
create policy documents_host_or_admin on public.property_documents for all to authenticated using (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())));
create policy reviews_public_or_owner on public.reviews for select using (is_published or guest_id = auth.uid() or exists (select 1 from public.properties p where p.id = property_id and p.host_id = auth.uid()) or public.is_admin());
create policy reviews_guest_insert on public.reviews for insert to authenticated with check (guest_id = auth.uid() and exists (select 1 from public.bookings b where b.id = booking_id and b.guest_id = auth.uid() and b.property_id = property_id and b.status = 'completed'));
create policy reviews_guest_update on public.reviews for update to authenticated using (guest_id = auth.uid()) with check (guest_id = auth.uid());
create policy reviews_host_response on public.reviews for update to authenticated using (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin()))) with check (exists (select 1 from public.properties p where p.id = property_id and (p.host_id = auth.uid() or public.is_admin())));
create policy audit_logs_admin_read on public.audit_logs for select to authenticated using (public.is_admin());

-- No anonymous execution; authenticated callers may invoke the guarded RPC only.
revoke all on function public.create_booking_hold(uuid, uuid, date, date, integer, text, citext, text, uuid) from public, anon;
grant execute on function public.create_booking_hold(uuid, uuid, date, date, integer, text, citext, text, uuid) to authenticated;
