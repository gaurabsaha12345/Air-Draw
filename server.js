import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5173;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Proxy to Google AI Studio (Gemini) using server-side API key
import { GoogleGenerativeAI } from '@google/generative-ai';
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '';
let genAI = null;
if (apiKey) {
  genAI = new GoogleGenerativeAI(apiKey);
}

app.post('/api/recommend-shapes', async (req, res) => {
  try {
    if (!genAI) {
      return res.status(500).json({ error: 'Missing GOOGLE_API_KEY in .env' });
    }
    const { strokes, width, height } = req.body || {};
    if (!Array.isArray(strokes) || strokes.length === 0) {
      return res.status(400).json({ error: 'strokes array required' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const prompt = `You are a drawing assistant. Given a sequence of polyline strokes captured from air-drawing using hand tracking, guess up to 5 likely shapes the user intends. Return concise titles only, most likely first. Consider common shapes like circle, square, triangle, star, heart, arrow, house, smiley face, letter, number. Input includes canvas size for scale.

Canvas: ${width}x${height}
Strokes JSON: ${JSON.stringify(strokes).slice(0, 8000)}

Respond as a single JSON array of strings, no prose.`;

    const result = await model.generateContent(prompt);
    const text = result.response.text().trim();
    let suggestions = [];
    try {
      suggestions = JSON.parse(text);
      if (!Array.isArray(suggestions)) suggestions = [];
    } catch {
      // Attempt to extract JSON array with a fallback
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        try { suggestions = JSON.parse(match[0]); } catch {}
      }
    }
    suggestions = (suggestions || [])
      .filter((s) => typeof s === 'string')
      .map((s) => s.trim())
      .slice(0, 5);

    res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'gemini_error', detail: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Webcam Draw running at http://localhost:${PORT}`);
});


