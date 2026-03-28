const express = require('express');
const https   = require('https');
const zlib    = require('zlib');
const app     = express();

// ── CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── Headers que imitan un navegador real
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

// ── Fetch a Sofascore con descompresión gzip/brotli
function sfGet(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.sofascore.com',
      path:     '/api/v1' + path,
      method:   'GET',
      headers:  SF_HEADERS,
    };
    const req = https.request(options, sfRes => {
      const encoding = sfRes.headers['content-encoding'] || '';
      const chunks   = [];

      sfRes.on('data', chunk => chunks.push(chunk));
      sfRes.on('end', () => {
        const buf = Buffer.concat(chunks);

        const parse = str => {
          if (sfRes.statusCode !== 200) {
            return reject(new Error('Sofascore ' + sfRes.statusCode + ': ' + str.slice(0,300)));
          }
          try { resolve(JSON.parse(str)); }
          catch(e) { reject(new Error('JSON invalido: ' + str.slice(0,200))); }
        };

        if (encoding === 'br') {
          zlib.brotliDecompress(buf, (e, r) => e ? reject(e) : parse(r.toString()));
        } else if (encoding === 'gzip') {
          zlib.gunzip(buf, (e, r) => e ? reject(e) : parse(r.toString()));
        } else if (encoding === 'deflate') {
          zlib.inflate(buf, (e, r) => e ? reject(e) : parse(r.toString()));
        } else {
          parse(buf.toString());
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Timeout')); });
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
  if (!q || q.length < 2) return res.status(400).json({ error: 'Parametro q requerido' });
  try {
    const data = await sfGet('/search/teams?q=' + encodeURIComponent(q) + '&sport=football');
    res.json(data);
  } catch(e) {
    console.error('[/search]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// 2. Ultimos partidos de un equipo
// GET /team/17/events?page=0
app.get('/team/:id/events', async (req, res) => {
  const page = parseInt(req.query.page) || 0;
  try {
    const data = await sfGet('/team/' + req.params.id + '/events/last/' + page);
    res.json(data);
  } catch(e) {
    console.error('[/team/events]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// 3. Estadisticas (XG) de un partido
// GET /event/12345678/statistics
app.get('/event/:id/statistics', async (req, res) => {
  try {
    const data = await sfGet('/event/' + req.params.id + '/statistics');
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
app.listen(PORT, () => console.log('XG Backend corriendo en puerto ' + PORT));
