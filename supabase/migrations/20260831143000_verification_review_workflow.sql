-- Phase 2: normalized, auditable internal review workflow for property publication.
-- Approval records a marketplace publishing decision; it is not an external certification.

create type public.verification_status as enum (
  'submitted',
  'in_review',
  'changes_requested',
  'approved',
  'rejected'
);

create type public.verification_event_type as enum (
  'submitted',
  'claimed',
  'changes_requested',
  'approved',
  'rejected',
  'resubmitted'
);

create table public.verification_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  status public.verification_status not null default 'submitted',
  review_level smallint not null default 0 check (review_level between 0 and 5),
  reviewer_id uuid references public.profiles(id) on delete restrict,
  review_notes text check (review_notes is null or char_length(review_notes) <= 4000),
  submitted_at timestamptz not null default now(),
  claimed_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'submitted' and reviewer_id is null and claimed_at is null and decided_at is null)
    or (status = 'in_review' and reviewer_id is not null and claimed_at is not null and decided_at is null)
    or (status in ('changes_requested', 'approved', 'rejected') and reviewer_id is not null and claimed_at is not null and decided_at is not null)
  )
);

create unique index verification_requests_one_active_per_property_idx
  on public.verification_requests (property_id)
  where status in ('submitted', 'in_review');
create index verification_requests_queue_idx
  on public.verification_requests (status, review_level desc, submitted_at asc);
create index verification_requests_reviewer_idx
  on public.verification_requests (reviewer_id, status, updated_at desc)
  where reviewer_id is not null;

create table public.verification_change_requests (
  id uuid primary key default gen_random_uuid(),
  verification_request_id uuid not null references public.verification_requests(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  field_name text not null check (char_length(trim(field_name)) between 1 and 120),
  instruction text not null check (char_length(trim(instruction)) between 1 and 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete restrict,
  check ((resolved_at is null) = (resolved_by is null))
);

create index verification_change_requests_request_idx
  on public.verification_change_requests (verification_request_id, created_at);
create index verification_change_requests_open_idx
  on public.verification_change_requests (verification_request_id)
  where resolved_at is null;

create table public.verification_events (
  id bigint generated always as identity primary key,
  verification_request_id uuid not null references public.verification_requests(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type public.verification_event_type not null,
  from_status public.verification_status,
  to_status public.verification_status not null,
  review_level smallint not null check (review_level between 0 and 5),
  notes text check (notes is null or char_length(notes) <= 4000),
  created_at timestamptz not null default now(),
  check (from_status is null or from_status <> to_status)
);

create index verification_events_request_idx
  on public.verification_events (verification_request_id, created_at, id);

comment on table public.verification_requests is
  'Internal marketplace review requests controlling property publication; not an external certification.';

create trigger verification_requests_updated_at
  before update on public.verification_requests
  for each row execute function public.set_updated_at();

alter table public.verification_requests enable row level security;
alter table public.verification_change_requests enable row level security;
alter table public.verification_events enable row level security;

create policy verification_requests_host_or_admin_read
  on public.verification_requests for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.properties p
      where p.id = property_id and p.host_id = (select auth.uid())
    )
  );

create policy verification_change_requests_host_or_admin_read
  on public.verification_change_requests for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.verification_requests vr
      join public.properties p on p.id = vr.property_id
      where vr.id = verification_request_id and p.host_id = (select auth.uid())
    )
  );

create policy verification_events_host_or_admin_read
  on public.verification_events for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.verification_requests vr
      join public.properties p on p.id = vr.property_id
      where vr.id = verification_request_id and p.host_id = (select auth.uid())
    )
  );

-- Existing submitted properties enter the normalized queue when this migration is applied.
insert into public.verification_requests (property_id, status, review_level, submitted_at)
select p.id, 'submitted', 0, coalesce(p.updated_at, now())
from public.properties p
where p.status = 'submitted';

insert into public.verification_events (
  verification_request_id,
  actor_id,
  event_type,
  from_status,
  to_status,
  review_level,
  notes,
  created_at
)
select vr.id, p.host_id, 'submitted', null, 'submitted', 0, 'Migrated from the property submission queue.', vr.submitted_at
from public.verification_requests vr
join public.properties p on p.id = vr.property_id;

create or replace function public.guard_property_verification_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  -- Migration/seed connections have no end-user JWT; RLS still blocks anonymous application writes.
  if auth.uid() is null then
    return new;
  end if;

  if new.status not in ('submitted', 'published') then
    return new;
  end if;

  begin
    v_request_id := nullif(current_setting('mizoramstay.verification_request_id', true), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'property status must be changed through the verification workflow' using errcode = '42501';
  end;

  if v_request_id is null then
    raise exception 'property status must be changed through the verification workflow' using errcode = '42501';
  end if;

  if new.status = 'submitted' and not exists (
    select 1
    from public.verification_requests vr
    where vr.id = v_request_id
      and vr.property_id = new.id
      and vr.status = 'submitted'
      and exists (
        select 1
        from public.properties p
        where p.id = new.id and p.host_id = auth.uid()
      )
  ) then
    raise exception 'invalid property submission transition' using errcode = '42501';
  end if;

  if new.status = 'published' and not exists (
    select 1
    from public.verification_requests vr
    where vr.id = v_request_id
      and vr.property_id = new.id
      and vr.status = 'approved'
      and vr.reviewer_id = auth.uid()
  ) then
    raise exception 'invalid property publication transition' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger properties_verification_insert_guard
  before insert on public.properties
  for each row execute function public.guard_property_verification_transition();

create trigger properties_verification_transition_guard
  before update of status on public.properties
  for each row execute function public.guard_property_verification_transition();

create or replace function public.submit_property_for_review(p_property_id uuid)
returns public.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_property public.properties;
  v_previous_request public.verification_requests;
  v_request public.verification_requests;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select * into v_property
  from public.properties
  where id = p_property_id
    and host_id = v_actor_id
    and status = 'draft'
  for update;

  if not found then
    raise exception 'draft property not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.rooms where property_id = p_property_id and is_active) then
    raise exception 'an active room is required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.property_media where property_id = p_property_id) then
    raise exception 'at least one property image is required' using errcode = 'P0001';
  end if;

  select * into v_previous_request
  from public.verification_requests
  where property_id = p_property_id
  order by created_at desc
  limit 1
  for update;

  if found and v_previous_request.status <> 'changes_requested' then
    raise exception 'property is not eligible for submission' using errcode = 'P0001';
  end if;

  insert into public.verification_requests (property_id, status, review_level, submitted_at)
  values (
    p_property_id,
    'submitted',
    coalesce(v_previous_request.review_level, 0),
    now()
  )
  returning * into v_request;

  if v_previous_request.id is not null then
    update public.verification_change_requests
    set resolved_at = now(), resolved_by = v_actor_id
    where verification_request_id = v_previous_request.id and resolved_at is null;
  end if;

  perform set_config('mizoramstay.verification_request_id', v_request.id::text, true);

  update public.properties
  set status = 'submitted', published_at = null, updated_at = now()
  where id = p_property_id
  returning * into v_property;

  insert into public.verification_events (
    verification_request_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    review_level
  )
  values (
    v_request.id,
    v_actor_id,
    case when v_previous_request.id is null then 'submitted'::public.verification_event_type else 'resubmitted'::public.verification_event_type end,
    null,
    'submitted',
    v_request.review_level
  );

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'verification_request',
    v_request.id,
    case when v_previous_request.id is null then 'submitted' else 'resubmitted' end,
    jsonb_build_object('property_id', p_property_id, 'review_level', v_request.review_level)
  );

  return v_property;
end;
$$;

create or replace function public.list_verification_requests(
  p_status public.verification_status default null,
  p_review_level smallint default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  property_id uuid,
  property_name text,
  property_slug text,
  host_id uuid,
  host_display_name text,
  status public.verification_status,
  review_level smallint,
  reviewer_id uuid,
  reviewer_display_name text,
  review_notes text,
  submitted_at timestamptz,
  claimed_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  change_requests jsonb,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_review_level is not null and p_review_level not between 0 and 5 then
    raise exception 'invalid review level' using errcode = '22023';
  end if;
  if p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  return query
  select
    vr.id,
    vr.property_id,
    p.name,
    p.slug::text,
    p.host_id,
    host.display_name,
    vr.status,
    vr.review_level,
    vr.reviewer_id,
    reviewer.display_name,
    vr.review_notes,
    vr.submitted_at,
    vr.claimed_at,
    vr.decided_at,
    vr.created_at,
    vr.updated_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', vcr.id,
            'fieldName', vcr.field_name,
            'instruction', vcr.instruction,
            'requestedBy', vcr.requested_by,
            'createdAt', vcr.created_at,
            'resolvedAt', vcr.resolved_at,
            'resolvedBy', vcr.resolved_by
          )
          order by vcr.created_at, vcr.id
        )
        from public.verification_change_requests vcr
        where vcr.verification_request_id = vr.id
      ),
      '[]'::jsonb
    ),
    count(*) over ()
  from public.verification_requests vr
  join public.properties p on p.id = vr.property_id
  join public.profiles host on host.id = p.host_id
  left join public.profiles reviewer on reviewer.id = vr.reviewer_id
  where (p_status is null or vr.status = p_status)
    and (p_review_level is null or vr.review_level = p_review_level)
  order by
    case vr.status
      when 'submitted' then 0
      when 'in_review' then 1
      when 'changes_requested' then 2
      when 'approved' then 3
      when 'rejected' then 4
    end,
    vr.review_level desc,
    vr.submitted_at asc
  limit p_limit
  offset p_offset;
end;
$$;

create or replace function public.claim_verification_request(
  p_request_id uuid,
  p_review_level smallint default null
)
returns public.verification_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_request public.verification_requests;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_review_level is not null and p_review_level not between 0 and 5 then
    raise exception 'invalid review level' using errcode = '22023';
  end if;

  select * into v_request
  from public.verification_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'verification request not found' using errcode = 'P0002';
  end if;
  if v_request.status = 'in_review' and v_request.reviewer_id = v_actor_id then
    return v_request;
  end if;
  if v_request.status <> 'submitted' then
    raise exception 'verification request cannot be claimed' using errcode = 'P0001';
  end if;

  update public.verification_requests
  set status = 'in_review',
      review_level = coalesce(p_review_level, review_level),
      reviewer_id = v_actor_id,
      claimed_at = now(),
      decided_at = null,
      review_notes = null
  where id = p_request_id
  returning * into v_request;

  insert into public.verification_events (
    verification_request_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    review_level
  )
  values (v_request.id, v_actor_id, 'claimed', 'submitted', 'in_review', v_request.review_level);

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'verification_request',
    v_request.id,
    'claimed',
    jsonb_build_object('property_id', v_request.property_id, 'review_level', v_request.review_level)
  );

  return v_request;
end;
$$;

create or replace function public.decide_verification_request(
  p_request_id uuid,
  p_decision public.verification_status,
  p_review_level smallint,
  p_notes text default null,
  p_change_requests jsonb default '[]'::jsonb
)
returns public.verification_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_request public.verification_requests;
  v_change_request jsonb;
  v_notes text := nullif(trim(p_notes), '');
  v_change_request_count integer;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('changes_requested', 'approved', 'rejected') then
    raise exception 'invalid verification decision' using errcode = '22023';
  end if;
  if p_review_level is null or p_review_level not between 0 and 5 then
    raise exception 'invalid review level' using errcode = '22023';
  end if;
  if v_notes is not null and char_length(v_notes) > 4000 then
    raise exception 'review notes are too long' using errcode = '22023';
  end if;
  if p_change_requests is null or jsonb_typeof(p_change_requests) <> 'array' then
    raise exception 'change requests must be an array' using errcode = '22023';
  end if;

  select * into v_request
  from public.verification_requests
  where id = p_request_id
  for update;

  if not found then
    raise exception 'verification request not found' using errcode = 'P0002';
  end if;
  if v_request.status <> 'in_review' then
    raise exception 'verification request is not in review' using errcode = 'P0001';
  end if;
  if v_request.reviewer_id <> v_actor_id then
    raise exception 'verification request belongs to another reviewer' using errcode = '42501';
  end if;

  select count(*) into v_change_request_count
  from jsonb_array_elements(p_change_requests);

  if p_decision = 'changes_requested' and (v_change_request_count = 0 or v_notes is null) then
    raise exception 'change requests and review notes are required' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_notes is null then
    raise exception 'review notes are required for rejection' using errcode = '22023';
  end if;
  if p_decision <> 'changes_requested' and v_change_request_count <> 0 then
    raise exception 'change requests are only valid for changes_requested decisions' using errcode = '22023';
  end if;

  if p_decision = 'changes_requested' then
    for v_change_request in select value from jsonb_array_elements(p_change_requests)
    loop
      if jsonb_typeof(v_change_request) <> 'object'
        or nullif(trim(v_change_request ->> 'fieldName'), '') is null
        or char_length(trim(v_change_request ->> 'fieldName')) > 120
        or nullif(trim(v_change_request ->> 'instruction'), '') is null
        or char_length(trim(v_change_request ->> 'instruction')) > 1000
      then
        raise exception 'invalid change request' using errcode = '22023';
      end if;

      insert into public.verification_change_requests (
        verification_request_id,
        requested_by,
        field_name,
        instruction
      )
      values (
        v_request.id,
        v_actor_id,
        trim(v_change_request ->> 'fieldName'),
        trim(v_change_request ->> 'instruction')
      );
    end loop;
  end if;

  update public.verification_requests
  set status = p_decision,
      review_level = p_review_level,
      review_notes = v_notes,
      decided_at = now()
  where id = p_request_id
  returning * into v_request;

  if p_decision = 'approved' then
    perform set_config('mizoramstay.verification_request_id', v_request.id::text, true);

    update public.properties
    set status = 'published', published_at = now(), updated_at = now()
    where id = v_request.property_id;
  else
    update public.properties
    set status = 'draft', published_at = null, updated_at = now()
    where id = v_request.property_id;
  end if;

  insert into public.verification_events (
    verification_request_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    review_level,
    notes
  )
  values (
    v_request.id,
    v_actor_id,
    p_decision::text::public.verification_event_type,
    'in_review',
    p_decision,
    p_review_level,
    v_notes
  );

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'verification_request',
    v_request.id,
    p_decision::text,
    jsonb_build_object('property_id', v_request.property_id, 'review_level', p_review_level)
  );

  return v_request;
end;
$$;

revoke all on table public.verification_requests from anon, authenticated;
revoke all on table public.verification_change_requests from anon, authenticated;
revoke all on table public.verification_events from anon, authenticated;
grant select on table public.verification_requests to authenticated;
grant select on table public.verification_change_requests to authenticated;
grant select on table public.verification_events to authenticated;

revoke all on function public.guard_property_verification_transition() from public, anon, authenticated;

revoke all on function public.submit_property_for_review(uuid) from public, anon;
grant execute on function public.submit_property_for_review(uuid) to authenticated;

revoke all on function public.list_verification_requests(public.verification_status, smallint, integer, integer) from public, anon;
grant execute on function public.list_verification_requests(public.verification_status, smallint, integer, integer) to authenticated;

revoke all on function public.claim_verification_request(uuid, smallint) from public, anon;
grant execute on function public.claim_verification_request(uuid, smallint) to authenticated;

revoke all on function public.decide_verification_request(uuid, public.verification_status, smallint, text, jsonb) from public, anon;
grant execute on function public.decide_verification_request(uuid, public.verification_status, smallint, text, jsonb) to authenticated;
