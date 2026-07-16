create extension if not exists vector;

insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

create table meetings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  zoom_meeting_uuid text unique,
  zoom_recording_id text,
  topic text,
  source text not null default 'zoom',
  upload_filename text,
  upload_format text,
  language text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds int,
  host_email text,
  audio_path text,
  status text not null default 'pending_transcription',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table meeting_participants (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  name text,
  email text,
  speaker_label text
);

create table utterances (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  speaker_label text,
  start_ms int,
  end_ms int,
  text text not null,
  language text,
  fts tsvector generated always as (to_tsvector('simple', text)) stored
);
create index utterances_fts_idx on utterances using gin (fts);
create index utterances_meeting_start_idx on utterances (meeting_id, start_ms);

create table utterance_embeddings (
  utterance_id uuid primary key references utterances(id) on delete cascade,
  meeting_id uuid not null references meetings(id) on delete cascade,
  embedding vector(1536)
);
create index utterance_embeddings_idx
  on utterance_embeddings using ivfflat (embedding vector_cosine_ops);

create table summaries (
  meeting_id uuid primary key references meetings(id) on delete cascade,
  overview text,
  bullets jsonb,
  decisions jsonb,
  topics jsonb,
  summary_language text default 'en',
  model text,
  created_at timestamptz not null default now()
);

create table action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  description text not null,
  owner_hint text,
  due_hint text,
  status text default 'open',
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid references meetings(id) on delete cascade,
  type text not null,
  status text not null default 'queued',
  attempts int default 0,
  error text,
  created_at timestamptz not null default now()
);
create index jobs_status_idx on jobs (status, created_at);

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger meetings_set_updated_at
  before update on meetings
  for each row execute function set_updated_at();

alter table meetings enable row level security;
alter table meeting_participants enable row level security;
alter table utterances enable row level security;
alter table utterance_embeddings enable row level security;
alter table summaries enable row level security;
alter table action_items enable row level security;
alter table jobs enable row level security;

create policy own_meetings on meetings
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy own_participants on meeting_participants
  for all to authenticated
  using (exists (select 1 from meetings m
                 where m.id = meeting_participants.meeting_id and m.owner_id = auth.uid()));

create policy own_utterances on utterances
  for all to authenticated
  using (exists (select 1 from meetings m
                 where m.id = utterances.meeting_id and m.owner_id = auth.uid()));

create policy own_utterance_embeddings on utterance_embeddings
  for all to authenticated
  using (exists (select 1 from meetings m
                 where m.id = utterance_embeddings.meeting_id and m.owner_id = auth.uid()));

create policy own_summaries on summaries
  for all to authenticated
  using (exists (select 1 from meetings m
                 where m.id = summaries.meeting_id and m.owner_id = auth.uid()));

create policy own_action_items on action_items
  for all to authenticated
  using (exists (select 1 from meetings m
                 where m.id = action_items.meeting_id and m.owner_id = auth.uid()));
