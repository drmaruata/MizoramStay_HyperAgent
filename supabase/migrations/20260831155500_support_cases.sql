-- Phase 4: private, auditable support cases for customers, hosts, and administrators.
-- Case records deliberately contain no email address or phone number. Support agents must
-- use the notification outbox, and RLS prevents a requester from seeing another case.

create type public.support_case_priority as enum ('low', 'normal', 'high', 'urgent');
create type public.support_case_status as enum ('open', 'in_progress', 'waiting_on_customer', 'resolved', 'closed');
create type public.support_case_category as enum ('booking', 'payment', 'property', 'account', 'safety', 'other');

create table public.support_cases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.profiles(id) on delete restrict,
  host_id uuid references public.profiles(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete restrict,
  assigned_to uuid references public.profiles(id) on delete set null,
  category public.support_case_category not null,
  priority public.support_case_priority not null default 'normal',
  status public.support_case_status not null default 'open',
  subject text not null check (char_length(btrim(subject)) between 5 and 160),
  resolution_summary text check (resolution_summary is null or char_length(btrim(resolution_summary)) between 10 and 2000),
  assigned_at timestamptz,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((customer_id is not null)::integer + (host_id is not null)::integer = 1),
  check ((assigned_to is null) = (assigned_at is null)),
  check ((status in ('resolved', 'closed')) = (resolved_at is not null)),
  check ((status = 'closed') = (closed_at is not null))
);

create table public.support_case_messages (
  id uuid primary key default gen_random_uuid(),
  support_case_id uuid not null references public.support_cases(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete restrict,
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create index support_cases_customer_created_idx
  on public.support_cases (customer_id, created_at desc)
  where customer_id is not null;
create index support_cases_host_created_idx
  on public.support_cases (host_id, created_at desc)
  where host_id is not null;
create index support_cases_booking_idx
  on public.support_cases (booking_id, created_at desc)
  where booking_id is not null;
create index support_cases_admin_queue_idx
  on public.support_cases (status, priority, created_at)
  where status not in ('resolved', 'closed');
create index support_cases_assignee_queue_idx
  on public.support_cases (assigned_to, status, updated_at desc)
  where assigned_to is not null;
create index support_case_messages_case_created_idx
  on public.support_case_messages (support_case_id, created_at, id);

comment on table public.support_cases is
  'Private marketplace support cases. Contact details are intentionally excluded and remain isolated in their source records.';
comment on column public.support_case_messages.is_internal is
  'Administrator-only operational note; never visible to a customer or host.';

create trigger support_cases_updated_at
  before update on public.support_cases
  for each row execute function public.set_updated_at();

alter table public.support_cases enable row level security;
alter table public.support_case_messages enable row level security;

create policy support_cases_owner_or_admin_read
  on public.support_cases for select to authenticated
  using (
    customer_id = (select auth.uid())
    or host_id = (select auth.uid())
    or public.is_admin()
  );

create policy support_case_messages_owner_or_admin_read
  on public.support_case_messages for select to authenticated
  using (
    public.is_admin()
    or (
      not is_internal
      and exists (
        select 1
        from public.support_cases sc
        where sc.id = support_case_id
          and (sc.customer_id = (select auth.uid()) or sc.host_id = (select auth.uid()))
      )
    )
  );

create or replace function public.create_support_case(
  p_subject text,
  p_message text,
  p_category public.support_case_category,
  p_priority public.support_case_priority default 'normal',
  p_booking_id uuid default null
)
returns public.support_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_role public.app_role;
  v_subject text := nullif(btrim(p_subject), '');
  v_message text := nullif(btrim(p_message), '');
  v_case public.support_cases;
  v_message_row public.support_case_messages;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;

  select role into v_role from public.profiles where id = v_actor_id;
  if not found then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;
  if v_role = 'admin' then
    raise exception 'administrators cannot open requester support cases' using errcode = '42501';
  end if;
  if v_subject is null or char_length(v_subject) not between 5 and 160 then
    raise exception 'invalid support subject' using errcode = '22023';
  end if;
  if v_message is null or char_length(v_message) not between 1 and 4000 then
    raise exception 'invalid support message' using errcode = '22023';
  end if;
  if p_category is null or p_priority is null then
    raise exception 'support category and priority are required' using errcode = '22023';
  end if;

  if p_booking_id is not null and not exists (
    select 1
    from public.bookings b
    join public.properties p on p.id = b.property_id
    where b.id = p_booking_id
      and (b.guest_id = v_actor_id or p.host_id = v_actor_id)
  ) then
    -- Do not reveal whether a booking belonging to somebody else exists.
    raise exception 'booking not found' using errcode = 'P0002';
  end if;

  insert into public.support_cases (
    customer_id,
    host_id,
    booking_id,
    category,
    priority,
    subject
  ) values (
    case when v_role = 'tourist' then v_actor_id else null end,
    case when v_role = 'host' then v_actor_id else null end,
    p_booking_id,
    p_category,
    p_priority,
    v_subject
  ) returning * into v_case;

  insert into public.support_case_messages (support_case_id, author_id, body)
  values (v_case.id, v_actor_id, v_message)
  returning * into v_message_row;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'support_case',
    v_case.id,
    'created',
    jsonb_build_object(
      'category', v_case.category,
      'priority', v_case.priority,
      'booking_id', v_case.booking_id,
      'requester_kind', case when v_case.customer_id is not null then 'customer' else 'host' end,
      'initial_message_id', v_message_row.id
    )
  );

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    null,
    'webhook',
    'support_case_created',
    jsonb_build_object('support_case_id', v_case.id, 'priority', v_case.priority, 'category', v_case.category),
    'support-case-created:' || v_case.id::text
  ) on conflict (channel, idempotency_key) do nothing;

  return v_case;
end;
$$;

create or replace function public.add_support_case_message(
  p_case_id uuid,
  p_message text,
  p_internal boolean default false
)
returns public.support_case_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_is_admin boolean;
  v_message text := nullif(btrim(p_message), '');
  v_case public.support_cases;
  v_message_row public.support_case_messages;
  v_owner_id uuid;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if v_message is null or char_length(v_message) > 4000 then
    raise exception 'invalid support message' using errcode = '22023';
  end if;

  v_is_admin := public.is_admin();
  select * into v_case
  from public.support_cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'support case not found' using errcode = 'P0002';
  end if;
  if not v_is_admin
     and v_case.customer_id is distinct from v_actor_id
     and v_case.host_id is distinct from v_actor_id then
    -- Deliberately use not-found semantics across the ownership boundary.
    raise exception 'support case not found' using errcode = 'P0002';
  end if;
  if p_internal and not v_is_admin then
    raise exception 'internal notes require administrator access' using errcode = '42501';
  end if;
  if v_case.status in ('resolved', 'closed') then
    raise exception 'support case is closed for replies' using errcode = 'P0001';
  end if;

  insert into public.support_case_messages (support_case_id, author_id, body, is_internal)
  values (v_case.id, v_actor_id, v_message, p_internal)
  returning * into v_message_row;

  if not p_internal then
    update public.support_cases
    set status = case
          when v_is_admin then 'waiting_on_customer'::public.support_case_status
          else 'in_progress'::public.support_case_status
        end
    where id = v_case.id;
  else
    update public.support_cases set updated_at = now() where id = v_case.id;
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'support_case',
    v_case.id,
    case when p_internal then 'internal_note_added' else 'message_added' end,
    jsonb_build_object('message_id', v_message_row.id, 'is_internal', p_internal)
  );

  v_owner_id := coalesce(v_case.customer_id, v_case.host_id);
  if v_is_admin and not p_internal then
    insert into public.notification_outbox (
      recipient_id, channel, template_key, payload, idempotency_key
    ) values (
      v_owner_id,
      'email',
      'support_case_reply',
      jsonb_build_object('support_case_id', v_case.id, 'message_id', v_message_row.id),
      'support-case-reply:' || v_message_row.id::text
    ) on conflict (channel, idempotency_key) do nothing;
  elsif not v_is_admin and v_case.assigned_to is not null then
    insert into public.notification_outbox (
      recipient_id, channel, template_key, payload, idempotency_key
    ) values (
      v_case.assigned_to,
      'email',
      'support_case_customer_reply',
      jsonb_build_object('support_case_id', v_case.id, 'message_id', v_message_row.id),
      'support-case-customer-reply:' || v_message_row.id::text
    ) on conflict (channel, idempotency_key) do nothing;
  else
    insert into public.notification_outbox (
      recipient_id, channel, template_key, payload, idempotency_key
    ) values (
      null,
      'webhook',
      'support_case_customer_reply',
      jsonb_build_object('support_case_id', v_case.id, 'message_id', v_message_row.id),
      'support-case-customer-reply:' || v_message_row.id::text
    ) on conflict (channel, idempotency_key) do nothing;
  end if;

  return v_message_row;
end;
$$;

create or replace function public.assign_support_case(
  p_case_id uuid,
  p_assignee_id uuid default null,
  p_priority public.support_case_priority default null
)
returns public.support_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_assignee_id uuid := coalesce(p_assignee_id, auth.uid());
  v_case public.support_cases;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.profiles where id = v_assignee_id and role = 'admin'
  ) then
    raise exception 'assignee must be an administrator' using errcode = '22023';
  end if;

  select * into v_case
  from public.support_cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'support case not found' using errcode = 'P0002';
  end if;
  if v_case.status in ('resolved', 'closed') then
    raise exception 'resolved support case cannot be assigned' using errcode = 'P0001';
  end if;

  update public.support_cases
  set assigned_to = v_assignee_id,
      assigned_at = case when assigned_to is distinct from v_assignee_id then now() else assigned_at end,
      priority = coalesce(p_priority, priority),
      status = case when status = 'open' then 'in_progress'::public.support_case_status else status end
  where id = p_case_id
  returning * into v_case;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'support_case',
    v_case.id,
    'assigned',
    jsonb_build_object('assigned_to', v_assignee_id, 'priority', v_case.priority)
  );

  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    v_assignee_id,
    'email',
    'support_case_assigned',
    jsonb_build_object('support_case_id', v_case.id, 'priority', v_case.priority),
    'support-case-assigned:' || v_case.id::text || ':' || v_assignee_id::text
  ) on conflict (channel, idempotency_key) do nothing;

  return v_case;
end;
$$;

create or replace function public.resolve_support_case(
  p_case_id uuid,
  p_resolution text
)
returns public.support_cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_resolution text := nullif(btrim(p_resolution), '');
  v_case public.support_cases;
  v_owner_id uuid;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if not public.is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if v_resolution is null or char_length(v_resolution) not between 10 and 2000 then
    raise exception 'invalid resolution summary' using errcode = '22023';
  end if;

  select * into v_case
  from public.support_cases
  where id = p_case_id
  for update;

  if not found then
    raise exception 'support case not found' using errcode = 'P0002';
  end if;
  if v_case.status in ('resolved', 'closed') then
    raise exception 'support case is already resolved' using errcode = 'P0001';
  end if;
  if v_case.assigned_to is not null and v_case.assigned_to <> v_actor_id then
    raise exception 'support case belongs to another administrator' using errcode = '42501';
  end if;

  update public.support_cases
  set assigned_to = coalesce(assigned_to, v_actor_id),
      assigned_at = coalesce(assigned_at, now()),
      status = 'resolved',
      resolution_summary = v_resolution,
      resolved_at = now(),
      closed_at = null
  where id = p_case_id
  returning * into v_case;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor_id,
    'support_case',
    v_case.id,
    'resolved',
    jsonb_build_object('assigned_to', v_case.assigned_to, 'priority', v_case.priority)
  );

  v_owner_id := coalesce(v_case.customer_id, v_case.host_id);
  insert into public.notification_outbox (
    recipient_id, channel, template_key, payload, idempotency_key
  ) values (
    v_owner_id,
    'email',
    'support_case_resolved',
    jsonb_build_object('support_case_id', v_case.id),
    'support-case-resolved:' || v_case.id::text
  ) on conflict (channel, idempotency_key) do nothing;

  return v_case;
end;
$$;

create or replace function public.list_support_cases(
  p_status public.support_case_status default null,
  p_priority public.support_case_priority default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  customer_id uuid,
  host_id uuid,
  requester_display_name text,
  requester_kind text,
  booking_id uuid,
  booking_check_in date,
  booking_check_out date,
  property_name text,
  assigned_to uuid,
  assignee_display_name text,
  category public.support_case_category,
  priority public.support_case_priority,
  status public.support_case_status,
  subject text,
  resolution_summary text,
  assigned_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  message_count bigint,
  last_message_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_is_admin boolean;
begin
  if v_actor_id is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  if p_limit not between 1 and 100 or p_offset < 0 then
    raise exception 'invalid pagination' using errcode = '22023';
  end if;

  v_is_admin := public.is_admin();
  return query
  select
    sc.id,
    sc.customer_id,
    sc.host_id,
    requester.display_name,
    case when sc.customer_id is not null then 'customer' else 'host' end,
    sc.booking_id,
    b.check_in,
    b.check_out,
    p.name,
    sc.assigned_to,
    assignee.display_name,
    sc.category,
    sc.priority,
    sc.status,
    sc.subject,
    sc.resolution_summary,
    sc.assigned_at,
    sc.resolved_at,
    sc.created_at,
    sc.updated_at,
    (
      select count(*)
      from public.support_case_messages scm
      where scm.support_case_id = sc.id and (v_is_admin or not scm.is_internal)
    ),
    (
      select max(scm.created_at)
      from public.support_case_messages scm
      where scm.support_case_id = sc.id and (v_is_admin or not scm.is_internal)
    ),
    count(*) over ()
  from public.support_cases sc
  join public.profiles requester on requester.id = coalesce(sc.customer_id, sc.host_id)
  left join public.profiles assignee on assignee.id = sc.assigned_to
  left join public.bookings b on b.id = sc.booking_id
  left join public.properties p on p.id = b.property_id
  where (v_is_admin or sc.customer_id = v_actor_id or sc.host_id = v_actor_id)
    and (p_status is null or sc.status = p_status)
    and (p_priority is null or sc.priority = p_priority)
  order by
    case sc.status
      when 'open' then 0
      when 'in_progress' then 1
      when 'waiting_on_customer' then 2
      when 'resolved' then 3
      when 'closed' then 4
    end,
    case sc.priority
      when 'urgent' then 0
      when 'high' then 1
      when 'normal' then 2
      when 'low' then 3
    end,
    sc.updated_at desc,
    sc.id
  limit p_limit
  offset p_offset;
end;
$$;

-- Eligible users can only read through RLS. All writes and workflow transitions are RPC-only.
revoke all on table public.support_cases from anon, authenticated;
revoke all on table public.support_case_messages from anon, authenticated;
grant select on table public.support_cases to authenticated;
grant select on table public.support_case_messages to authenticated;
grant all on table public.support_cases to service_role;
grant all on table public.support_case_messages to service_role;

revoke all on function public.create_support_case(text, text, public.support_case_category, public.support_case_priority, uuid) from public, anon;
grant execute on function public.create_support_case(text, text, public.support_case_category, public.support_case_priority, uuid) to authenticated;

revoke all on function public.add_support_case_message(uuid, text, boolean) from public, anon;
grant execute on function public.add_support_case_message(uuid, text, boolean) to authenticated;

revoke all on function public.assign_support_case(uuid, uuid, public.support_case_priority) from public, anon;
grant execute on function public.assign_support_case(uuid, uuid, public.support_case_priority) to authenticated;

revoke all on function public.resolve_support_case(uuid, text) from public, anon;
grant execute on function public.resolve_support_case(uuid, text) to authenticated;

revoke all on function public.list_support_cases(public.support_case_status, public.support_case_priority, integer, integer) from public, anon;
grant execute on function public.list_support_cases(public.support_case_status, public.support_case_priority, integer, integer) to authenticated;
