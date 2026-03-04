#!/usr/bin/env node
/**
 * One-time migration script: Render PostgreSQL → Supabase
 *
 * Prerequisites:
 *   1. Create your Supabase project and run the SQL migration (001_initial_schema.sql)
 *   2. Set the environment variables below
 *
 * Usage:
 *   RENDER_DATABASE_URL="postgres://..." \
 *   SUPABASE_URL="https://xxx.supabase.co" \
 *   SUPABASE_SERVICE_ROLE_KEY="eyJ..." \
 *   node scripts/migrate-to-supabase.mjs
 */

import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

const { Client } = pg;

const RENDER_DB_URL = process.env.RENDER_DATABASE_URL;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!RENDER_DB_URL || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required env vars: RENDER_DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const renderDb = new Client({ connectionString: RENDER_DB_URL, ssl: { rejectUnauthorized: false } });

async function main() {
  await renderDb.connect();
  console.log('Connected to Render database');

  // 1. Migrate users
  const { rows: users } = await renderDb.query('SELECT * FROM users ORDER BY id');
  console.log(`Found ${users.length} users to migrate`);

  const userIdMap = {};

  for (const user of users) {
    // Create Supabase auth user
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: user.email,
      password: 'TempPassword123!', // Users will need to reset their password
      email_confirm: true,
      user_metadata: {
        first_name: user.first_name || 'Unknown',
        last_name: user.last_name || 'User',
      },
    });

    if (authError) {
      console.error(`  Failed to create auth user for ${user.email}:`, authError.message);
      continue;
    }

    const supabaseUserId = authData.user.id;
    userIdMap[user.id] = supabaseUserId;

    // Update profile with clubs and subscription data (trigger already created the profile)
    const { error: profileError } = await supabase
      .from('profiles')
      .update({
        clubs: user.clubs || {},
        subscription_expires_at: user.subscription_expires_at,
      })
      .eq('id', supabaseUserId);

    if (profileError) {
      console.error(`  Failed to update profile for ${user.email}:`, profileError.message);
    } else {
      console.log(`  Migrated user: ${user.email} (${user.id} → ${supabaseUserId})`);
    }
  }

  // 2. Migrate rounds
  const { rows: rounds } = await renderDb.query('SELECT * FROM rounds ORDER BY id');
  console.log(`\nFound ${rounds.length} rounds to migrate`);

  const roundIdMap = {};

  for (const round of rounds) {
    const supabaseUserId = userIdMap[round.user_id];
    if (!supabaseUserId) {
      console.error(`  Skipping round ${round.id}: no mapped user for user_id ${round.user_id}`);
      continue;
    }

    const { data, error } = await supabase
      .from('rounds')
      .insert({
        user_id: supabaseUserId,
        course_name: round.course_name,
        started_at: round.started_at,
        total_score: round.total_score,
      })
      .select()
      .single();

    if (error) {
      console.error(`  Failed to migrate round ${round.id}:`, error.message);
    } else {
      roundIdMap[round.id] = data.id;
      console.log(`  Migrated round: ${round.id} → ${data.id} (${round.course_name || 'unnamed'})`);
    }
  }

  // 3. Migrate holes
  const { rows: holes } = await renderDb.query('SELECT * FROM holes ORDER BY id');
  console.log(`\nFound ${holes.length} holes to migrate`);

  for (const hole of holes) {
    const supabaseRoundId = roundIdMap[hole.round_id];
    if (!supabaseRoundId) {
      console.error(`  Skipping hole ${hole.id}: no mapped round for round_id ${hole.round_id}`);
      continue;
    }

    const { error } = await supabase
      .from('holes')
      .insert({
        round_id: supabaseRoundId,
        hole_number: hole.hole_number,
        par: hole.par,
        strokes: hole.strokes,
        putts: hole.putts,
        fairway_hit: hole.fairway_hit,
        gir: hole.gir,
        notes: hole.notes,
      });

    if (error) {
      console.error(`  Failed to migrate hole ${hole.id}:`, error.message);
    }
  }

  console.log('\nMigration complete!');
  console.log('NOTE: All migrated users have a temporary password "TempPassword123!"');
  console.log('They will need to reset their passwords after migration.');

  await renderDb.end();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
