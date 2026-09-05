-- Fictional public catalog fixtures. These rows intentionally have no auth.users/profile IDs.
-- Paths are illustrative Supabase Storage object keys; upload corresponding assets separately.

insert into public.destinations (id, slug, name, state, country_code, description, latitude, longitude, is_active)
values
  ('10000000-0000-0000-0000-000000000001', 'aizawl', 'Aizawl', 'Mizoram', 'IN', 'A fictional hill-city destination fixture for MizoramStay.', 23.727100, 92.717600, true),
  ('10000000-0000-0000-0000-000000000002', 'rewiek', 'Rewiek', 'Mizoram', 'IN', 'A completely fictional lakeside village used for local development.', 23.900000, 92.800000, true)
on conflict (id) do update set name = excluded.name, description = excluded.description, updated_at = now();

insert into public.amenities (id, slug, name, category, icon_name)
values
  ('20000000-0000-0000-0000-000000000001', 'wifi', 'Wi-Fi', 'connectivity', 'wifi'),
  ('20000000-0000-0000-0000-000000000002', 'breakfast', 'Breakfast', 'food', 'utensils'),
  ('20000000-0000-0000-0000-000000000003', 'parking', 'Parking', 'transport', 'car'),
  ('20000000-0000-0000-0000-000000000004', 'mountain-view', 'Mountain view', 'view', 'mountain'),
  ('20000000-0000-0000-0000-000000000005', 'hot-water', 'Hot water', 'comfort', 'shower')
on conflict (id) do update set name = excluded.name;

insert into public.properties (id, host_id, destination_id, slug, name, summary, description, address_line1, locality, postal_code, latitude, longitude, check_in_time, check_out_time, status, published_at, max_guests)
values
  ('30000000-0000-0000-0000-000000000001', null, '10000000-0000-0000-0000-000000000001', 'fictional-lushai-lodge', 'Fictional Lushai Lodge', 'A fictional, quiet hillside lodge with sunrise views.', 'Development fixture only. This property, its address, and its details are not real.', '12 Example Ridge Road', 'Aizawl', '796001', 23.728000, 92.718000, '14:00', '11:00', 'published', now(), 12),
  ('30000000-0000-0000-0000-000000000002', null, '10000000-0000-0000-0000-000000000002', 'rewiek-water-cottages', 'Rewiek Water Cottages', 'Entirely fictional cottages for marketplace UI testing.', 'Development fixture only. The Rewiek destination and these cottages are fictional.', '7 Mock Lake Path', 'Rewiek', '796099', 23.901000, 92.801000, '15:00', '10:30', 'published', now(), 8)
on conflict (id) do update set name = excluded.name, summary = excluded.summary, description = excluded.description, status = excluded.status, published_at = excluded.published_at, updated_at = now();

insert into public.rooms (id, property_id, name, description, capacity_adults, capacity_children, beds_description, base_nightly_rate, currency_code, is_active)
values
  ('40000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'Sunrise Queen Room', 'Fictional queen room with a balcony.', 2, 1, '1 queen bed', 3200.00, 'INR', true),
  ('40000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'Family Loft', 'Fictional two-level room for a family stay.', 4, 2, '1 queen bed, 2 single beds', 5200.00, 'INR', true),
  ('40000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', 'Lakeside Cottage', 'Fictional standalone cottage near a mock lake.', 2, 1, '1 king bed', 4100.00, 'INR', true)
on conflict (id) do update set description = excluded.description, base_nightly_rate = excluded.base_nightly_rate, updated_at = now();

-- Media metadata is intentionally not seeded without matching Storage objects.
-- Upload fixtures through the signed host upload workflow so public URLs never point to missing files.

insert into public.property_amenities (property_id, amenity_id)
values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005')
on conflict do nothing;

-- Rolling 45-day inventory keeps seed data useful without hard-coded, soon-stale dates.
insert into public.nightly_inventory (room_id, stay_date, available_units, nightly_rate, currency_code, minimum_nights)
select r.id, d.stay_date, case when r.id = '40000000-0000-0000-0000-000000000002'::uuid then 2 else 1 end,
       r.base_nightly_rate, r.currency_code, 1
from public.rooms r
cross join lateral generate_series(current_date, current_date + 44, interval '1 day') as d(stay_date)
where r.id in ('40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000003')
on conflict (room_id, stay_date) do update set available_units = excluded.available_units, nightly_rate = excluded.nightly_rate, currency_code = excluded.currency_code, minimum_nights = excluded.minimum_nights, updated_at = now();
