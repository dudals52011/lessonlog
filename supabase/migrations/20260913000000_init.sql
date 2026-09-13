-- 레슨런 메모앱 동기화 스키마
-- 인증 없이 "동기화 코드"로 워크스페이스를 식별한다. 테이블은 RLS로 잠그고,
-- 모든 접근은 SECURITY DEFINER 함수(코드 해시 검증)로만 이뤄진다.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_opened_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

create table if not exists public.entries (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  note_id uuid not null,
  body text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default clock_timestamp()
);

create index if not exists notes_ws_synced on public.notes (workspace_id, synced_at);
create index if not exists entries_ws_synced on public.entries (workspace_id, synced_at);

alter table public.workspaces enable row level security;
alter table public.notes enable row level security;
alter table public.entries enable row level security;
-- 정책 없음 = anon/authenticated는 테이블 직접 접근 불가

revoke all on public.workspaces, public.notes, public.entries from anon, authenticated;

-- 코드 정규화 + 해시. 클라이언트와 동일 규칙: 영숫자만 남기고 대문자.
create or replace function public.ws_hash(p_code text)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex');
$$;

create or replace function public.ws_lookup(p_code text)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if length(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) <> 24 then
    return null;
  end if;
  select id into v_id from public.workspaces where code_hash = public.ws_hash(p_code);
  return v_id;
end;
$$;

-- 새 워크스페이스. 이미 있으면 false.
create or replace function public.ws_create(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if length(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) <> 24 then
    raise exception 'invalid code';
  end if;
  insert into public.workspaces (code_hash) values (public.ws_hash(p_code))
  on conflict (code_hash) do nothing;
  return found;
end;
$$;

create or replace function public.ws_exists(p_code text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.ws_lookup(p_code) is not null;
$$;

-- 보류 행 업서트. 행 단위 LWW: 들어온 updated_at이 더 늦을 때만 덮어씀.
create or replace function public.sync_push(p_code text, p_notes jsonb default '[]'::jsonb, p_entries jsonb default '[]'::jsonb)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_now timestamptz := clock_timestamp();
begin
  v_ws := public.ws_lookup(p_code);
  if v_ws is null then
    raise exception 'workspace not found';
  end if;

  insert into public.notes (id, workspace_id, title, created_at, updated_at, last_opened_at, deleted_at, synced_at)
  select r.id, v_ws, r.title, r.created_at, r.updated_at, r.last_opened_at, r.deleted_at, v_now
  from jsonb_to_recordset(coalesce(p_notes, '[]'::jsonb)) as r(
    id uuid, title text, created_at timestamptz, updated_at timestamptz, last_opened_at timestamptz, deleted_at timestamptz)
  on conflict (id) do update set
    title = excluded.title,
    updated_at = excluded.updated_at,
    last_opened_at = excluded.last_opened_at,
    deleted_at = excluded.deleted_at,
    synced_at = excluded.synced_at
  where public.notes.workspace_id = excluded.workspace_id
    and excluded.updated_at > public.notes.updated_at;

  insert into public.entries (id, workspace_id, note_id, body, created_at, updated_at, deleted_at, synced_at)
  select r.id, v_ws, r.note_id, r.body, r.created_at, r.updated_at, r.deleted_at, v_now
  from jsonb_to_recordset(coalesce(p_entries, '[]'::jsonb)) as r(
    id uuid, note_id uuid, body text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz)
  on conflict (id) do update set
    body = excluded.body,
    updated_at = excluded.updated_at,
    deleted_at = excluded.deleted_at,
    synced_at = excluded.synced_at
  where public.entries.workspace_id = excluded.workspace_id
    and excluded.updated_at > public.entries.updated_at;

  return v_now;
end;
$$;

-- p_since 이후 서버에 반영된 행. 다음 호출의 since로 쓸 server_time을 함께 돌려준다.
create or replace function public.sync_pull(p_code text, p_since timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_now timestamptz := clock_timestamp();
  v_since timestamptz := coalesce(p_since, '-infinity'::timestamptz);
  v_notes jsonb;
  v_entries jsonb;
begin
  v_ws := public.ws_lookup(p_code);
  if v_ws is null then
    raise exception 'workspace not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id, 'title', n.title, 'created_at', n.created_at, 'updated_at', n.updated_at,
    'last_opened_at', n.last_opened_at, 'deleted_at', n.deleted_at)), '[]'::jsonb)
  into v_notes
  from public.notes n where n.workspace_id = v_ws and n.synced_at > v_since;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'note_id', e.note_id, 'body', e.body, 'created_at', e.created_at,
    'updated_at', e.updated_at, 'deleted_at', e.deleted_at)), '[]'::jsonb)
  into v_entries
  from public.entries e where e.workspace_id = v_ws and e.synced_at > v_since;

  return jsonb_build_object('server_time', v_now, 'notes', v_notes, 'entries', v_entries);
end;
$$;

revoke all on function public.ws_hash(text) from public;
revoke all on function public.ws_lookup(text) from public;
grant execute on function public.ws_create(text) to anon;
grant execute on function public.ws_exists(text) to anon;
grant execute on function public.sync_push(text, jsonb, jsonb) to anon;
grant execute on function public.sync_pull(text, timestamptz) to anon;
