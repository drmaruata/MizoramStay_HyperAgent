-- Phase 4: moderated guest reviews and owner responses.
-- Reviews are deliberately unpublished until an administrator approves them.

create type public.review_moderation_status as enum ('pending', 'approved', 'rejected');

alter table public.reviews
  add column moderation_status public.review_moderation_status,
  add column moderation_notes text,
  add column moderated_at timestamptz,
  add column moderated_by uuid references public.profiles(id) on delete set null;

-- Preserve any legacy publication decision while moving to an explicit moderation state.
update public.reviews
set moderation_status = case
      when is_published then 'approved'::public.review_moderation_status
      else 'pending'::public.review_moderation_status
    end,
    moderated_at = case when is_published then coalesce(updated_at, created_at, now()) else null end,
    body = coalesce(nullif(btrim(body), ''), 'Legacy review'),
    host_response = nullif(btrim(host_response), ''),
    responded_at = case
      when nullif(btrim(host_response), '') is not null then coalesce(responded_at, updated_at, created_at, now())
      else null
    end;

alter table public.reviews
  alter column moderation_status set default 'pending',
  alter column moderation_status set not null,
  alter column body set not null,
  add constraint reviews_title_length
    check (title is null or char_length(btrim(title)) between 1 and 120),
  add constraint reviews_body_length
    check (char_length(btrim(body)) between 10 and 2000),
  add constraint reviews_host_response_length
    check (host_response is null or char_length(btrim(host_response)) between 2 and 2000),
  add constraint reviews_moderation_notes_length
    check (moderation_notes is null or char_length(btrim(moderation_notes)) between 1 and 2000),
  add constraint reviews_publication_matches_moderation
    check (is_published = (moderation_status = 'approved')),
  add constraint reviews_response_timestamp_consistency
    check ((host_response is null) = (responded_at is null)),
  add constraint reviews_moderation_timestamp_consistency
    check (
      (moderation_status = 'pending' and moderated_at is null and moderated_by is null)
      or (moderation_status in ('approved', 'rejected') and moderated_at is not null)
    );

create index reviews_guest_created_idx
  on public.reviews (guest_id, created_at desc);
create index reviews_host_response_queue_idx
  on public.reviews (property_id, created_at desc)
  where moderation_status = 'approved' and host_response is null;
create index reviews_moderation_queue_idx
  on public.reviews (created_at, id)
  where moderation_status = 'pending';

comment on column public.reviews.is_published is
  'Derived by the review moderation workflow. New reviews default to false and become public only after administrator approval.';
comment on column public.reviews.moderation_status is
  'Internal marketplace moderation state; pending reviews are visible only to their guest, property owner, and administrators.';

-- Direct writes would let callers mutate ownership, ratings, or moderation fields. All user and
-- administrator writes therefore enter through narrowly scoped, atomic RPCs below.
create or replace function public.guard_review_workflow_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := current_setting('mizoramstay.review_operation', true);
begin
  if tg_op = 'INSERT' then
    if v_operation <> 'submit' then
      raise exception 'reviews must be submitted through submit_review' using errcode = '42501';
    end if;
    return new;
  end if;

  if v_operation = 'respond' then
    if (to_jsonb(new) - array['host_response', 'responded_at', 'updated_at'])
       <> (to_jsonb(old) - array['host_response', 'responded_at', 'updated_at']) then
      raise exception 'host response workflow cannot change review content or moderation' using errcode = '42501';
    end if;
  elsif v_operation = 'moderate' then
    if (to_jsonb(new) - array['moderation_status', 'moderation_notes', 'moderated_at', 'moderated_by', 'is_published', 'updated_at'])
       <> (to_jsonb(old) - array['moderation_status', 'moderation_notes', 'moderated_at', 'moderated_by', 'is_published', 'updated_at']) then
      raise exception 'moderation workflow cannot change review content or host response' using errcode = '42501';
    end if;
  else
    raise exception 'reviews must be changed through the review workflow' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger reviews_workflow_write_guard
  before insert or update on public.reviews
  for each row execute function public.guard_review_workflow_write();

create or replace function public.submit_review(
  p_booking_id uuid,
  p_rating smallint,
  p_title text default null,
  p_body text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_booking public.bookings;
  v_review public.reviews;
  v_host_id uuid;
  v_title text := nullif(btrim(p_title), '');
  v_body text := nullif(btrim(p_body), '');
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_booking_id is null then
    raise exception 'booking id is required' using errcode = '22023';
  end if;
  if p_rating is null or p_rating not between 1 and 5 then
    raise exception 'rating must be between 1 and 5' using errcode = '22023';
  end if;
  if v_title is not null and char_length(v_title) > 120 then
    raise exception 'review title must be 120 characters or fewer' using errcode = '22023';
  end if;
  if v_body is null or char_length(v_body) not between 10 and 2000 then
    raise exception 'review body must be between 10 and 2000 characters' using errcode = '22023';
  end if;

  -- Locking the booking serializes concurrent submissions before the unique booking fence.
  select * into v_booking
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    raise exception 'booking not found' using errcode = 'P0002';
  end if;
  if v_booking.guest_id <> v_actor_id then
    raise exception 'only the booking guest may submit a review' using errcode = '42501';
  end if;
  if v_booking.status <> 'completed' or v_booking.check_out > current_date then
    raise exception 'only a completed stay is eligible for review' using errcode = 'P0001';
  end if;

  select * into v_review
  from public.reviews
  where booking_id = p_booking_id;
  if found then
    raise exception 'this booking already has a review' using errcode = '23505';
  end if;

  select host_id into v_host_id
  from public.properties
  where id = v_booking.property_id;
  if v_host_id is null then
    raise exception 'property owner not found' using errcode = 'P0002';
  end if;

  perform set_config('mizoramstay.review_operation', 'submit', true);
  insert into public.reviews (
    booking_id, guest_id, property_id, rating, title, body,
    is_published, moderation_status
  ) values (
    v_booking.id, v_actor_id, v_booking.property_id, p_rating, v_title, v_body,
    false, 'pending'
  ) returning * into v_review;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'review',
    v_review.id,
    'submitted',
    jsonb_build_object(
      'booking_id', v_booking.id,
      'property_id', v_booking.property_id,
      'rating', p_rating,
      'moderation_status', 'pending'
    )
  );

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    v_host_id,
    'email',
    'review_submitted_host',
    jsonb_build_object(
      'review_id', v_review.id,
      'booking_id', v_booking.id,
      'property_id', v_booking.property_id,
      'moderation_status', 'pending'
    ),
    'review-submitted:host:' || v_review.id::text
  ) on conflict (channel, idempotency_key) do nothing;

  return v_review;
end;
$$;

create or replace function public.respond_to_review(
  p_review_id uuid,
  p_response text
)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_review public.reviews;
  v_response text := nullif(btrim(p_response), '');
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_review_id is null then
    raise exception 'review id is required' using errcode = '22023';
  end if;
  if v_response is null or char_length(v_response) not between 2 and 2000 then
    raise exception 'host response must be between 2 and 2000 characters' using errcode = '22023';
  end if;

  select r.* into v_review
  from public.reviews r
  join public.properties p on p.id = r.property_id
  where r.id = p_review_id
    and p.host_id = v_actor_id
  for update of r;

  if not found then
    raise exception 'review not found for this property owner' using errcode = 'P0002';
  end if;
  if v_review.moderation_status <> 'approved' or not v_review.is_published then
    raise exception 'a response can be added only after review approval' using errcode = 'P0001';
  end if;
  if v_review.host_response is not null then
    raise exception 'this review already has a host response' using errcode = '23505';
  end if;

  perform set_config('mizoramstay.review_operation', 'respond', true);
  update public.reviews
  set host_response = v_response,
      responded_at = now(),
      updated_at = now()
  where id = p_review_id
  returning * into v_review;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'review',
    v_review.id,
    'host_responded',
    jsonb_build_object('property_id', v_review.property_id, 'booking_id', v_review.booking_id)
  );

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    v_review.guest_id,
    'email',
    'review_host_response_guest',
    jsonb_build_object(
      'review_id', v_review.id,
      'booking_id', v_review.booking_id,
      'property_id', v_review.property_id
    ),
    'review-host-response:guest:' || v_review.id::text
  ) on conflict (channel, idempotency_key) do nothing;

  return v_review;
end;
$$;

-- This administrator-only RPC is the compatibility boundary for a future moderation UI.
-- Approval is the sole transition that publishes a review; rejection always keeps it private.
create or replace function public.moderate_review(
  p_review_id uuid,
  p_decision public.review_moderation_status,
  p_notes text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_review public.reviews;
  v_notes text := nullif(btrim(p_notes), '');
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_review_id is null or p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'moderation requires an approved or rejected decision' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'moderation notes must be 2000 characters or fewer' using errcode = '22023';
  end if;

  select * into v_review
  from public.reviews
  where id = p_review_id
  for update;

  if not found then
    raise exception 'review not found' using errcode = 'P0002';
  end if;
  if v_review.moderation_status <> 'pending' then
    raise exception 'review has already been moderated' using errcode = 'P0001';
  end if;

  perform set_config('mizoramstay.review_operation', 'moderate', true);
  update public.reviews
  set moderation_status = p_decision,
      moderation_notes = v_notes,
      moderated_at = now(),
      moderated_by = v_actor_id,
      is_published = (p_decision = 'approved'),
      updated_at = now()
  where id = p_review_id
  returning * into v_review;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'review',
    v_review.id,
    'moderated',
    jsonb_build_object(
      'booking_id', v_review.booking_id,
      'property_id', v_review.property_id,
      'decision', p_decision
    )
  );

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    v_review.guest_id,
    'email',
    case when p_decision = 'approved' then 'review_approved_guest' else 'review_rejected_guest' end,
    jsonb_build_object(
      'review_id', v_review.id,
      'booking_id', v_review.booking_id,
      'property_id', v_review.property_id,
      'decision', p_decision
    ),
    'review-moderated:guest:' || v_review.id::text
  ) on conflict (channel, idempotency_key) do nothing;

  return v_review;
end;
$$;

-- Replace permissive legacy update policies with read-only RLS plus workflow RPCs.
drop policy if exists reviews_public_or_owner on public.reviews;
drop policy if exists reviews_guest_insert on public.reviews;
drop policy if exists reviews_guest_update on public.reviews;
drop policy if exists reviews_host_response on public.reviews;

create policy reviews_public_guest_host_or_admin_read
  on public.reviews for select
  using (
    (is_published and moderation_status = 'approved')
    or guest_id = (select auth.uid())
    or exists (
      select 1
      from public.properties p
      where p.id = property_id and p.host_id = (select auth.uid())
    )
    or public.is_admin()
  );

revoke all on table public.reviews from anon, authenticated;
grant select on table public.reviews to anon, authenticated;
grant all on table public.reviews to service_role;

revoke all on function public.guard_review_workflow_write() from public, anon, authenticated, service_role;

revoke all on function public.submit_review(uuid, smallint, text, text) from public, anon;
grant execute on function public.submit_review(uuid, smallint, text, text) to authenticated;

revoke all on function public.respond_to_review(uuid, text) from public, anon;
grant execute on function public.respond_to_review(uuid, text) to authenticated;

revoke all on function public.moderate_review(uuid, public.review_moderation_status, text) from public, anon;
grant execute on function public.moderate_review(uuid, public.review_moderation_status, text) to authenticated;