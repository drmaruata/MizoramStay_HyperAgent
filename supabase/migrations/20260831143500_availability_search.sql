-- Phase 2: public, RLS-preserving availability search.
-- The function is security invoker so published-catalog RLS remains the source of truth.
create or replace function public.search_available_properties(
  p_destination text,
  p_check_in date,
  p_check_out date,
  p_guest_count integer,
  p_limit integer
)
returns table (
  property_id uuid,
  property_slug text,
  property_name text,
  summary text,
  max_guests integer,
  destination_slug text,
  destination_name text,
  locality text,
  room_id uuid,
  room_name text,
  available_units integer,
  min_total_price numeric(14,2),
  min_nightly_price numeric(14,2),
  currency_code text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_destination text := lower(btrim(coalesce(p_destination, '')));
  v_nights integer;
begin
  if p_check_in is null or p_check_out is null or p_check_in < current_date or p_check_out <= p_check_in then
    raise exception 'invalid stay dates' using errcode = '22023';
  end if;

  v_nights := p_check_out - p_check_in;
  if v_nights > 30 then
    raise exception 'stay cannot exceed 30 nights' using errcode = '22023';
  end if;
  if p_guest_count is null or p_guest_count < 1 or p_guest_count > 20 then
    raise exception 'guest count must be between 1 and 20' using errcode = '22023';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'limit must be between 1 and 100' using errcode = '22023';
  end if;

  return query
  with available_rooms as (
    select
      r.id as room_id,
      r.property_id,
      r.name as room_name,
      min(ni.available_units)::integer as available_units,
      sum(ni.nightly_rate)::numeric(14,2) as total_price,
      round(sum(ni.nightly_rate) / v_nights, 2)::numeric(14,2) as nightly_price,
      min(ni.currency_code)::text as currency_code
    from public.rooms r
    join public.nightly_inventory ni on ni.room_id = r.id
    where r.is_active
      and r.capacity_adults + r.capacity_children >= p_guest_count
      and ni.stay_date >= p_check_in
      and ni.stay_date < p_check_out
    group by r.id, r.property_id, r.name
    having count(*) = v_nights
      and bool_and(ni.available_units > 0)
      and count(distinct ni.currency_code) = 1
  ),
  ranked_properties as (
    select
      ar.*,
      row_number() over (
        partition by ar.property_id
        order by ar.total_price, ar.nightly_price, ar.currency_code, ar.room_id
      ) as price_rank
    from available_rooms ar
  )
  select
    p.id,
    p.slug::text,
    p.name,
    p.summary,
    p.max_guests,
    d.slug::text,
    d.name,
    p.locality,
    rp.room_id,
    rp.room_name,
    rp.available_units,
    rp.total_price,
    rp.nightly_price,
    rp.currency_code
  from ranked_properties rp
  join public.properties p on p.id = rp.property_id
  join public.destinations d on d.id = p.destination_id
  where rp.price_rank = 1
    and p.status = 'published'
    and p.max_guests >= p_guest_count
    and d.is_active
    and (
      v_destination = ''
      or strpos(lower(d.name), v_destination) > 0
      or strpos(lower(d.slug::text), v_destination) > 0
      or strpos(lower(d.state), v_destination) > 0
      or strpos(lower(coalesce(p.locality, '')), v_destination) > 0
      or strpos(lower(p.name), v_destination) > 0
    )
  order by rp.total_price, p.published_at desc, p.id
  limit p_limit;
end;
$$;

revoke all on function public.search_available_properties(text, date, date, integer, integer) from public;
grant execute on function public.search_available_properties(text, date, date, integer, integer) to anon, authenticated;
