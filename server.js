// server.js
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error('❌ Missing GEMINI_API_KEY in .env');
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

/* ---------------- Personas ---------------- */
const PERSONAS = {
  general: `You are a helpful, concise assistant.`,

  swe: `You are a senior software engineer.
- Prioritize correctness and best practices.
- Provide complete, minimal runnable examples with language tags (js, ts, py, bash, sql).
- State assumptions briefly and proceed.
- Mention edge cases, tests, and security implications when helpful.`,

  frontend: `You are a senior frontend engineer (HTML/CSS/JS, Angular/React/Vue). Provide modern, accessible solutions with clean UI/UX.`,
  devops:   `You are a DevOps/SRE expert. Prefer reproducible CLI steps (Linux, Docker, systemd, Nginx), IaC hints, and rollback safety.`,
  data:     `You are a data/ML engineer. Provide clear pipelines, evaluation metrics, and well-commented code (pandas, numpy, sklearn).`
};

const PERSONA_DEFAULTS = {
  swe:      { temperature: 0.3 },
  frontend: { temperature: 0.3 },
  devops:   { temperature: 0.25 },
  data:     { temperature: 0.25 },
  general:  { temperature: 0.7 }
};

const DEBUG_PERSONA = process.env.DEBUG_PERSONA === 'true';

/* ---------------- Chat route ---------------- */
app.post('/api/chat', async (req, res) => {
  try {
    const {
      message,
      history = [],
      model = 'gemini-2.5-flash',
      thinkingBudget = 0,
      persona = 'general'
    } = req.body || {};

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required.' });
    }

    // Build Gemini contents from prior turns + current user message
    const contents = [];
    for (const turn of history.slice(-16)) {
      if (!turn?.role || !turn?.content) continue;
      contents.push({
        role: turn.role === 'user' ? 'user' : 'model',
        parts: [{ text: turn.content }]
      });
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    // System instruction (persona), with optional debug tag
    const baseSys = PERSONAS[persona] || PERSONAS.general;
    const sys = DEBUG_PERSONA
      ? `${baseSys}

[DEBUG] At the VERY beginning of your response, output exactly <<<persona:${persona}>>> and then continue normally.`
      : baseSys;

    const personaDefaults = PERSONA_DEFAULTS[persona] || PERSONA_DEFAULTS.general;

    // Helpful for verifying in DevTools → Network
    res.setHeader('X-Persona', persona);

    // Stream tokens back to the client
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      systemInstruction: sys,
      generationConfig: {                 // ✅ correct field for temperature/tokens
        temperature: personaDefaults.temperature,
        maxOutputTokens: 2048
      },
      thinkingConfig: { thinkingBudget }
    });

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    for await (const chunk of stream) {
      const text = chunk.text || '';
      if (text) res.write(text);
    }

    res.end();
  } catch (err) {
    console.error('❌ /api/chat error:', err);
    try { res.status(500).json({ error: 'Server error', detail: String(err?.message || err) }); } catch {}
  }
});

/* ---------------- Fallback to UI ---------------- */
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`\n▶ Listening on http://localhost:${PORT}`));
