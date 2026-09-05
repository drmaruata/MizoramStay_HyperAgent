-- Phase 4: privacy-safe marketplace analytics over normalized operational records.
-- The report intentionally exposes aggregate counts and amounts only; it never returns guest,
-- host, booking, payment, or property identifiers.

create index if not exists bookings_analytics_created_idx
  on public.bookings (created_at, status);

create index if not exists payments_analytics_created_idx
  on public.payments (created_at, status, booking_id);

create or replace function public.get_marketplace_analytics(p_days integer default 30)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_period_start timestamptz;
  v_period_end timestamptz := now();
  v_stay_start date;
  v_stay_end date := current_date;
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  if p_days is null or p_days < 1 or p_days > 365 then
    raise exception 'analytics period must be between 1 and 365 days' using errcode = '22023';
  end if;

  v_period_start := v_period_end - make_interval(days => p_days);
  v_stay_start := v_stay_end - p_days;

  with
  booking_cohort as (
    select
      b.id,
      b.property_id,
      b.status,
      b.total_amount,
      b.currency_code
    from public.bookings b
    where b.created_at >= v_period_start
      and b.created_at < v_period_end
  ),
  cohort_payment_flags as (
    select
      bc.id as booking_id,
      bool_or(p.id is not null) as attempted,
      bool_or(p.status in ('captured', 'partially_refunded', 'refunded')) as captured
    from booking_cohort bc
    left join public.payments p
      on p.booking_id = bc.id
     and p.created_at < v_period_end
    group by bc.id
  ),
  booking_summary as (
    select
      count(*)::bigint as bookings_started,
      count(*) filter (where cpf.attempted)::bigint as payment_attempted,
      count(*) filter (where cpf.captured)::bigint as payment_captured,
      count(*) filter (where bc.status in ('confirmed', 'completed'))::bigint as confirmed_or_completed,
      count(*) filter (where bc.status = 'cancelled')::bigint as cancelled,
      count(*) filter (where bc.status = 'expired')::bigint as expired,
      coalesce(sum(bc.total_amount) filter (where bc.status in ('confirmed', 'completed')), 0)::numeric(14,2) as gmv,
      coalesce(avg(bc.total_amount) filter (where bc.status in ('confirmed', 'completed')), 0)::numeric(14,2) as average_booking_value,
      case
        when count(*) = 0 then 0
        else round(
          count(*) filter (where bc.status in ('confirmed', 'completed'))::numeric * 100 / count(*),
          2
        )
      end as booking_conversion_percent,
      case
        when count(distinct bc.currency_code) = 1 then min(bc.currency_code)::text
        when count(*) = 0 then 'INR'
        else 'MIXED'
      end as currency_code
    from booking_cohort bc
    join cohort_payment_flags cpf on cpf.booking_id = bc.id
  ),
  payment_summary as (
    select
      count(*)::bigint as attempts,
      count(*) filter (where p.status = 'failed')::bigint as failed_attempts,
      count(distinct p.booking_id) filter (where p.status = 'failed')::bigint as affected_bookings
    from public.payments p
    where p.created_at >= v_period_start
      and p.created_at < v_period_end
  ),
  reservation_nights as (
    select
      bi.room_id,
      generated.stay_date::date as stay_date,
      sum(bi.quantity)::bigint as reserved_units,
      sum(bi.quantity) filter (where b.status in ('confirmed', 'completed'))::bigint as occupied_units
    from public.bookings b
    join public.booking_items bi on bi.booking_id = b.id
    cross join lateral generate_series(
      greatest(b.check_in, v_stay_start)::timestamp,
      (least(b.check_out, v_stay_end) - 1)::timestamp,
      interval '1 day'
    ) as generated(stay_date)
    where b.check_in < v_stay_end
      and b.check_out > v_stay_start
      and (
        b.status in ('confirmed', 'completed')
        or (b.status = 'hold' and b.hold_expires_at > v_period_end)
      )
    group by bi.room_id, generated.stay_date::date
  ),
  inventory_by_destination as (
    select
      d.id as destination_id,
      d.name as destination_name,
      sum(coalesce(rn.occupied_units, 0))::bigint as occupied_room_nights,
      sum(ni.available_units + coalesce(rn.reserved_units, 0))::bigint as capacity_room_nights
    from public.nightly_inventory ni
    join public.rooms r on r.id = ni.room_id
    join public.properties p on p.id = r.property_id
    join public.destinations d on d.id = p.destination_id
    left join reservation_nights rn
      on rn.room_id = ni.room_id
     and rn.stay_date = ni.stay_date
    where ni.stay_date >= v_stay_start
      and ni.stay_date < v_stay_end
    group by d.id, d.name
  ),
  commerce_by_destination as (
    select
      d.id as destination_id,
      count(*)::bigint as booking_count,
      coalesce(sum(bc.total_amount) filter (where bc.status in ('confirmed', 'completed')), 0)::numeric(14,2) as gmv
    from booking_cohort bc
    join public.properties p on p.id = bc.property_id
    join public.destinations d on d.id = p.destination_id
    group by d.id
  ),
  destination_activity as (
    select destination_id from inventory_by_destination
    union
    select destination_id from commerce_by_destination
  ),
  destination_rows as (
    select
      d.name as destination,
      coalesce(cbd.booking_count, 0)::bigint as booking_count,
      coalesce(cbd.gmv, 0)::numeric(14,2) as gmv,
      coalesce(ibd.occupied_room_nights, 0)::bigint as occupied_room_nights,
      coalesce(ibd.capacity_room_nights, 0)::bigint as capacity_room_nights,
      case
        when coalesce(ibd.capacity_room_nights, 0) = 0 then 0
        else round(ibd.occupied_room_nights::numeric * 100 / ibd.capacity_room_nights, 2)
      end as occupancy_percent
    from destination_activity da
    join public.destinations d on d.id = da.destination_id
    left join inventory_by_destination ibd on ibd.destination_id = da.destination_id
    left join commerce_by_destination cbd on cbd.destination_id = da.destination_id
  ),
  verification_statuses as (
    select *
    from (values
      ('submitted', 1),
      ('in_review', 2),
      ('changes_requested', 3),
      ('approved', 4),
      ('rejected', 5)
    ) as statuses(status, sort_order)
  ),
  verification_counts as (
    select vr.status::text as status, count(*)::bigint as count
    from public.verification_requests vr
    group by vr.status
  )
  select jsonb_build_object(
    'period', jsonb_build_object(
      'days', p_days,
      'start', v_period_start,
      'end', v_period_end,
      'occupancyStart', v_stay_start,
      'occupancyEndExclusive', v_stay_end
    ),
    'summary', jsonb_build_object(
      'gmv', bs.gmv,
      'currencyCode', bs.currency_code,
      'confirmedBookings', bs.confirmed_or_completed,
      'bookingConversionPercent', bs.booking_conversion_percent,
      'averageBookingValue', bs.average_booking_value
    ),
    'funnel', jsonb_build_array(
      jsonb_build_object('stage', 'booking_started', 'label', 'Bookings started', 'count', bs.bookings_started),
      jsonb_build_object('stage', 'payment_attempted', 'label', 'Payment attempted', 'count', bs.payment_attempted),
      jsonb_build_object('stage', 'payment_captured', 'label', 'Payment captured', 'count', bs.payment_captured),
      jsonb_build_object('stage', 'confirmed_or_completed', 'label', 'Currently confirmed or completed', 'count', bs.confirmed_or_completed)
    ),
    'failures', jsonb_build_object(
      'cancelledBookings', bs.cancelled,
      'expiredBookings', bs.expired,
      'failedPaymentAttempts', ps.failed_attempts,
      'bookingsWithFailedPayment', ps.affected_bookings,
      'paymentAttempts', ps.attempts
    ),
    'occupancyByDestination', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'destination', dr.destination,
          'bookingCount', dr.booking_count,
          'gmv', dr.gmv,
          'occupiedRoomNights', dr.occupied_room_nights,
          'capacityRoomNights', dr.capacity_room_nights,
          'occupancyPercent', dr.occupancy_percent
        )
        order by dr.occupancy_percent desc, dr.gmv desc, dr.destination
      )
      from destination_rows dr
    ), '[]'::jsonb),
    'verificationQueue', jsonb_build_object(
      'open', coalesce((
        select sum(vc.count)
        from verification_counts vc
        where vc.status in ('submitted', 'in_review', 'changes_requested')
      ), 0),
      'byStatus', coalesce((
        select jsonb_agg(
          jsonb_build_object('status', vs.status, 'count', coalesce(vc.count, 0))
          order by vs.sort_order
        )
        from verification_statuses vs
        left join verification_counts vc on vc.status = vs.status
      ), '[]'::jsonb)
    )
  ) into v_result
  from booking_summary bs
  cross join payment_summary ps;

  return v_result;
end;
$$;

revoke all on function public.get_marketplace_analytics(integer) from public, anon;
grant execute on function public.get_marketplace_analytics(integer) to authenticated;

comment on function public.get_marketplace_analytics(integer) is
  'Admin-only, security-invoker aggregate marketplace analytics. Returns no customer, host, property, booking, or payment identifiers.';
