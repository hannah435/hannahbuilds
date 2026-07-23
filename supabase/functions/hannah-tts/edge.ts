// Edge neural TTS — the free "Ava" voice (en-US-AvaNeural), the same one Hannah's
// videos use. No API key, no quota: it talks to Microsoft's Edge read-aloud service
// over a WebSocket, exactly like the `edge-tts` tool, and returns MP3 bytes.
//
// The only fiddly bit is Microsoft's "Sec-MS-GEC" anti-abuse token, which is a
// SHA-256 of a rounded Windows-filetime timestamp plus a fixed client token. We
// compute it here so the service accepts the request.

// `ws` (not Deno's built-in WebSocket) because Microsoft's endpoint requires an
// Origin + User-Agent on the handshake, and the built-in client can't set headers.
import WebSocket from "npm:ws@8.18.0";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WSS_BASE =
  "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";
const GEC_VERSION = "1-143.0.3650.75";
const WIN_EPOCH = 11644473600; // seconds between 1601-01-01 and 1970-01-01
const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

// The same handshake headers `edge-tts` sends — the service checks these.
const WSS_HEADERS: Record<string, string> = {
  "Pragma": "no-cache",
  "Cache-Control": "no-cache",
  "Origin": "chrome-extension://jdiccldimpstbhdhoooomdgadglnnabjd",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
};

const AVA = "en-US-AvaNeural";

function uuid(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

// Microsoft's Sec-MS-GEC token: SHA-256 (uppercase hex) of a 5-minute-rounded
// Windows filetime (in 100ns ticks) concatenated with the trusted client token.
async function secMsGec(): Promise<string> {
  // BigInt throughout: after scaling to 100ns ticks the value is ~1.4e17, well past
  // Number.MAX_SAFE_INTEGER, so plain numbers would corrupt the hash and get a 403.
  let ticks = BigInt(Math.floor(Date.now() / 1000) + WIN_EPOCH);
  ticks -= ticks % 300n; // round down to the nearest 5 minutes
  ticks *= 10_000_000n; // seconds -> 100-nanosecond intervals
  const str = `${ticks}${TRUSTED_CLIENT_TOKEN}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function tsString(): string {
  // A JS Date .toString() is the format the service expects.
  return new Date().toString();
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function configMessage(): string {
  return (
    `X-Timestamp:${tsString()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    JSON.stringify({
      context: {
        synthesis: {
          audio: {
            metadataoptions: {
              sentenceBoundaryEnabled: "false",
              wordBoundaryEnabled: "false",
            },
            outputFormat: OUTPUT_FORMAT,
          },
        },
      },
    })
  );
}

function ssmlMessage(
  requestId: string,
  text: string,
  voice: string,
  rate: string,
  pitch: string,
): string {
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>${escapeXml(text)}</prosody>` +
    `</voice></speak>`;
  return (
    `X-RequestId:${requestId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${tsString()}Z\r\n` +
    "Path:ssml\r\n\r\n" +
    ssml
  );
}

// Find the "Path:audio\r\n\r\n" separator inside a binary frame and return the
// audio payload that follows. The frame is: [2-byte big-endian header length]
// [header bytes][audio bytes].
function extractAudio(frame: Uint8Array): Uint8Array | null {
  if (frame.length < 2) return null;
  const headerLen = (frame[0] << 8) | frame[1];
  const headerEnd = 2 + headerLen;
  if (headerEnd > frame.length) return null;
  const header = new TextDecoder().decode(frame.subarray(2, headerEnd));
  if (!header.includes("Path:audio")) return null;
  return frame.subarray(headerEnd);
}

export interface SynthOpts {
  voice?: string;
  rate?: string; // e.g. "+5%"
  pitch?: string; // e.g. "+0Hz"
  timeoutMs?: number;
}

// Synthesize `text` to MP3 bytes using the free Edge "Ava" voice.
export async function synthesize(
  text: string,
  opts: SynthOpts = {},
): Promise<Uint8Array> {
  const voice = opts.voice ?? AVA;
  const rate = opts.rate ?? "+5%";
  const pitch = opts.pitch ?? "+0Hz";
  const timeoutMs = opts.timeoutMs ?? 15000;

  const gec = await secMsGec();
  const connectId = uuid();
  const url =
    `${WSS_BASE}?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}` +
    `&Sec-MS-GEC=${gec}&Sec-MS-GEC-Version=${GEC_VERSION}` +
    `&ConnectionId=${connectId}`;

  const requestId = uuid();

  return await new Promise<Uint8Array>((resolve, reject) => {
    const ws = new WebSocket(url, { headers: WSS_HEADERS });
    const chunks: Uint8Array[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { ws.terminate(); } catch { /* ignore */ }
      reject(new Error("TTS timed out"));
    }, timeoutMs);

    const finish = (err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (err) return reject(err);
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (total === 0) return reject(new Error("No audio returned"));
      const out = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { out.set(c, off); off += c.length; }
      resolve(out);
    };

    ws.on("open", () => {
      ws.send(configMessage());
      ws.send(ssmlMessage(requestId, text, voice, rate, pitch));
    });

    ws.on("message", (data: ArrayBufferLike | Uint8Array, isBinary: boolean) => {
      const buf = data instanceof Uint8Array ? data : new Uint8Array(data);
      if (!isBinary) {
        if (new TextDecoder().decode(buf).includes("Path:turn.end")) finish();
        return;
      }
      const audio = extractAudio(buf);
      if (audio && audio.length) chunks.push(audio);
    });

    ws.on("error", () => finish(new Error("TTS socket error")));
    ws.on("close", () => finish()); // resolve with whatever we collected
  });
}
