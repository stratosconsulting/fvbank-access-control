-- Backups for FV Bank Access Control: a copy is kept here (table backups) and downloaded as JSON.
-- restore_backup() puts the registry back to the state of a backup in one transaction:
--   * applications and employees in the backup get their saved values back (deleted ones come back);
--   * permissions, department defaults and service accounts become exactly what the backup had
--     (people/apps created after the backup are kept, with their current permissions);
--   * audit log entries missing from the current log are added back. Nothing in the log is removed.

create table if not exists public.backups (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  created_at timestamptz not null default now(),
  created_by text,
  counts     jsonb not null default '{}'::jsonb,
  data       jsonb not null
);
alter table public.backups enable row level security;
drop policy if exists "authenticated full access" on public.backups;
create policy "authenticated full access" on public.backups for all to authenticated using (true) with check (true);

create or replace function public.restore_backup(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b_emp uuid[]; n_apps int; n_emps int; n_perms int; n_defs int; n_svc int; n_log int;
begin
  if auth.role() <> 'authenticated' then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_backup->'employees') <> 'array' or jsonb_typeof(p_backup->'apps') <> 'array' then
    raise exception 'This file is not an FV Bank Access backup';
  end if;

  -- Applications: same id -> update; same name but another id (app re-created) -> reuse the current one
  create temp table _appmap (old_id uuid primary key, new_id uuid) on commit drop;
  insert into _appmap
  select (a->>'id')::uuid, coalesce(byid.id, byname.id, (a->>'id')::uuid)
  from jsonb_array_elements(p_backup->'apps') a
  left join apps byid on byid.id = (a->>'id')::uuid
  left join apps byname on byid.id is null and lower(byname.name) = lower(a->>'name');

  insert into apps (id, name, owner, created_at, levels)
  select m.new_id, a->>'name', a->>'owner', coalesce((a->>'created_at')::timestamptz, now()),
         (select array_agg(x) from jsonb_array_elements_text(coalesce(a->'levels', '[]'::jsonb)) x)
  from jsonb_array_elements(p_backup->'apps') a join _appmap m on m.old_id = (a->>'id')::uuid
  on conflict (id) do update set name = excluded.name, owner = excluded.owner, levels = excluded.levels;
  get diagnostics n_apps = row_count;

  insert into employees (id, name, department, status, offboarded_at, offboard_reason, created_at, email, google_2fa_enabled, location)
  select (e->>'id')::uuid, e->>'name', e->>'department', e->>'status', (e->>'offboarded_at')::timestamptz, e->>'offboard_reason',
         coalesce((e->>'created_at')::timestamptz, now()), e->>'email', coalesce((e->>'google_2fa_enabled')::boolean, false), e->>'location'
  from jsonb_array_elements(p_backup->'employees') e
  on conflict (id) do update set name = excluded.name, department = excluded.department, status = excluded.status,
    offboarded_at = excluded.offboarded_at, offboard_reason = excluded.offboard_reason, email = excluded.email,
    google_2fa_enabled = excluded.google_2fa_enabled, location = excluded.location;
  get diagnostics n_emps = row_count;

  -- Permissions of the employees in the backup become exactly the saved ones
  select array_agg((e->>'id')::uuid) into b_emp from jsonb_array_elements(p_backup->'employees') e;
  delete from permissions where employee_id = any(coalesce(b_emp, '{}'));
  insert into permissions (id, employee_id, app_id, level, granted_at, notes)
  select (p->>'id')::uuid, (p->>'employee_id')::uuid, m.new_id, p->>'level', coalesce((p->>'granted_at')::timestamptz, now()), p->>'notes'
  from jsonb_array_elements(coalesce(p_backup->'permissions', '[]'::jsonb)) p
  join _appmap m on m.old_id = (p->>'app_id')::uuid
  where exists (select 1 from employees where id = (p->>'employee_id')::uuid)
  on conflict do nothing;
  get diagnostics n_perms = row_count;

  if p_backup ? 'department_defaults' then
    delete from department_defaults where app_id in (select new_id from _appmap);
    insert into department_defaults (id, department, app_id, level, created_at)
    select (d->>'id')::uuid, d->>'department', m.new_id, d->>'level', coalesce((d->>'created_at')::timestamptz, now())
    from jsonb_array_elements(p_backup->'department_defaults') d join _appmap m on m.old_id = (d->>'app_id')::uuid
    on conflict do nothing;
    get diagnostics n_defs = row_count;
  end if;

  if p_backup ? 'service_accounts' then
    insert into service_accounts (id, name, description, owner, app_id, status, created_at)
    select (s->>'id')::uuid, s->>'name', s->>'description', s->>'owner',
           (select new_id from _appmap where old_id = (s->>'app_id')::uuid), s->>'status', coalesce((s->>'created_at')::timestamptz, now())
    from jsonb_array_elements(p_backup->'service_accounts') s
    on conflict (id) do update set name = excluded.name, description = excluded.description, owner = excluded.owner,
      app_id = excluded.app_id, status = excluded.status;
    get diagnostics n_svc = row_count;
  end if;

  insert into audit_log (id, ts, actor, action, detail)
  select (l->>'id')::uuid, (l->>'ts')::timestamptz, l->>'actor', l->>'action', l->>'detail'
  from jsonb_array_elements(coalesce(p_backup->'audit_log', '[]'::jsonb)) l
  on conflict (id) do nothing;
  get diagnostics n_log = row_count;

  return jsonb_build_object('apps', n_apps, 'employees', n_emps, 'permissions', n_perms,
                            'department_defaults', coalesce(n_defs, 0), 'service_accounts', coalesce(n_svc, 0), 'audit_log', n_log);
end $$;
revoke all on function public.restore_backup(jsonb) from public, anon;
grant execute on function public.restore_backup(jsonb) to authenticated;
