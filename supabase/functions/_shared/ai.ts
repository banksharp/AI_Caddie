import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { corsHeaders } from './cors.ts';
import { getSupabaseClient, getAuthUser, getProfile, isSubscriptionActive } from './supabase.ts';

export const AI_MODEL = 'claude-sonnet-5';
export const MAX_TEXT_LEN = 200;

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Parses a finite number from a number or numeric string; returns null otherwise. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Returns a trimmed string capped at MAX_TEXT_LEN, or null if missing/empty/not a string. */
export function toText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t ? t.slice(0, MAX_TEXT_LEN) : null;
}

/**
 * Auth + profile + active subscription + club setup gate.
 * Returns either the club map or a ready-to-return error Response.
 */
export async function requireSubscriberClubs(
  req: Request,
): Promise<{ clubs: Record<string, unknown> } | { error: Response }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return { error: jsonResponse({ detail: 'Not authenticated' }, 401) };

  const supabase = getSupabaseClient(authHeader);
  const user = await getAuthUser(supabase);
  if (!user) return { error: jsonResponse({ detail: 'Not authenticated' }, 401) };

  const profile = await getProfile(supabase, user.id);
  if (!profile) return { error: jsonResponse({ detail: 'Profile not found' }, 404) };
  if (!isSubscriptionActive(profile)) {
    return { error: jsonResponse({ detail: 'Active subscription required', code: 'subscription_required' }, 403) };
  }

  const clubs = (profile.clubs || {}) as Record<string, unknown>;
  if (Object.keys(clubs).length === 0) return { error: jsonResponse({ detail: 'Club distances not set up' }, 400) };
  return { clubs };
}

export function formatClubs(clubs: Record<string, unknown>): string {
  return Object.entries(clubs).map(([club, dist]) => `${club}: ${dist} yards`).join('\n');
}

let client: Anthropic | null = null;

/**
 * Calls Claude with a JSON-schema structured output and returns the response body
 * in the existing client contract: `{ data, status: 'success' }`, falling back to
 * `{ advice, status: 'success', format: 'text' }` only if the output can't be parsed
 * (e.g. refusal or max_tokens truncation).
 */
export async function generateStructured(opts: {
  prompt: string;
  schema: Record<string, unknown>;
  effort: 'low' | 'medium' | 'high';
}) {
  client ??= new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

  const response = await client.messages.create({
    model: AI_MODEL,
    max_tokens: 16000,
    output_config: {
      effort: opts.effort,
      format: { type: 'json_schema', schema: opts.schema },
    },
    messages: [{ role: 'user', content: opts.prompt }],
  });

  const raw = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  if (response.stop_reason === 'end_turn') {
    try {
      return { data: JSON.parse(raw), status: 'success' };
    } catch { /* fall through to text */ }
  }
  console.warn(`Structured output unavailable (stop_reason=${response.stop_reason})`);
  return { advice: raw || 'Unable to generate advice right now. Please try again.', status: 'success', format: 'text' };
}

// ── Small validation / bag helpers (used by shot-recommendation) ──

/** Returns `v` if it is one of `allowed` (case-insensitive, trimmed), else null. */
export function toEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  if (typeof v !== 'string') return null;
  const t = v.trim().toLowerCase();
  return allowed.find((a) => a.toLowerCase() === t) ?? null;
}

/** Clamps a number into [min, max]. NaN becomes `min`. */
export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export type BagClub = { name: string; yds: number };

/**
 * Turns the profile club map into a list of usable clubs, longest first.
 * Clubs with a missing, non-numeric, zero or negative distance are dropped.
 */
export function bagFromClubs(clubs: Record<string, unknown> | null | undefined): BagClub[] {
  if (!clubs || typeof clubs !== 'object') return [];
  const bag: BagClub[] = [];
  for (const [rawName, rawYds] of Object.entries(clubs)) {
    const name = rawName.trim();
    const yds = toNumber(rawYds);
    if (!name || yds === null || yds <= 0) continue;
    bag.push({ name, yds: Math.round(yds) });
  }
  return bag.sort((a, b) => b.yds - a.yds || a.name.localeCompare(b.name));
}

/**
 * Maps a (model-provided) club name onto a club in the bag: exact case-insensitive match
 * first, otherwise the bag club whose distance is nearest to `targetYds`. Returns null only
 * when the bag is empty, or when there is no match and no usable target.
 */
export function nearestClubName(name: unknown, bag: BagClub[], targetYds?: number | null): string | null {
  if (bag.length === 0) return null;
  if (typeof name === 'string') {
    const t = name.trim().toLowerCase();
    const exact = bag.find((c) => c.name.toLowerCase() === t);
    if (exact) return exact.name;
  }
  if (typeof targetYds !== 'number' || !Number.isFinite(targetYds)) return null;
  let best = bag[0];
  for (const c of bag) {
    if (Math.abs(c.yds - targetYds) < Math.abs(best.yds - targetYds)) best = c;
  }
  return best.name;
}
