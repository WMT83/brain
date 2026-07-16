# Meeting Hub

Meeting Hub turns Zoom cloud recordings into searchable, summarised meeting
records. Zoom fires a webhook when a recording finishes. The audio is stored,
transcribed with speaker diarisation, then later summarised and indexed for
search and question answering.

This repo holds the Supabase backend: the database schema, storage, and the
edge functions that run the pipeline.

Supabase project: Meeting Hub, ref `yqpkaigyrtqctvfzhzcl`, org Katalis Co,
region ap-southeast-2 (Sydney).

## Layout

```
supabase/
  config.toml                  project ref and function verify_jwt flags
  migrations/                  schema, applied in filename order
  functions/
    zoom-webhook/              receives Zoom recording.completed, queues a job
    process-jobs/              cron worker, drains the job queue
```

## Milestones

1. Schema, storage, RLS, and the `zoom-webhook` function. Deployed.
2. The `process-jobs` worker and English transcription via Deepgram. This pass.
3. Afrikaans routing. Not started.
4. Summaries. Not started.
5. Upload ingestion. Not started.
6. Search and ask. Not started.
7. The hub UI. Not started.

## The pipeline so far

1. Zoom sends `recording.completed` to `zoom-webhook`. The function verifies the
   signature, inserts a `meetings` row keyed on `zoom_meeting_uuid`, downloads
   the audio into the private `meeting-audio` bucket, and queues a `transcribe`
   job.
2. `process-jobs` runs once a minute. It claims queued jobs with `claim_jobs()`,
   which uses `for update skip locked` so two runs never claim the same job. For
   a `transcribe` job it signs the audio, calls Deepgram (`nova-3`, diarised,
   language detected), writes `utterances` and `meeting_participants`, and moves
   the meeting from `pending_transcription` to `transcribing` to `transcribed`.
   A job that fails is requeued until three attempts, then marked `failed`.

## Function auth

`zoom-webhook` and `process-jobs` both run with `verify_jwt = false`. Zoom sends
its own signature, not a Supabase JWT, and the cron worker is called internally.
User facing functions that arrive later (`search`, `ask`, `ingest-upload`) will
use `verify_jwt = true`.

## Secrets

Set these in the Supabase dashboard. Never commit them.

- `ANTHROPIC_API_KEY` for the summariser (milestone 4).
- `ZOOM_WEBHOOK_SECRET_TOKEN` for the webhook signature check.
- `DEEPGRAM_API_KEY` for transcription.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions by the
  platform.
- `DEFAULT_OWNER_ID` optionally sets the owner on webhook-created meetings.

Anthropic-calling functions use model `claude-sonnet-4-5`.

## The cron schedule

`process-jobs` is invoked every minute by `pg_cron` through `pg_net`. The service
role key is read from Vault, never inlined in the cron command. See
`docs/deploy.md` for the exact statements.

## Conventions

- British and Australian spelling throughout, including comments and docs.
- No em dashes. Short declarative sentences.
- Git identity for anything connected to Vercel Hobby: name `WMT83`, email
  `werner.teichert@gmail.com`.
- Deepgram and Anthropic keys are read from `Deno.env`, never hardcoded.
