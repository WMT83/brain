# Deploy notes

Project ref `yqpkaigyrtqctvfzhzcl`. Run these from the Supabase dashboard SQL
editor or via the CLI once linked.

## Current state

Milestone 2 is deployed to the live project.

Done:
- `claim_jobs` migration applied (version 20260716104224).
- `pg_cron` and `pg_net` enabled.
- `process-jobs` function deployed with `verify_jwt = false`.
- The cron job `process-jobs` is scheduled and firing every minute. The
  function has been confirmed reachable and returns `{"ok":true,"claimed":0}`
  on an empty queue.

Still needed before a real meeting can transcribe. Only Werner can do these:
- Set `DEEPGRAM_API_KEY` in Edge Function secrets. Without it every transcribe
  job fails.
- Store the `service_role_key` in Vault (see below). The cron already reads from
  Vault. Until the secret exists the cron still fires, because the function does
  not verify the JWT, but the intended auth is the service key.
- Configure the Zoom Marketplace app so `recording.completed` reaches
  `zoom-webhook`, and set `ZOOM_WEBHOOK_SECRET_TOKEN`.

## Secrets

Set in Dashboard, Project Settings, Edge Functions, Secrets:

- `DEEPGRAM_API_KEY` for `process-jobs`.
- `ZOOM_WEBHOOK_SECRET_TOKEN` for `zoom-webhook`.
- `DEFAULT_OWNER_ID` optional, sets the owner on webhook-created meetings.

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

## Extensions

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

## Store the service role key in Vault

The cron job authenticates to the function with the service role key. Store it in
Vault so it is never written inline in the cron command. Paste the key from
Dashboard, Project Settings, API.

```sql
select vault.create_secret('PASTE_SERVICE_ROLE_KEY_HERE', 'service_role_key');
```

If it already exists, rotate it instead:

```sql
select vault.update_secret(
  (select id from vault.secrets where name = 'service_role_key'),
  'PASTE_SERVICE_ROLE_KEY_HERE'
);
```

## Schedule the worker

```sql
select cron.schedule(
  'process-jobs',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://yqpkaigyrtqctvfzhzcl.supabase.co/functions/v1/process-jobs',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    )
  );
  $$
);
```

To change the schedule, unschedule then reschedule:

```sql
select cron.unschedule('process-jobs');
```

## Verify

Run a short English Zoom meeting through the chain, then check:

```sql
select id, status, language, error from meetings order by created_at desc limit 5;
select status, attempts, error from jobs order by created_at desc limit 5;
select speaker_label, start_ms, end_ms, left(text, 60) from utterances order by start_ms limit 20;
select speaker_label from meeting_participants;
```

The meeting should move `pending_transcription` to `transcribing` to
`transcribed`. No row should stay stuck in `running` or `transcribing`.
