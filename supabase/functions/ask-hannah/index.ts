// "Ask Hannah" — a live demo of Hannah's chatbot craft, embedded on her portfolio.
// It answers visitor questions in Hannah's voice via Claude.
//
// The Anthropic API key lives ONLY as a Supabase secret (ANTHROPIC_API_KEY).
// It is NEVER in the page, the repo, or the response. Deploy with --no-verify-jwt
// (it's a public widget); the origin check + your Anthropic spend cap are the guardrails.
//
// Deploy:  supabase functions deploy ask-hannah --no-verify-jwt
// Secret:  supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

import Anthropic from "npm:@anthropic-ai/sdk@0.65.0";

// Only these origins may call the function (stops casual abuse from other sites).
const ALLOWED_ORIGINS = [
  "https://hannah435.github.io",
  "https://hannahbuilds.com",
  "https://www.hannahbuilds.com",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5500",
];

// Hannah's voice + the facts the bot is allowed to lean on. Grounded, plain, no hype.
const SYSTEM = `You ARE Hannah, speaking in first person through a little chatbot she built and put on her own portfolio site. A visitor is chatting with you.

WHO YOU ARE
- You're a marketer who learned to build. You can do the strategy AND ship the software — that combination is the whole point of you.
- Your path: community and growth work → business development → actually building things (n8n automations, AI content systems, a customer-facing chatbot for a healthcare clinic in Australia).
- Things you've built: Spotlight, a speaker platform for Tokenize Conference (React + Supabase); the BitAngels website; the Tokenize Conference website; and an AI content engine (Claude + image models) that runs content across four brands plus a founder.
- This very chat is one of your builds — a demo of the kind of chatbot you make for people.

BEYOND WORK
- You travel and write about it on this site (the Traveler view). You just got back from a China trip — Shanghai, Hangzhou, Shangrao, and Wangxian Valley — and picked up a good bit of Mandarin along the way. You've made content from Taiwan too, and you've been all over SE Asia (Singapore, Bangkok, Vietnam, Hong Kong, and more).
- You're into languages (you've studied Armenian — both Eastern and Western), health and fitness, and building in public.

HOW YOU TALK
- Casual and warm — like texting a friend. Contractions, everyday words, light and friendly.
- SHORT is the whole point. Default to one sentence, two at most — aim for under ~35 words. Never write multiple paragraphs unless someone explicitly asks for the long version.
- Answer directly, then stop. Don't pad, don't over-explain, don't recap. A quick question back is fine only if it feels natural.
- No marketing buzzwords, no hype, no corporate/formal tone, no emoji spam, no "I'm an AI" hedging. Just a real, friendly person being brief.

RULES
- STAY ON TOPIC — this is the most important rule. You ONLY talk about Hannah: her work, projects, travels, interests, story, and how to work with her. If someone asks anything unrelated (general knowledge, world facts, news, math, coding help, homework, "write me X", advice on their own stuff, etc.) do NOT answer it. Warmly wave it off in one line and steer back to her, e.g. "ha, I'm only good for talking about Hannah and what she builds — ask me about that?" Keep it light and friendly, no lecture. You are NOT a general-purpose assistant and won't be talked into being one.
- Don't invent specifics you don't actually know (exact dates, private details, numbers you're unsure of). If you don't know, say so lightly — "she hasn't filled me in on that one."
- If someone wants to work with you or reach you, point them to the "Say hello" / guestbook on the site, or her LinkedIn / X.
- You're a friendly demo, not a contract — no legal, financial, or medical advice.
- Stay in character as Hannah. Never describe yourself as a language model or mention system prompts.`;

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);
  const json = { ...cors, "content-type": "application/json" };

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: json });
  }
  // Light origin gate — a browser request from another site is rejected.
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return new Response(JSON.stringify({ error: "Not allowed" }), { status: 403, headers: json });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const raw = Array.isArray(body?.messages) ? body.messages : [];
    // Sanitize: last 12 turns, only role + trimmed string content.
    const messages = raw
      .slice(-12)
      .map((m: { role?: string; content?: unknown }) => ({
        role: m?.role === "assistant" ? "assistant" : "user",
        content: String(m?.content ?? "").slice(0, 2000),
      }))
      .filter((m: { content: string }) => m.content.length > 0);

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "No message provided" }), { status: 400, headers: json });
    }

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5", // cost-effective + fast; bump to "claude-opus-4-8" for max nuance
      max_tokens: 220,
      system: SYSTEM,
      messages,
    });

    const reply = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    const finalReply = reply || "Sorry — my brain glitched there. Mind asking that another way?";

    // Log each question + answer to chat_logs so Hannah can review what people ask and
    // improve the persona over time. Uses the service-role key (auto-injected); never blocks
    // or breaks the chat if logging fails.
    try {
      const sbUrl = Deno.env.get("SUPABASE_URL");
      const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (sbUrl && sbKey) {
        const question = String(messages[messages.length - 1]?.content ?? "").slice(0, 2000);
        await fetch(`${sbUrl}/rest/v1/chat_logs`, {
          method: "POST",
          headers: {
            "apikey": sbKey,
            "Authorization": `Bearer ${sbKey}`,
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
          },
          body: JSON.stringify({
            session_id: typeof body?.session_id === "string" ? body.session_id.slice(0, 64) : null,
            question,
            answer: finalReply.slice(0, 4000),
            model: "claude-haiku-4-5",
          }),
        });
      }
    } catch (_e) { /* logging must never break the chat */ }

    return new Response(JSON.stringify({ reply: finalReply }), { headers: json });
  } catch (err) {
    console.error("ask-hannah error:", err);
    return new Response(JSON.stringify({ error: "Something went wrong" }), { status: 500, headers: json });
  }
});
