// Meeting Hub :: process-jobs
// Cron-driven worker. Deploy with verify_jwt = false (invoked by pg_cron via
// pg_net with the service role key, not a user JWT).
//
// Milestone 2: drains queued `transcribe` jobs and produces diarised utterances
// for English meetings via Deepgram. Afrikaans routing is milestone 3 and is not
// attempted here. The worker is idempotent and safe to run every minute with no
// jobs waiting.

import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY")!;
const BUCKET = "meeting-audio";

// How many jobs to claim per run. One meeting per run keeps a single invocation
// well inside the edge function wall-clock budget. Raise if the queue backs up.
const BATCH_SIZE = Number(Deno.env.get("PROCESS_JOBS_BATCH") ?? "1");
const MAX_ATTEMPTS = 3;

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Job {
  id: string;
  meeting_id: string | null;
  type: string;
  status: string;
  attempts: number;
}

// Claim a batch of queued jobs atomically. Backed by the claim_jobs() SQL
// function which uses FOR UPDATE SKIP LOCKED so two concurrent runs never claim
// the same row. The function flips each claimed row to 'running' and bumps
// attempts, then returns the claimed rows.
async function claimJobs(n: number): Promise<Job[]> {
  const { data, error } = await admin.rpc("claim_jobs", { batch_size: n });
  if (error) throw new Error(`claim_jobs failed: ${error.message}`);
  return (data ?? []) as Job[];
}

// Requeue a failed job for a later run, or give up once attempts hit the cap.
// attempts was already incremented when the job was claimed.
async function requeueOrFail(job: Job, message: string): Promise<void> {
  if (job.attempts < MAX_ATTEMPTS) {
    // Short backoff: leave it queued but stamp the reason. created_at ordering
    // means it is retried after fresher work, which is the backoff we want here.
    await admin
      .from("jobs")
      .update({ status: "queued", error: message })
      .eq("id", job.id);
  } else {
    await admin
      .from("jobs")
      .update({ status: "failed", error: message })
      .eq("id", job.id);
  }
}

interface DeepgramUtterance {
  start: number;
  end: number;
  transcript: string;
  speaker?: number;
  language?: string;
}

// Call the Deepgram prerecorded API on a signed audio URL. This is the English
// path: detect_language lets Deepgram report the spoken language, and nova-3
// gives diarised, punctuated utterances.
async function transcribeWithDeepgram(audioUrl: string): Promise<{
  utterances: DeepgramUtterance[];
  detectedLanguage: string | null;
}> {
  const params = new URLSearchParams({
    model: "nova-3",
    diarize: "true",
    punctuate: "true",
    utterances: "true",
    detect_language: "true",
  });
  const res = await fetch(
    `https://api.deepgram.com/v1/listen?${params.toString()}`,
    {
      method: "POST",
      headers: {
        Authorization: `Token ${DEEPGRAM_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url: audioUrl }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Deepgram error ${res.status}: ${detail.slice(0, 500)}`);
  }
  const body = await res.json();

  const utterances: DeepgramUtterance[] = body?.results?.utterances ?? [];
  const channel = body?.results?.channels?.[0] ?? {};
  const detectedLanguage: string | null =
    channel.detected_language ??
    channel.alternatives?.[0]?.languages?.[0] ??
    null;

  return { utterances, detectedLanguage };
}

async function handleTranscribe(job: Job): Promise<void> {
  if (!job.meeting_id) throw new Error("transcribe job has no meeting_id");
  const meetingId = job.meeting_id;

  // Load the meeting and mark it transcribing.
  const { data: meeting, error: mErr } = await admin
    .from("meetings")
    .select("id, audio_path")
    .eq("id", meetingId)
    .single();
  if (mErr || !meeting) throw new Error(`meeting ${meetingId} not found`);
  if (!meeting.audio_path) throw new Error("meeting has no audio_path");

  await admin
    .from("meetings")
    .update({ status: "transcribing", error: null })
    .eq("id", meetingId);

  // Signed URL so Deepgram can pull the private object directly.
  const { data: signed, error: sErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(meeting.audio_path, 60 * 60);
  if (sErr || !signed?.signedUrl) {
    throw new Error(`could not sign audio url: ${sErr?.message ?? "unknown"}`);
  }

  const { utterances, detectedLanguage } = await transcribeWithDeepgram(
    signed.signedUrl,
  );

  if (utterances.length === 0) {
    throw new Error("Deepgram returned no utterances");
  }

  // Map Deepgram utterances to rows. Clear any prior utterances first so a retry
  // does not double-insert.
  await admin.from("utterances").delete().eq("meeting_id", meetingId);

  const rows = utterances.map((u) => ({
    meeting_id: meetingId,
    speaker_label: `Speaker ${u.speaker ?? 0}`,
    start_ms: Math.round((u.start ?? 0) * 1000),
    end_ms: Math.round((u.end ?? 0) * 1000),
    text: u.transcript ?? "",
    language: u.language ?? detectedLanguage,
  }));
  const { error: uErr } = await admin.from("utterances").insert(rows);
  if (uErr) throw new Error(`utterance insert failed: ${uErr.message}`);

  // Distinct speakers become participants. Refresh them on retry too.
  const speakerLabels = [...new Set(rows.map((r) => r.speaker_label))];
  await admin.from("meeting_participants").delete().eq("meeting_id", meetingId);
  const { error: pErr } = await admin.from("meeting_participants").insert(
    speakerLabels.map((label) => ({
      meeting_id: meetingId,
      speaker_label: label,
    })),
  );
  if (pErr) throw new Error(`participant insert failed: ${pErr.message}`);

  // Finalise the meeting and the job.
  await admin
    .from("meetings")
    .update({ status: "transcribed", language: detectedLanguage })
    .eq("id", meetingId);
  await admin.from("jobs").update({ status: "done", error: null }).eq("id", job.id);
}

async function runJob(job: Job): Promise<{ id: string; result: string }> {
  try {
    if (job.type === "transcribe") {
      await handleTranscribe(job);
      return { id: job.id, result: "done" };
    }
    // Unknown job types are milestones 3 to 6. Leave them for a worker that
    // understands them rather than failing them.
    await admin
      .from("jobs")
      .update({ status: "queued", error: `unsupported type: ${job.type}` })
      .eq("id", job.id);
    return { id: job.id, result: "skipped" };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (job.meeting_id) {
      await admin
        .from("meetings")
        .update({ status: "failed", error: message })
        .eq("id", job.meeting_id);
    }
    await requeueOrFail(job, message);
    return { id: job.id, result: `failed: ${message}` };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let claimed: Job[];
  try {
    claimed = await claimJobs(BATCH_SIZE);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("claim failed", message);
    return json({ ok: false, error: message }, 500);
  }

  if (claimed.length === 0) {
    return json({ ok: true, claimed: 0, results: [] });
  }

  const results = [];
  for (const job of claimed) {
    results.push(await runJob(job));
  }

  console.log(`processed ${results.length} job(s)`, results);
  return json({ ok: true, claimed: claimed.length, results });
});
