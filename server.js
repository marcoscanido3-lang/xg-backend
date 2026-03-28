const express = require('express');
const https   = require('https');
const app     = express();

// ── CORS: permite llamadas desde cualquier origen (tu HTML local o GitHub Pages)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Headers que imitan un navegador real — esto es lo que Cloudflare verifica
const SF_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer':         'https://www.sofascore.com/',
  'Origin':          'https://www.sofascore.com',
  'Cache-Control':   'no-cache',
  'Pragma':          'no-cache',
};

// ── Función helper: hace fetch a Sofascore con los headers correctos
function sfGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.sofascore.com',
      path:     `/api/v1${path}`,
      method:   'GET',
      headers:  SF_HEADERS,
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Sofascore devolvió ${res.statusCode}: ${raw.slice(0,200)}`));
        }
        try { resolve(JSON.parse(raw)); }
        catch(e) { reject(new Error('JSON inválido: ' + raw.slice(0,200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════

// 1. Buscar equipos por nombre
// GET /search?q=Liverpool
app.get('/search', async (req, res) => {
  const q = req.query.q;
  if (!q || q.length < 2) return res.status(400).json({ error: 'Parámetro q requerido (mín 2 chars)' });
  try {
    const data = await sfGet(`/search/teams?q=${encodeURIComponent(q)}&sport=football`);
    res.json(data);
  } catch(e) {
    console.error('[/search]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// 2. Últimos N partidos de un equipo (page 0 = más recientes)
// GET /team/17/events?page=0
app.get('/team/:id/events', async (req, res) => {
  const page = parseInt(req.query.page) || 0;
  try {
    const data = await sfGet(`/team/${req.params.id}/events/last/${page}`);
    res.json(data);
  } catch(e) {
    console.error('[/team/events]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// 3. Estadísticas (XG) de un partido específico
// GET /event/12345678/statistics
app.get('/event/:id/statistics', async (req, res) => {
  try {
    const data = await sfGet(`/event/${req.params.id}/statistics`);
    res.json(data);
  } catch(e) {
    console.error('[/event/statistics]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// 4. Health check
app.get('/health', (_, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── Inicio
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ XG Backend corriendo en puerto ${PORT}`));
