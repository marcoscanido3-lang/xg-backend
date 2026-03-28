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

// ── FBref IDs de ligas (las más usadas)
// https://fbref.com/en/comps/
const LEAGUE_IDS = {
  'Premier League':    9,
  'La Liga':           12,
  'Bundesliga':        20,
  'Serie A':           11,
  'Ligue 1':           13,
  'Champions League':  8,
  'Europa League':     19,
  'MLS':               22,
  'Eredivisie':        23,
  'Primeira Liga':     32,
};

// ── HTTP helper con descompresión
function httpGet(hostname, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname,
      path,
      method: 'GET',
      headers: {
        'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        'Accept':          'text/html,application/xhtml+xml,*/*;q=0.9',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control':   'no-cache',
      }
    }, sfRes => {
      const enc    = sfRes.headers['content-encoding'] || '';
      const chunks = [];
      sfRes.on('data', c => chunks.push(c));
      sfRes.on('end', () => {
        const buf  = Buffer.concat(chunks);
        const done = str => resolve({ status: sfRes.statusCode, body: str, headers: sfRes.headers });
        if      (enc === 'gzip')    zlib.gunzip(buf,  (e,r) => e ? reject(e) : done(r.toString('utf8')));
        else if (enc === 'deflate') zlib.inflate(buf, (e,r) => e ? reject(e) : done(r.toString('utf8')));
        else                        done(buf.toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ── Parsear tabla HTML de FBref en array de objetos
function parseTable(html, tableId) {
  // Extraer la tabla por ID
  const tableRe = new RegExp('<table[^>]+id="' + tableId + '"[^>]*>([\\s\\S]*?)</table>', 'i');
  const tableMatch = html.match(tableRe);
  if (!tableMatch) return null;
  const tableHtml = tableMatch[0];

  // Extraer headers
  const thRe  = /<th[^>]+data-stat="([^"]+)"[^>]*>([^<]*(?:<[^/][^>]*>[^<]*<\/[^>]+>)?[^<]*)<\/th>/g;
  const headers = [];
  let m;
  const headSection = tableHtml.match(/<thead>([\s\S]*?)<\/thead>/i);
  if (headSection) {
    const headHtml = headSection[1];
    while ((m = thRe.exec(headHtml)) !== null) {
      headers.push(m[1]);
    }
  }

  // Extraer filas
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const tdRe = /<t[dh][^>]+data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  const bodySection = tableHtml.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!bodySection) return rows;

  let trMatch;
  while ((trMatch = trRe.exec(bodySection[1])) !== null) {
    const rowHtml = trMatch[1];
    const row = {};
    let tdMatch;
    while ((tdMatch = tdRe.exec(rowHtml)) !== null) {
      const stat = tdMatch[1];
      // Limpiar HTML tags y entidades
      const val  = tdMatch[2]
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ')
        .trim();
      row[stat] = val;
      // También capturar href del equipo si existe
      const hrefMatch = tdMatch[2].match(/href="([^"]+)"/);
      if (hrefMatch && stat === 'team') row['team_href'] = hrefMatch[1];
    }
    if (Object.keys(row).length > 2) rows.push(row);
  }
  return rows;
}

// ══════════════════════════════════════════════════════════════
// ENDPOINT 1: Buscar equipos
// GET /search?q=Liverpool&league=9
// Scrapea la tabla de equipos de FBref para la liga indicada
// ══════════════════════════════════════════════════════════════
app.get('/search', async (req, res) => {
  const q      = (req.query.q || '').toLowerCase().trim();
  const league = parseInt(req.query.league) || 9; // default Premier League

  if (q.length < 2) return res.status(400).json({ error: 'q requerido (min 2 chars)' });

  try {
    const { body, status } = await httpGet('fbref.com', `/en/comps/${league}/`);
    if (status !== 200) return res.status(502).json({ error: `FBref status ${status}` });

    // Parsear tabla de equipos
    const rows = parseTable(body, 'results' + new Date().getFullYear() + '1_overall') ||
                 parseTable(body, 'results' + (new Date().getFullYear()-1) + '1_overall') ||
                 parseTable(body, 'results20261_overall') ||
                 parseTable(body, 'results20251_overall') ||
                 parseTable(body, 'results20241_overall');

    if (!rows) {
      // Fallback: extraer links de equipos del HTML directamente
      const teamRe = /href="(\/en\/squads\/([a-f0-9]+)\/([^"\/]+)-Stats)"/g;
      const teams  = [];
      const seen   = new Set();
      let tm;
      while ((tm = teamRe.exec(body)) !== null) {
        const href = tm[1], id = tm[2];
        const name = tm[3].replace(/-/g,' ').replace(/\b\w/g, c=>c.toUpperCase());
        if (!seen.has(id) && name.toLowerCase().includes(q)) {
          seen.add(id);
          teams.push({ id, name, href: 'https://fbref.com' + href });
        }
      }
      return res.json({ teams: teams.slice(0,8) });
    }

    const filtered = rows
      .filter(r => r.team && r.team.toLowerCase().includes(q))
      .slice(0, 8)
      .map(r => ({
        name: r.team,
        href: r.team_href ? 'https://fbref.com' + r.team_href : null,
        xg:   parseFloat(r.xg)  || null,
        xga:  parseFloat(r.xga) || null,
        mp:   parseInt(r.mp)    || null,
      }));

    res.json({ teams: filtered });

  } catch(e) {
    console.error('[/search]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// ENDPOINT 2: XG de últimos partidos de un equipo (por URL FBref)
// GET /team-xg?href=/en/squads/822bd0ba/Liverpool-Stats&home=1
// home=1 → últimos 10 como local, home=0 → como visitante
// ══════════════════════════════════════════════════════════════
app.get('/team-xg', async (req, res) => {
  const href = req.query.href;
  const home = req.query.home !== '0'; // default true = local

  if (!href) return res.status(400).json({ error: 'href requerido' });

  try {
    // La página de fixtures del equipo tiene los XG partido por partido
    // Ej: /en/squads/822bd0ba/2025-2026/matchlogs/all_comps/schedule/Liverpool-Match-Logs
    const squadId   = href.match(/\/squads\/([a-f0-9]+)\//)?.[1];
    const slugMatch = href.match(/\/([^/]+)-Stats$/);
    const slug      = slugMatch ? slugMatch[1] : '';

    if (!squadId) return res.status(400).json({ error: 'href inválido' });

    // Intentar con temporada actual y anterior
    const years = [`${new Date().getFullYear()-1}-${new Date().getFullYear()}`, `${new Date().getFullYear()-2}-${new Date().getFullYear()-1}`];
    let rows = null;

    for (const year of years) {
      const path = `/en/squads/${squadId}/${year}/matchlogs/all_comps/schedule/${slug}-Match-Logs`;
      console.log('Fetching:', path);
      const { body, status } = await httpGet('fbref.com', path);
      if (status !== 200) continue;

      rows = parseTable(body, 'matchlogs_for');
      if (rows && rows.length > 0) break;
    }

    if (!rows || rows.length === 0) {
      // Fallback: página principal del equipo
      const { body } = await httpGet('fbref.com', href);
      rows = parseTable(body, 'matchlogs_for') || parseTable(body, 'matchlogs_all');
    }

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'No se encontraron partidos para este equipo' });
    }

    // Filtrar por venue (Home/Away) y solo partidos jugados (con resultado)
    const venueKey = home ? 'Home' : 'Away';
    const partidos = rows
      .filter(r => r.result && r.result !== '' && r.venue === venueKey)
      .slice(0, 10)
      .map(r => ({
        fecha:    r.date   || '',
        rival:    r.opponent || '',
        venue:    r.venue  || '',
        result:   r.result || '',
        gf:       r.gf     || '0',
        ga:       r.ga     || '0',
        xg:       parseFloat(r.xg)  || 0,
        xga:      parseFloat(r.xga) || 0,
      }));

    if (partidos.length === 0) {
      return res.status(404).json({ error: `No hay partidos como ${venueKey} con datos XG` });
    }

    const avgXG  = partidos.reduce((s,p) => s + p.xg,  0) / partidos.length;
    const avgXGA = partidos.reduce((s,p) => s + p.xga, 0) / partidos.length;

    res.json({ partidos, avgXG, avgXGA, total: partidos.length });

  } catch(e) {
    console.error('[/team-xg]', e.message);
    res.status(502).json({ error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// ENDPOINT 3: Lista de ligas disponibles
// GET /leagues
// ══════════════════════════════════════════════════════════════
app.get('/leagues', (_, res) => {
  res.json({ leagues: Object.entries(LEAGUE_IDS).map(([name, id]) => ({ name, id })) });
});

// ── Health check
app.get('/health', (_, res) => res.json({ ok: true, source: 'FBref', time: new Date().toISOString() }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('XG Backend (FBref) en puerto ' + PORT));
