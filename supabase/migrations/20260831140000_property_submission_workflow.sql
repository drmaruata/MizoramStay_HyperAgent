-- Phase 2: explicit property review lifecycle.
alter type public.property_status add value if not exists 'submitted' after 'draft';

create or replace function public.submit_property_for_review(p_property_id uuid)
returns public.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_property public.properties;
begin
  if auth.uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into v_property from public.properties where id = p_property_id and host_id = auth.uid() and status = 'draft' for update;
  if not found then raise exception 'draft property not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.rooms where property_id = p_property_id and is_active) then raise exception 'an active room is required' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.property_media where property_id = p_property_id) then raise exception 'at least one property image is required' using errcode = 'P0001'; end if;
  update public.properties set status = 'submitted', updated_at = now() where id = p_property_id returning * into v_property;
  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata) values (auth.uid(), 'property', p_property_id, 'submitted_for_review', '{}'::jsonb);
  return v_property;
end;
$$;
revoke all on function public.submit_property_for_review(uuid) from public, anon;
grant execute on function public.submit_property_for_review(uuid) to authenticated;
