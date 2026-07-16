// Meeting Hub :: zoom-webhook
// Deploy with verify_jwt = false (Zoom sends no Supabase JWT).

import { createClient } from "jsr:@supabase/supabase-js@2";

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };

const SECRET = Deno.env.get("ZOOM_WEBHOOK_SECRET_TOKEN")!;
const DEFAULT_OWNER_ID = Deno.env.get("DEFAULT_OWNER_ID") ?? null;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "meeting-audio";

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const enc = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const raw = await req.text();
  let body: Record<string, any>;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // 1. CRC validation handshake.
  if (body.event === "endpoint.url_validation") {
    const plainToken = body.payload?.plainToken ?? "";
    const encryptedToken = await hmacHex(SECRET, plainToken);
    return json({ plainToken, encryptedToken });
  }

  // 2. Verify signature and reject stale requests.
  const sig = req.headers.get("x-zm-signature") ?? "";
  const ts = req.headers.get("x-zm-request-timestamp") ?? "";
  const tsMs = Number(ts) * 1000;
  if (!ts || Number.isNaN(tsMs) || Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
    return new Response("Stale timestamp", { status: 401 });
  }
  const expected = "v0=" + (await hmacHex(SECRET, `v0:${ts}:${raw}`));
  if (!timingSafeEqual(sig, expected)) {
    return new Response("Invalid signature", { status: 401 });
  }

  // 3. Only act on recording.completed.
  if (body.event !== "recording.completed") {
    return new Response("Ignored", { status: 200 });
  }

  const obj = body.payload?.object ?? {};
  const downloadToken: string | undefined = body.download_token;
  const files: any[] = obj.recording_files ?? [];

  const audio =
    files.find((f) => f.file_type === "M4A" && f.recording_type === "audio_only") ??
    files.find((f) => f.file_type === "M4A") ??
    files.find((f) => f.file_type === "MP4");

  const startTime = obj.start_time ? new Date(obj.start_time).toISOString() : null;
  const durationSec = typeof obj.duration === "number" ? obj.duration * 60 : null;

  const { data: existing } = await admin
    .from("meetings")
    .select("id")
    .eq("zoom_meeting_uuid", obj.uuid)
    .maybeSingle();

  if (existing?.id) {
    return new Response("Duplicate ignored", { status: 200 });
  }

  const { data: inserted, error: insErr } = await admin
    .from("meetings")
    .insert({
      owner_id: DEFAULT_OWNER_ID,
      zoom_meeting_uuid: obj.uuid,
      zoom_recording_id: obj.id ? String(obj.id) : null,
      topic: obj.topic ?? null,
      source: "zoom",
      language: "auto",
      started_at: startTime,
      duration_seconds: durationSec,
      host_email: obj.host_email ?? null,
      status: "pending_transcription",
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("insert meeting failed", insErr);
    return new Response("DB error", { status: 500 });
  }

  const meetingId = inserted.id as string;

  const task = (async () => {
    try {
      if (!audio?.download_url) throw new Error("no audio file in recording payload");
      const url = downloadToken
        ? `${audio.download_url}?access_token=${downloadToken}`
        : audio.download_url;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const ext = String(audio.file_extension ?? audio.file_type ?? "m4a").toLowerCase();
      const path = `${meetingId}/source.${ext}`;
      const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(path, bytes, {
          contentType: audio.file_type === "MP4" ? "video/mp4" : "audio/mp4",
          upsert: true,
        });
      if (upErr) throw upErr;
      await admin
        .from("meetings")
        .update({ audio_path: path, upload_format: "audio" })
        .eq("id", meetingId);
      await admin.from("jobs").insert({
        meeting_id: meetingId,
        type: "transcribe",
        status: "queued",
      });
      console.log(`stored audio for ${meetingId} at ${path}, transcribe queued`);
    } catch (e) {
      console.error("audio fetch/store failed", e);
      await admin
        .from("meetings")
        .update({ status: "failed", error: String(e) })
        .eq("id", meetingId);
    }
  })();

  EdgeRuntime.waitUntil(task);

  return json({ ok: true, meetingId });
});
