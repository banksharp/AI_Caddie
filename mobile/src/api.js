import { supabase } from './supabase';

async function extractFunctionError(error) {
  let msg = error.message;
  try {
    const body = await error.context?.json();
    if (body?.detail) msg = body.detail;
  } catch {}
  return msg;
}

// ── Profile ──

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
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
  };
}

// ── Subscription ──

export async function verifySubscription(transactionId) {
  const { data, error } = await supabase.functions.invoke('subscription-verify', {
    body: { transactionId },
  });
  if (error) throw new Error(await extractFunctionError(error));
  return data;
}

// ── Password ──

export async function changePassword(_currentPassword, newPassword) {
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
  const { data: { user } } = await supabase.auth.getUser();
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

export async function startRound(courseName) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const { data, error } = await supabase
    .from('rounds')
    .insert({ user_id: user.id, course_name: courseName || null })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return {
    round_id: data.id,
    course_name: data.course_name,
    started_at: data.started_at,
  };
}

export async function addHole(roundId, holeData) {
  const { hole_number, par, strokes, fairway_hit, gir, notes } = holeData;

  const { error: insertErr } = await supabase
    .from('holes')
    .insert({
      round_id: roundId,
      hole_number,
      par: par != null ? parseInt(par) : null,
      strokes,
      putts: holeData.putts ?? null,
      fairway_hit: fairway_hit ?? null,
      gir: gir ?? null,
      notes: notes ?? null,
    });

  if (insertErr) throw new Error(insertErr.message);

  const { data: totalData } = await supabase
    .from('holes')
    .select('strokes')
    .eq('round_id', roundId);

  const totalScore = (totalData || []).reduce((sum, h) => sum + h.strokes, 0);
  await supabase.from('rounds').update({ total_score: totalScore }).eq('id', roundId);

  const { data: round, error: roundErr } = await supabase
    .from('rounds')
    .select('*, holes(*)')
    .eq('id', roundId)
    .single();

  if (roundErr) throw new Error(roundErr.message);
  return formatRound(round);
}

export async function getRounds() {
  const { data: { user } } = await supabase.auth.getUser();
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

  const totalStrokes = r.total_score ?? holes.reduce((sum, h) => sum + h.strokes, 0);
  const totalPar = holes.filter((h) => h.par != null).reduce((sum, h) => sum + h.par, 0);
  const totalVsPar = totalPar > 0 ? totalStrokes - totalPar : null;

  return {
    round_id: r.id,
    course_name: r.course_name,
    started_at: r.started_at,
    total_score: totalStrokes,
    total_vs_par: totalVsPar,
    holes,
  };
}
