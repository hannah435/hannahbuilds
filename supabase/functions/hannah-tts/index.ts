// "Hannah TTS" — turns a chat reply into spoken audio in Hannah's video voice
// (Edge neural "Ava"). Free, no API key, no quota. The widget's speaker button and
// its voice-call loop POST the reply text here and play back the MP3 that comes out.
//
// Public widget, so deploy with --no-verify-jwt; the origin gate + a length cap are
// the guardrails (there's no secret to protect here — Edge TTS needs no key).
//
// Deploy:  supabase functions deploy hannah-tts --no-verify-jwt

import { synthesize } from "./edge.ts";

// Only these origins may call the function (stops casual abuse from other sites).
const ALLOWED_ORIGINS = [
  "https://hannah435.github.io",
  "https://hannahbuilds.com",
  "https://www.hannahbuilds.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
  "http://localhost:8765",
  "http://127.0.0.1:8765",
];

const MAX_CHARS = 800; // a chat reply is ~35 words; this is a generous ceiling.

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const jsonHeaders = { ...cors, "content-type": "application/json" };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: jsonHeaders });
  }
  // Light origin gate — a browser request from another site is rejected.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: "Not allowed" }), { status: 403, headers: jsonHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    let text = String(body?.text ?? "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "No text provided" }), { status: 400, headers: jsonHeaders });
    }
    if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS);

    const mp3 = await synthesize(text, { rate: "+5%" });

    return new Response(mp3, {
      headers: {
        ...cors,
        "content-type": "audio/mpeg",
        "cache-control": "no-store",
      },
    });
  } catch (err) {
    console.error("hannah-tts error:", err);
    return new Response(JSON.stringify({ error: "Speech failed" }), { status: 500, headers: jsonHeaders });
  }
});
