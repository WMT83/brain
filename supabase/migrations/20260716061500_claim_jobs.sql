-- Milestone 2 worker support.
-- claim_jobs() atomically claims a batch of queued jobs for the process-jobs
-- worker. FOR UPDATE SKIP LOCKED means two concurrent cron runs never claim the
-- same row: the second run skips rows the first has already locked. Each claimed
-- row is flipped to 'running' with attempts bumped, then returned.

create or replace function public.claim_jobs(batch_size integer default 1)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  update public.jobs j
  set status = 'running',
      attempts = j.attempts + 1
  where j.id in (
    select id
    from public.jobs
    where status = 'queued'
    order by created_at
    limit batch_size
    for update skip locked
  )
  returning j.*;
$$;

-- The worker authenticates with the service role key, so only that role runs
-- this. Do not expose it to anon or authenticated.
revoke all on function public.claim_jobs(integer) from public;
revoke all on function public.claim_jobs(integer) from anon;
revoke all on function public.claim_jobs(integer) from authenticated;
grant execute on function public.claim_jobs(integer) to service_role;
