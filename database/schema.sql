-- Moment / 片刻 — Supabase PostgreSQL schema
-- Apply in a fresh Supabase project through a tracked migration.

create extension if not exists pgcrypto;
create extension if not exists vector;

create type public.memory_status as enum ('active', 'archived', 'trashed');
create type public.media_kind as enum ('image', 'video');
create type public.media_processing_status as enum ('pending', 'processing', 'ready', 'failed');
create type public.fixed_mood as enum ('happy', 'calm', 'sad', 'healed', 'excited', 'empty');
create type public.share_access as enum ('view', 'view_download');
create type public.job_status as enum ('queued', 'processing', 'completed', 'failed', 'expired');
create type public.letter_status as enum ('sealed', 'unlocked', 'opened', 'deleted');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text,
  display_name text,
  timezone text not null default 'Asia/Shanghai',
  locale text not null default 'zh-CN',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (username is null or char_length(username) between 2 and 32)
);

create unique index profiles_username_unique
  on public.profiles (lower(username)) where username is not null;

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '',
  event_at timestamptz not null,
  event_timezone text not null default 'Asia/Shanghai',
  location_name text,
  location_latitude numeric(9,6),
  location_longitude numeric(9,6),
  fixed_mood public.fixed_mood,
  custom_mood text,
  status public.memory_status not null default 'active',
  hidden_from_recall boolean not null default false,
  archived_at timestamptz,
  trashed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint memories_content_length check (char_length(content) <= 20000),
  constraint memories_custom_mood_length check (custom_mood is null or char_length(custom_mood) <= 40),
  constraint memories_location_pair check (
    (location_latitude is null and location_longitude is null)
    or (location_latitude is not null and location_longitude is not null)
  ),
  constraint memories_status_timestamps check (
    (status <> 'archived' or archived_at is not null)
    and (status <> 'trashed' or trashed_at is not null)
  )
);

create index memories_user_event_idx on public.memories(user_id, event_at desc);
create index memories_user_status_event_idx on public.memories(user_id, status, event_at desc);
create index memories_user_location_idx on public.memories(user_id, lower(location_name));
create index memories_content_fts_idx on public.memories
  using gin (to_tsvector('simple', coalesce(content, '')));

create table public.memory_versions (
  id bigint generated always as identity primary key,
  memory_id uuid not null references public.memories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null,
  change_source text not null default 'user',
  created_at timestamptz not null default now(),
  unique(memory_id, version)
);

create index memory_versions_memory_idx on public.memory_versions(memory_id, version desc);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id uuid references public.memories(id) on delete cascade,
  kind public.media_kind not null,
  original_object_key text not null,
  display_object_key text,
  thumbnail_object_key text,
  original_filename text,
  mime_type text not null,
  byte_size bigint not null,
  width integer,
  height integer,
  duration_seconds numeric(10,3),
  exif_taken_at timestamptz,
  exif_timezone text,
  sort_order integer not null default 0,
  processing_status public.media_processing_status not null default 'pending',
  processing_error_code text,
  alt_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint media_positive_size check (byte_size > 0),
  constraint media_video_limit check (kind <> 'video' or byte_size <= 524288000),
  constraint media_dimensions check (
    (width is null or width > 0) and (height is null or height > 0)
  ),
  unique(user_id, original_object_key)
);

create index media_memory_sort_idx on public.media_assets(memory_id, sort_order, created_at);
create index media_processing_idx on public.media_assets(processing_status, created_at);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(btrim(name))) stored,
  created_at timestamptz not null default now(),
  constraint tags_name_length check (char_length(btrim(name)) between 1 and 40),
  unique(user_id, normalized_name)
);

create table public.memory_tags (
  memory_id uuid not null references public.memories(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(memory_id, tag_id)
);

create index memory_tags_user_tag_idx on public.memory_tags(user_id, tag_id);

create table public.memory_embeddings (
  memory_id uuid primary key references public.memories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  embedding vector(1536),
  source_hash text not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memory_embeddings_user_idx on public.memory_embeddings(user_id);

create table public.recall_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_id uuid not null references public.memories(id) on delete cascade,
  surfaced_at timestamptz not null default now(),
  opened boolean not null default false,
  dismissed boolean not null default false
);

create index recall_events_user_recent_idx on public.recall_events(user_id, surfaced_at desc);

create table public.memory_shares (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  access public.share_access not null default 'view',
  password_hash text,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_accessed_at timestamptz,
  constraint share_future_expiry check (expires_at > created_at)
);

create index memory_shares_owner_idx on public.memory_shares(user_id, created_at desc);

create table public.future_letters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  content_ciphertext text not null,
  unlock_at timestamptz not null,
  status public.letter_status not null default 'sealed',
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint letter_unlock_after_create check (unlock_at > created_at)
);

create index future_letters_user_unlock_idx on public.future_letters(user_id, unlock_at);

create table public.annual_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year smallint not null,
  status public.job_status not null default 'queued',
  statistics jsonb not null default '{}'::jsonb,
  narrative jsonb not null default '{}'::jsonb,
  excluded_memory_ids uuid[] not null default '{}',
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint annual_review_year check (year between 1900 and 2200),
  unique(user_id, year)
);

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  status public.job_status not null default 'queued',
  object_key text,
  expires_at timestamptz,
  error_code text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index export_jobs_user_idx on public.export_jobs(user_id, requested_at desc);

create table public.audit_events (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  target_type text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_user_idx on public.audit_events(user_id, created_at desc);

-- Keep updated_at deterministic.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger memories_set_updated_at before update on public.memories
for each row execute function public.set_updated_at();
create trigger media_assets_set_updated_at before update on public.media_assets
for each row execute function public.set_updated_at();
create trigger memory_embeddings_set_updated_at before update on public.memory_embeddings
for each row execute function public.set_updated_at();
create trigger future_letters_set_updated_at before update on public.future_letters
for each row execute function public.set_updated_at();
create trigger annual_reviews_set_updated_at before update on public.annual_reviews
for each row execute function public.set_updated_at();

-- Save the old structured state before each meaningful memory update.
create or replace function public.capture_memory_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (to_jsonb(old) - 'updated_at') is distinct from (to_jsonb(new) - 'updated_at') then
    insert into public.memory_versions(memory_id, user_id, version, snapshot)
    values (old.id, old.user_id, old.version, to_jsonb(old));
    new.version = old.version + 1;
  end if;
  return new;
end;
$$;

create trigger memories_capture_version
before update on public.memories
for each row execute function public.capture_memory_version();

-- Validate denormalized ownership columns used by RLS and fast filtering.
create or replace function public.validate_memory_tag_ownership()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.memories m
    where m.id = new.memory_id and m.user_id = new.user_id
  ) or not exists (
    select 1 from public.tags t
    where t.id = new.tag_id and t.user_id = new.user_id
  ) then
    raise exception 'memory and tag must belong to the same user';
  end if;
  return new;
end;
$$;

create trigger memory_tags_validate_owner
before insert or update on public.memory_tags
for each row execute function public.validate_memory_tag_ownership();

-- Create a profile when an auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- RLS: every private row is owner-scoped. Service-role workers bypass RLS and
-- must still validate ownership before processing object keys.
alter table public.profiles enable row level security;
alter table public.memories enable row level security;
alter table public.memory_versions enable row level security;
alter table public.media_assets enable row level security;
alter table public.tags enable row level security;
alter table public.memory_tags enable row level security;
alter table public.memory_embeddings enable row level security;
alter table public.recall_events enable row level security;
alter table public.memory_shares enable row level security;
alter table public.future_letters enable row level security;
alter table public.annual_reviews enable row level security;
alter table public.export_jobs enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_owner_all on public.profiles
  for all using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);
create policy memories_owner_all on public.memories
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy memory_versions_owner_read on public.memory_versions
  for select using ((select auth.uid()) = user_id);
create policy media_assets_owner_all on public.media_assets
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy tags_owner_all on public.tags
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy memory_tags_owner_all on public.memory_tags
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy memory_embeddings_owner_read on public.memory_embeddings
  for select using ((select auth.uid()) = user_id);
create policy recall_events_owner_all on public.recall_events
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy memory_shares_owner_all on public.memory_shares
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy future_letters_owner_all on public.future_letters
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy annual_reviews_owner_read on public.annual_reviews
  for select using ((select auth.uid()) = user_id);
create policy export_jobs_owner_read on public.export_jobs
  for select using ((select auth.uid()) = user_id);
create policy export_jobs_owner_insert on public.export_jobs
  for insert with check ((select auth.uid()) = user_id);
create policy audit_events_owner_read on public.audit_events
  for select using ((select auth.uid()) = user_id);

-- Storage bucket setup. Keep the bucket private and use paths beginning with
-- the authenticated user's UUID: <user-id>/<asset-id>/<variant>.<ext>
insert into storage.buckets(id, name, public, file_size_limit)
values ('memory-media', 'memory-media', false, 524288000)
on conflict (id) do update set public = false, file_size_limit = 524288000;

create policy memory_storage_owner_select on storage.objects
  for select to authenticated
  using (bucket_id = 'memory-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy memory_storage_owner_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'memory-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy memory_storage_owner_update on storage.objects
  for update to authenticated
  using (bucket_id = 'memory-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'memory-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy memory_storage_owner_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'memory-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Useful first-stage feed query:
-- select m.*, coalesce(jsonb_agg(a order by a.sort_order)
--   filter (where a.id is not null), '[]'::jsonb) as media
-- from public.memories m
-- left join public.media_assets a on a.memory_id = m.id
-- where m.user_id = auth.uid() and m.status = 'active'
-- group by m.id
-- order by m.event_at desc
-- limit 20;
