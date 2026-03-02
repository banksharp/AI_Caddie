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

app.post('/api/setup-clubs', authenticate, async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    await prisma.user.update({ where: { id: user.id }, data: { clubs: req.body.clubs } });
    return res.json({ message: 'Club distances saved', clubs: req.body.clubs });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/club-recommendation', authenticate, async (req, res) => {
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

    Please recommend the best club for this shot and explain your reasoning.
    Also provide any tips for executing this shot successfully.`;

    const response = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    return res.json({ advice: response.content[0].text, status: 'success' });
  } catch (err) {
    return res.status(500).json({ detail: err.message });
  }
});

app.post('/api/course-strategy', authenticate, async (req, res) => {
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
    prompt += `Please provide a hole strategy that covers:
    1. What club(s) to use off the tee
    2. Where to aim for each shot
    3. How to handle the approach to the green
    4. What risks to avoid
    5. Any specific shot shapes that would be beneficial`;

    const response = await anthropic.messages.create({
      model: 'claude-3-7-sonnet-20250219',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    return res.json({ advice: response.content[0].text, status: 'success' });
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

    const { round_id, hole_number, strokes, putts, fairway_hit, gir, notes } = req.body;

    const round = await prisma.round.findUnique({ where: { id: round_id } });
    if (!round) return res.status(404).json({ detail: 'Round not found' });
    if (round.userId !== user.id) return res.status(403).json({ detail: 'Not allowed to modify this round' });

    await prisma.hole.create({
      data: {
        roundId: round_id,
        holeNumber: hole_number,
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


// ── Helpers ──

function formatRound(r) {
  return {
    round_id: r.id,
    course_name: r.courseName,
    started_at: r.startedAt.toISOString(),
    total_score: r.totalScore,
    holes: r.holes.map(h => ({
      hole_number: h.holeNumber,
      strokes: h.strokes,
      putts: h.putts,
      fairway_hit: h.fairwayHit,
      gir: h.gir,
      notes: h.notes,
    })),
  };
}


// ── Start ──

app.listen(PORT, '0.0.0.0', () => {
  console.log(`AI Caddie API running on port ${PORT}`);
});
