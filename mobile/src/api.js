import { supabase } from './supabase';

async function extractFunctionError(error) {
  let msg = error.message;
  try {
    const body = await error.context?.json();
    if (body?.detail) msg = body.detail;
    if (body?.raw) {
      const raw = typeof body.raw === 'string' ? body.raw : JSON.stringify(body.raw);
      msg = `${msg}\n\nApple response: ${raw}`;
    }
  } catch {}
  return msg;
}

// The signed-in user from the locally stored session. Unlike auth.getUser() this makes no
// network request; the database still checks the session token on every query (RLS).
async function getSessionUser() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}

// ── Profile ──

export async function getProfile() {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (error) throw new Error(error.message);
  return {
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    clubs: data.clubs || {},
    subscription_active: data.subscription_expires_at ? new Date() < new Date(data.subscription_expires_at) : false,
    subscription_expires_at: data.subscription_expires_at,
    subscription_will_renew: data.subscription_will_renew !== false,
    has_apple_subscription: !!data.apple_original_transaction_id,
  };
}

// ── Subscription ──

export async function syncSubscription() {
  const { data, error } = await supabase.functions.invoke('subscription-sync', { body: {} });
  if (error) throw new Error(await extractFunctionError(error));
  return data;
}

export async function verifySubscription(transactionId) {
  const { data, error } = await supabase.functions.invoke('subscription-verify', {
    body: { transactionId },
  });
  if (error) throw new Error(await extractFunctionError(error));
  return data;
}

// ── Password ──

export async function changePassword(currentPassword, newPassword) {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  // Re-verify the current password so an unlocked phone alone can't change it.
  const { error: verifyErr } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (verifyErr) throw new Error('Current password is incorrect');

  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
  return { message: 'Password updated' };
}

// ── Account Deletion ──

export async function deleteAccount() {
  const { data, error } = await supabase.functions.invoke('delete-account', {
    body: {},
  });
  if (error) throw new Error(await extractFunctionError(error));
  return data;
}

// ── Clubs ──

export async function setupClubs(clubs) {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  const { error } = await supabase
    .from('profiles')
    .update({ clubs })
    .eq('id', user.id);

  if (error) throw new Error(error.message);
  return { message: 'Club distances saved', clubs };
}

// ── AI Endpoints (Edge Functions) ──

export async function getClubRecommendation(distance, lie, wind) {
  const { data, error } = await supabase.functions.invoke('club-recommendation', {
    body: { distance: parseFloat(distance), lie, wind },
  });
  if (error) throw new Error(await extractFunctionError(error));
  return data;
}

export async function getCourseStrategy(hole_par, hole_length, hazards, hole_shape) {
  const { data, error } = await supabase.functions.invoke('course-strategy', {
    body: { hole_par, hole_length, hazards, hole_shape },
  });
  if (error) throw new Error(await extractFunctionError(error));
  return data;
}

// ── Rounds ──

export async function startRound(courseName, courseId = null, loopKeys = null) {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  const row = { user_id: user.id, course_name: courseName || null };
  // Only send the GPS columns when used, so score-only rounds insert exactly as before.
  if (courseId != null) row.course_id = courseId;
  if (Array.isArray(loopKeys) && loopKeys.length > 0) row.loop_keys = loopKeys;

  const { data, error } = await supabase
    .from('rounds')
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return {
    round_id: data.id,
    course_name: data.course_name,
    course_id: data.course_id ?? null,
    loop_keys: data.loop_keys ?? null,
    started_at: data.started_at,
  };
}

export async function finishRound(roundId) {
  const { error } = await supabase
    .from('rounds')
    .update({ finished_at: new Date().toISOString() })
    .eq('id', roundId);
  if (error) throw new Error(error.message);
}

// The user's unfinished round started in the last 12 hours, or null.
export async function getActiveRound() {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('rounds')
    .select('*, holes(*)')
    .eq('user_id', user.id)
    .is('finished_at', null)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(1);

  if (error) throw new Error(error.message);
  return data && data.length > 0 ? formatRound(data[0]) : null;
}

export async function addHole(roundId, holeData) {
  const { hole_number, par, strokes, fairway_hit, gir, notes } = holeData;

  // Upsert on (round_id, hole_number) so a retry or double-tap replaces the hole instead of
  // duplicating it. rounds.total_score is kept in sync by a DB trigger (migration 005).
  const { error: saveErr } = await supabase
    .from('holes')
    .upsert({
      round_id: roundId,
      hole_number,
      par: par != null ? parseInt(par, 10) : null,
      strokes,
      putts: holeData.putts ?? null,
      fairway_hit: fairway_hit ?? null,
      gir: gir ?? null,
      notes: notes ?? null,
    }, { onConflict: 'round_id,hole_number' });

  if (saveErr) throw new Error(saveErr.message);

  const { data: round, error: roundErr } = await supabase
    .from('rounds')
    .select('*, holes(*)')
    .eq('id', roundId)
    .single();

  if (roundErr) throw new Error(roundErr.message);
  return formatRound(round);
}

export async function getRounds() {
  const user = await getSessionUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('rounds')
    .select('*, holes(*)')
    .eq('user_id', user.id)
    .order('started_at', { ascending: false });

  if (error) throw new Error(error.message);
  return (data || []).map(formatRound);
}

export async function deleteRound(roundId) {
  const { error } = await supabase.from('rounds').delete().eq('id', roundId);
  if (error) throw new Error(error.message);
}

// ── Helpers ──

function formatRound(r) {
  const holes = (r.holes || [])
    .sort((a, b) => a.hole_number - b.hole_number)
    .map((h) => {
      const par = h.par != null ? h.par : null;
      const scoreVsPar = par != null ? h.strokes - par : null;
      return {
        hole_number: h.hole_number,
        par,
        strokes: h.strokes,
        score_vs_par: scoreVsPar,
        putts: h.putts,
        fairway_hit: h.fairway_hit,
        gir: h.gir,
        notes: h.notes,
      };
    });

  // Derive from the holes themselves so a stale stored total can never win.
  const totalStrokes = holes.length > 0
    ? holes.reduce((sum, h) => sum + h.strokes, 0)
    : (r.total_score ?? 0);
  const totalPar = holes.filter((h) => h.par != null).reduce((sum, h) => sum + h.par, 0);
  const totalVsPar = totalPar > 0 ? totalStrokes - totalPar : null;

  return {
    round_id: r.id,
    course_name: r.course_name,
    course_id: r.course_id ?? null,
    loop_keys: r.loop_keys ?? null,
    started_at: r.started_at,
    finished_at: r.finished_at ?? null,
    total_score: totalStrokes,
    total_vs_par: totalVsPar,
    holes,
  };
}
