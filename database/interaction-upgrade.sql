-- Moment interaction upgrade
-- Safe to run on an existing project. It preserves all current data.

-- Memory updates are already owner-checked by memories_owner_all. The trigger
-- needs definer rights only to write the immutable history row, because clients
-- intentionally have no direct INSERT policy on memory_versions.
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

revoke all on function public.capture_memory_version() from public;

-- Ensure existing deployments have the policies required by the interactive UI.
drop policy if exists future_letters_owner_all on public.future_letters;
create policy future_letters_owner_all on public.future_letters
  for all using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Keep deleted memories recoverable for 30 days; permanent deletion remains an
-- explicit owner action in the UI.
create index if not exists memories_trashed_cleanup_idx
  on public.memories(user_id, trashed_at)
  where status = 'trashed';
