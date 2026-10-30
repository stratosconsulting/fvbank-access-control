-- Bridge between FV Bank Access Control and the STRATOS Asset Inventory.
-- The two apps keep their own databases. A shared token (stored in Vault on both
-- sides as 'directory_token') authorizes the calls between them.
--   * The inventory searches employees through directory_search / directory_get.
--   * The inventory pushes each employee's assigned equipment into employee_assets
--     (read-only for this app) through directory_set_assets.
--   * When an employee is offboarded, renamed or deleted here, a trigger tells the
--     inventory, which frees their equipment (Spare / Available / Previous user).

create extension if not exists pg_net;

-- Run once, with the same value used in the inventory project:
--   select vault.create_secret('<TOKEN>', 'directory_token', 'Shared token with STRATOS inventory');
--   select vault.create_secret('<INVENTORY ANON KEY>', 'inventory_anon_key', 'STRATOS inventory anon key');

create or replace function public.directory_secret(p_name text)
returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;
revoke all on function public.directory_secret(text) from public, anon, authenticated;

create or replace function public.directory_check(p_token text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or p_token <> coalesce(public.directory_secret('directory_token'), '#none#') then
    raise exception 'invalid directory token' using errcode = '28000';
  end if;
end $$;
revoke all on function public.directory_check(text) from public, anon, authenticated;

-- Equipment assigned to each employee, mirrored from the inventory (read-only here)
create table if not exists public.employee_assets (
  asset_id      uuid primary key,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  asset_name    text,
  hardware_type text,
  model         text,
  serial        text,
  status        text,
  synced_at     timestamptz not null default now()
);
create index if not exists employee_assets_employee_idx on public.employee_assets(employee_id);
alter table public.employee_assets enable row level security;
drop policy if exists "authenticated read" on public.employee_assets;
create policy "authenticated read" on public.employee_assets for select to authenticated using (true);

create or replace function public.directory_row(e public.employees)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', e.id, 'name', e.name, 'email', e.email, 'department', e.department,
    'location', e.location, 'status', e.status, 'mfa', e.google_2fa_enabled,
    'offboarded_at', e.offboarded_at,
    'apps', (select count(*) from public.permissions p where p.employee_id = e.id))
$$;
revoke all on function public.directory_row(public.employees) from public, anon, authenticated;

create or replace function public.directory_search(p_token text, p_q text default '', p_limit int default 25)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(trim(coalesce(p_q, ''))) || '%';
begin
  perform public.directory_check(p_token);
  return coalesce((
    select jsonb_agg(public.directory_row(e) order by (e.status = 'active') desc, e.name)
    from (select * from public.employees e
          where lower(e.name) like q or lower(coalesce(e.email, '')) like q or lower(coalesce(e.department, '')) like q
          order by (e.status = 'active') desc, e.name
          limit least(greatest(coalesce(p_limit, 25), 1), 200)) e), '[]'::jsonb);
end $$;

create or replace function public.directory_get(p_token text, p_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.directory_check(p_token);
  return coalesce((select jsonb_agg(public.directory_row(e)) from public.employees e where e.id = any(p_ids)), '[]'::jsonb);
end $$;

create or replace function public.directory_set_assets(p_token text, p_employee_id uuid, p_assets jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  perform public.directory_check(p_token);
  delete from public.employee_assets where employee_id = p_employee_id
     or asset_id in (select (x->>'id')::uuid from jsonb_array_elements(coalesce(p_assets, '[]'::jsonb)) x);
  if exists (select 1 from public.employees where id = p_employee_id) then
    insert into public.employee_assets (asset_id, employee_id, asset_name, hardware_type, model, serial, status)
    select (x->>'id')::uuid, p_employee_id, x->>'name', x->>'hardware_type', x->>'model', x->>'serial', x->>'status'
    from jsonb_array_elements(coalesce(p_assets, '[]'::jsonb)) x;
    get diagnostics n = row_count;
  end if;
  return n;
end $$;

revoke all on function public.directory_search(text, text, int) from public;
revoke all on function public.directory_get(text, uuid[]) from public;
revoke all on function public.directory_set_assets(text, uuid, jsonb) from public;
grant execute on function public.directory_search(text, text, int) to anon, service_role;
grant execute on function public.directory_get(text, uuid[]) to anon, service_role;
grant execute on function public.directory_set_assets(text, uuid, jsonb) to anon, service_role;

-- Tell the inventory when an employee is offboarded, renamed or deleted.
-- Employees with no equipment are simply ignored by the inventory.
create or replace function public.directory_notify_inventory()
returns trigger language plpgsql security definer set search_path = public, extensions, net as $$
declare ev text; emp uuid; nm text; key text := public.directory_secret('inventory_anon_key');
begin
  if TG_OP = 'DELETE' then
    ev := 'deleted'; emp := OLD.id; nm := OLD.name;
  elsif NEW.status = 'offboarded' and coalesce(OLD.status, '') <> 'offboarded' then
    ev := 'offboarded'; emp := NEW.id; nm := NEW.name;
  elsif NEW.name is distinct from OLD.name then
    ev := 'renamed'; emp := NEW.id; nm := NEW.name;
  else
    return coalesce(NEW, OLD);
  end if;
  if key is null then return coalesce(NEW, OLD); end if;
  perform net.http_post(
    url := 'https://bwzbeojxexupndmqcbzy.supabase.co/rest/v1/rpc/directory_employee_event',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', key, 'Authorization', 'Bearer ' || key),
    body := jsonb_build_object('p_token', public.directory_secret('directory_token'),
                               'p_employee_id', emp, 'p_event', ev, 'p_name', nm, 'p_old_name', OLD.name),
    timeout_milliseconds := 5000);
  return coalesce(NEW, OLD);
end $$;

drop trigger if exists directory_notify_inventory on public.employees;
create trigger directory_notify_inventory
  after update of status, name or delete on public.employees
  for each row execute function public.directory_notify_inventory();
