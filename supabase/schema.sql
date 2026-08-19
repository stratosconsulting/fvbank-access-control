-- FV Bank — Registro de Accesos
-- Pega esto completo en Supabase → SQL Editor → New query → Run

create extension if not exists "pgcrypto";

-- ============================================================
-- TABLAS
-- ============================================================

create table if not exists apps (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  owner text,
  created_at timestamptz not null default now()
);

create table if not exists employees (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  department text,
  status text not null default 'active' check (status in ('active', 'offboarded')),
  offboarded_at timestamptz,
  offboard_reason text,
  created_at timestamptz not null default now()
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id) on delete cascade,
  app_id uuid not null references apps(id) on delete cascade,
  level text not null,
  granted_at timestamptz not null default now(),
  unique (employee_id, app_id)
);

-- Bitácora que la app escribe explícitamente (mensajes legibles, "Se agregó a Juan...")
create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  actor text not null,
  action text not null,
  detail text not null
);

-- Bitácora "cruda" a nivel de base de datos: se llena SOLA vía trigger,
-- la app nunca escribe aquí directamente. Sirve de respaldo aunque
-- alguien escriba directo a la base de datos por fuera de la app.
create table if not exists audit_log_raw (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  table_name text not null,
  operation text not null,
  actor text,
  row_id uuid,
  old_data jsonb,
  new_data jsonb
);

-- ============================================================
-- TRIGGER: audit_log_raw se llena automáticamente
-- ============================================================

create or replace function fn_audit_raw() returns trigger as $$
declare
  actor_email text;
begin
  begin
    actor_email := auth.jwt() ->> 'email';
  exception when others then
    actor_email := null;
  end;

  if (tg_op = 'DELETE') then
    insert into audit_log_raw (table_name, operation, actor, row_id, old_data, new_data)
    values (tg_table_name, tg_op, actor_email, old.id, to_jsonb(old), null);
    return old;
  elsif (tg_op = 'UPDATE') then
    insert into audit_log_raw (table_name, operation, actor, row_id, old_data, new_data)
    values (tg_table_name, tg_op, actor_email, new.id, to_jsonb(old), to_jsonb(new));
    return new;
  else
    insert into audit_log_raw (table_name, operation, actor, row_id, old_data, new_data)
    values (tg_table_name, tg_op, actor_email, new.id, null, to_jsonb(new));
    return new;
  end if;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_audit_employees on employees;
create trigger trg_audit_employees
  after insert or update or delete on employees
  for each row execute function fn_audit_raw();

drop trigger if exists trg_audit_permissions on permissions;
create trigger trg_audit_permissions
  after insert or update or delete on permissions
  for each row execute function fn_audit_raw();

drop trigger if exists trg_audit_apps on apps;
create trigger trg_audit_apps
  after insert or update or delete on apps
  for each row execute function fn_audit_raw();

-- ============================================================
-- ROW LEVEL SECURITY
-- v1: cualquier usuario autenticado (los que crees en Authentication -> Users)
-- puede leer y escribir todo. No hay acceso público/anónimo.
-- Si más adelante quieres roles distintos (ej. solo lectura para
-- ciertos usuarios), aquí es donde se ajustan las políticas.
-- ============================================================

alter table apps enable row level security;
alter table employees enable row level security;
alter table permissions enable row level security;
alter table audit_log enable row level security;
alter table audit_log_raw enable row level security;

drop policy if exists "authenticated full access" on apps;
create policy "authenticated full access" on apps
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on employees;
create policy "authenticated full access" on employees
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on permissions;
create policy "authenticated full access" on permissions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

drop policy if exists "authenticated full access" on audit_log;
create policy "authenticated full access" on audit_log
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- audit_log_raw: todos los autenticados pueden LEER (para investigar),
-- pero nadie puede insertar/editar/borrar directo -- solo el trigger
-- (que corre como security definer) puede escribir aquí.
drop policy if exists "authenticated read only" on audit_log_raw;
create policy "authenticated read only" on audit_log_raw
  for select using (auth.role() = 'authenticated');
