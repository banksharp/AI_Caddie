import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SECRET_KEY = process.env.SECRET_KEY || 'CHANGE_ME_SECRET_KEY';
const PORT = process.env.PORT || 8000;

app.use(cors());
app.use(express.json());


// ── Auth helpers ──

function createToken(email) {
  return jwt.sign({ sub: email }, SECRET_KEY, { expiresIn: '24h' });
}

function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ detail: 'Not authenticated' });
  }

  try {
    const payload = jwt.verify(header.split(' ')[1], SECRET_KEY);
    req.userEmail = payload.sub;
    next();
  } catch {
    return res.status(401).json({ detail: 'Could not validate credentials' });
  }
}

async function currentUser(req, res) {
  const user = await prisma.user.findUnique({ where: { email: req.userEmail } });
  if (!user) {
    res.status(401).json({ detail: 'User not found' });
    return null;
  }
  return user;
}


// ── Public routes ──

app.post('/api/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (await prisma.user.findUnique({ where: { email } })) {
      return res.status(400).json({ detail: 'Email already registered' });
    }

    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(password, 10), clubs: {} },
    });

    return res.json({ access_token: createToken(user.email), token_type: 'bearer' });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return res.status(401).json({ detail: 'Incorrect email or password' });
    }

    return res.json({ access_token: createToken(user.email), token_type: 'bearer' });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});


// ── Protected routes ──

// TODO: remove DEV_BYPASS after taking screenshots
const DEV_BYPASS_SUBSCRIPTION = true;

function subscriptionActive(user) {
  if (DEV_BYPASS_SUBSCRIPTION) return true;
  if (!user.subscriptionExpiresAt) return false;
  return new Date() < new Date(user.subscriptionExpiresAt);
}

function requireSubscription(req, res, next) {
  (async () => {
    const user = await currentUser(req, res);
    if (!user) return;
    if (!subscriptionActive(user)) {
      res.status(403).json({ detail: 'Active subscription required', code: 'subscription_required' });
      return;
    }
    req.user = user;
    next();
  })();
}

app.get('/api/me', authenticate, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;
    const active = subscriptionActive(user);
    return res.json({
      email: user.email,
      clubs: user.clubs || {},
      subscription_active: active,
      subscription_expires_at: user.subscriptionExpiresAt ? user.subscriptionExpiresAt.toISOString() : null,
    });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/change-password', authenticate, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    const { current_password, new_password } = req.body;
    if (!current_password || !new_password) {
      return res.status(400).json({ detail: 'current_password and new_password required' });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ detail: 'New password must be at least 6 characters' });
    }

    if (!(await bcrypt.compare(current_password, user.passwordHash))) {
      return res.status(401).json({ detail: 'Current password is incorrect' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(new_password, 10) },
    });
    return res.json({ message: 'Password updated' });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

// Subscription verification (no subscription required to call)
app.post('/api/subscription/verify', authenticate, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    const { transactionId } = req.body;
    if (!transactionId || typeof transactionId !== 'string') {
      return res.status(400).json({ detail: 'transactionId required' });
    }

    const keyId = process.env.APPLE_KEY_ID;
    const issuerId = process.env.APPLE_ISSUER_ID;
    const privateKey = process.env.APPLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const bundleId = process.env.APPLE_BUNDLE_ID;
    const sandbox = process.env.APPLE_SANDBOX === 'true';

    if (!keyId || !issuerId || !privateKey || !bundleId) {
      return res.status(503).json({ detail: 'Subscription verification not configured' });
    }

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { iss: issuerId, iat: now, exp: now + 300, aud: 'appstoreconnect-api' },
      privateKey,
      { algorithm: 'ES256', keyid: keyId }
    );

    const baseUrl = sandbox
      ? 'https://api.storekit-sandbox.itunes.apple.com'
      : 'https://api.storekit.itunes.apple.com';
    const r = await fetch(`${baseUrl}/inApps/v1/transactions/${encodeURIComponent(transactionId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!r.ok) {
      const err = await r.text();
      return res.status(400).json({ detail: 'Invalid or expired transaction', raw: err });
    }

    const data = await r.json();
    const signedTransactionInfo = data.signedTransactionInfo;
    if (!signedTransactionInfo) {
      return res.status(400).json({ detail: 'No transaction info in response' });
    }

    const parts = signedTransactionInfo.split('.');
    if (parts.length !== 3) {
      return res.status(400).json({ detail: 'Invalid signed transaction' });
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    const expirationMs = payload.expiresDate;
    if (!expirationMs) {
      return res.status(400).json({ detail: 'Transaction has no expiration' });
    }

    const expiresAt = new Date(expirationMs);
    if (expiresAt <= new Date()) {
      return res.status(400).json({ detail: 'Subscription already expired' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { subscriptionExpiresAt: expiresAt },
    });

    return res.json({
      subscription_active: true,
      subscription_expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/setup-clubs', authenticate, requireSubscription, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    await prisma.user.update({ where: { id: user.id }, data: { clubs: req.body.clubs } });
    return res.json({ message: 'Club distances saved', clubs: req.body.clubs });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

function maybeParseModelJson(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const withoutFences = trimmed
    .replace(/^```(json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFences);
  } catch {
    return null;
  }
}

app.post('/api/club-recommendation', authenticate, requireSubscription, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;
    if (!user.clubs || Object.keys(user.clubs).length === 0) {
      return res.status(400).json({ detail: 'Club distances not set up' });
    }

    const { distance, lie, wind } = req.body;

    let prompt = 'I need a club recommendation for my next golf shot. Here are my details:\nMy club distances:\n';
    for (const [club, dist] of Object.entries(user.clubs)) {
      prompt += `${club}: ${dist} yards\n`;
    }
    prompt += `Current situation:
    - Distance to hole: ${distance} yards
    - Current lie: ${lie}
    - Wind conditions: ${wind}

    Return ONLY valid JSON with this exact shape (no markdown, no extra keys):
    {
      "recommendedClub": "7-Iron",
      "why": ["bullet 1", "bullet 2"],
      "tips": ["tip 1", "tip 2"],
      "adjustments": ["optional bullet 1"]
    }`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text;
    const parsed = maybeParseModelJson(raw);
    if (parsed) return res.json({ data: parsed, status: 'success' });
    return res.json({ advice: raw, status: 'success', format: 'text' });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/course-strategy', authenticate, requireSubscription, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;
    if (!user.clubs || Object.keys(user.clubs).length === 0) {
      return res.status(400).json({ detail: 'Club distances not set up' });
    }

    const { hole_par, hole_length, hazards, hole_shape } = req.body;

    let prompt = `I need advice on how to play this golf hole strategically:

    Hole details:
    - Par: ${hole_par}
    - Length: ${hole_length} yards
    - Shape: ${hole_shape}
    - Hazards: ${hazards}

    My club distances:\n`;
    for (const [club, dist] of Object.entries(user.clubs)) {
      prompt += `${club}: ${dist} yards\n`;
    }
    prompt += `Return ONLY valid JSON (no markdown). Plan shots in strict order: 1st (tee), 2nd, 3rd, ... last (approach onto green).
    CRITICAL: Distances must be consistent. Each shot happens FROM the distance left after the previous shot.
    If you say shot 2 "leaves 80 yards", then the next shot is FROM 80 yards, not from 135. If shot 2 "leaves 5-10 yards from green", the next shot is a short chip from 5-10 yards.
    In "situation" or "notes" always state the distance for that shot (e.g. "From 195 yards" or "From 80 yards for 3rd shot"). "approach" = final shot onto the green from whatever distance the previous shot left.
    Use this shape:
    {
      "teeShot": {"club": "...", "aim": "...", "shape": "optional", "notes": "..." },
      "secondShot": {"situation": "e.g. 2nd shot, 195 yards left", "club": "...", "aim": "...", "notes": "..." },
      "otherShots": [
        {"situation": "e.g. 3rd shot from 80 yards", "club": "...", "aim": "...", "notes": "..." }
      ],
      "approach": {"club": "...", "aim": "...", "notes": "final shot onto green from X yards" },
      "avoid": ["risk 1", "risk 2"],
      "notes": ["bullet 1", "bullet 2"]
    }
    Omit secondShot or use [] for otherShots if not needed. Always include teeShot, approach, avoid, and notes.`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = response.content[0].text;
    const parsed = maybeParseModelJson(raw);
    if (parsed) return res.json({ data: parsed, status: 'success' });
    return res.json({ advice: raw, status: 'success', format: 'text' });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/start-round', authenticate, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    const round = await prisma.round.create({
      data: { userId: user.id, courseName: req.body.course_name || null },
    });

    return res.json({
      round_id: round.id,
      course_name: round.courseName,
      started_at: round.startedAt.toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/add-hole', authenticate, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    const { round_id, hole_number, par, strokes, putts, fairway_hit, gir, notes } = req.body;

    const round = await prisma.round.findUnique({ where: { id: round_id } });
    if (!round) return res.status(404).json({ detail: 'Round not found' });
    if (round.userId !== user.id) return res.status(403).json({ detail: 'Not allowed to modify this round' });

    await prisma.hole.create({
      data: {
        roundId: round_id,
        holeNumber: hole_number,
        par: par != null ? parseInt(par) : null,
        strokes,
        putts: putts ?? null,
        fairwayHit: fairway_hit ?? null,
        gir: gir ?? null,
        notes: notes ?? null,
      },
    });

    const total = await prisma.hole.aggregate({
      where: { roundId: round_id },
      _sum: { strokes: true },
    });
    await prisma.round.update({
      where: { id: round_id },
      data: { totalScore: total._sum.strokes },
    });

    const updated = await prisma.round.findUnique({
      where: { id: round_id },
      include: { holes: { orderBy: { holeNumber: 'asc' } } },
    });

    return res.json(formatRound(updated));
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.get('/api/rounds', authenticate, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    const rounds = await prisma.round.findMany({
      where: { userId: user.id },
      orderBy: { startedAt: 'desc' },
      include: { holes: { orderBy: { holeNumber: 'asc' } } },
    });

    return res.json(rounds.map(formatRound));
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.delete('/api/rounds/:id', authenticate, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    const roundId = parseInt(req.params.id, 10);
    if (Number.isNaN(roundId)) return res.status(400).json({ detail: 'Invalid round id' });

    const round = await prisma.round.findUnique({ where: { id: roundId } });
    if (!round) return res.status(404).json({ detail: 'Round not found' });
    if (round.userId !== user.id) return res.status(403).json({ detail: 'Not allowed to delete this round' });

    await prisma.round.delete({ where: { id: roundId } });
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});


// ── Helpers ──

function formatRound(r) {
  const holes = r.holes.map(h => {
    const par = h.par != null ? h.par : null;
    const scoreVsPar = par != null ? h.strokes - par : null;
    return {
      hole_number: h.holeNumber,
      par,
      strokes: h.strokes,
      score_vs_par: scoreVsPar,
      putts: h.putts,
      fairway_hit: h.fairwayHit,
      gir: h.gir,
      notes: h.notes,
    };
  });
  const totalStrokes = r.totalScore ?? holes.reduce((sum, h) => sum + h.strokes, 0);
  const totalPar = holes.filter(h => h.par != null).reduce((sum, h) => sum + h.par, 0);
  const totalVsPar = totalPar > 0 ? totalStrokes - totalPar : null;
  return {
    round_id: r.id,
    course_name: r.courseName,
    started_at: r.startedAt.toISOString(),
    total_score: totalStrokes,
    total_vs_par: totalVsPar,
    holes,
  };
}


// ── Start ──

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Caddie API running on port ${PORT}`);
});
