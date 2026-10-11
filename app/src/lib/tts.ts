import { PollyClient, SynthesizeSpeechCommand, type VoiceId } from "@aws-sdk/client-polly";

const g = globalThis as unknown as { __polly?: PollyClient; __ttsCache?: Map<string, Uint8Array> };

export interface Speaker {
  name: string;
  sex: string;
  age?: number;
}

const isFemale = (sex: string) => /^f|woman|female/i.test(sex);
function pick<T>(pool: T[], seed: string): T {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[h % pool.length];
}

// Amazon Polly generative voices (fallback, and the default when no ElevenLabs key is set).
const POLLY_F: VoiceId[] = ["Danielle", "Joanna", "Ruth", "Salli"];
const POLLY_M: VoiceId[] = ["Matthew", "Stephen"];

// ElevenLabs premade voices, grouped so a 72-year-old does not sound 25. Same person, same voice.
const XI = {
  f_young: ["EXAVITQu4vr4xnSDxMaL", "FGY2WhTYpPnrIDTdsKH5", "cgSgspJ2msm6clMCkdW9"],
  f_older: ["XrExE9yKIg1WjnnlVkGX", "hpp4J3VqNfWAUOO0d1Us"],
  m_young: ["TX3LPaxmHKxFdv7VOQHJ", "bIHbv24MWmeRgasZH58o"],
  m_middle: ["CwhRBWXzGAHq8TQ4Fs17", "cjVigY5qzO86Huf0OWal", "iP95p4xoKVk53GoZ742B", "nPczCjzI2devNBz1zQrb"],
  m_old: ["pqHfZKP75CvOlQylNhV4"],
};
function elevenVoice(s: Speaker): string {
  const age = s.age ?? 40;
  if (isFemale(s.sex)) return pick(age < 38 ? XI.f_young : XI.f_older, s.name);
  return pick(age < 32 ? XI.m_young : age < 62 ? XI.m_middle : XI.m_old, s.name);
}

async function eleven(text: string, voiceId: string): Promise<Uint8Array> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_64`, {
    method: "POST",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({ text, model_id: process.env.ELEVENLABS_MODEL || "eleven_flash_v2_5", voice_settings: { stability: 0.45, similarity_boost: 0.75 } }),
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function polly(text: string, voice: VoiceId): Promise<Uint8Array> {
  g.__polly ||= new PollyClient({ region: process.env.AWS_REGION || "us-west-2" });
  const res = await g.__polly.send(new SynthesizeSpeechCommand({ Text: text, VoiceId: voice, Engine: "generative", OutputFormat: "mp3" }));
  return res.AudioStream!.transformToByteArray();
}

/** Speech for one speaker. Uses ElevenLabs when a key is configured and falls back to Polly on any failure. */
export async function speak(text: string, s: Speaker): Promise<Uint8Array> {
  text = text.slice(0, 2800);
  g.__ttsCache ||= new Map();
  const key = `${s.name}|${s.sex}|${s.age}|${text}`;
  const hit = g.__ttsCache.get(key);
  if (hit) return hit;
  let bytes: Uint8Array | null = null;
  if (process.env.ELEVENLABS_API_KEY) {
    try {
      bytes = await eleven(text, elevenVoice(s));
    } catch (e) {
      console.error("[tts] falling back to Polly:", (e as Error).message);
    }
  }
  bytes ||= await polly(text, pick(isFemale(s.sex) ? POLLY_F : POLLY_M, s.name));
  if (g.__ttsCache.size > 300) g.__ttsCache.clear();
  g.__ttsCache.set(key, bytes);
  return bytes;
}
