const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const PORT = 3003;
const DATA_DIR = path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'reports.json');

// Path to the Asistencia Técnica data (for autocomplete)
const ASISTENCIA_DATA = path.resolve(__dirname, '..', 'asistencia-tecnica', 'data', 'records.json');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(JSON_FILE)) fs.writeFileSync(JSON_FILE, '[]');

function loadReports() {
  try {
    return JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));
  } catch (_) {
    return [];
  }
}

function saveReports(reports) {
  fs.writeFileSync(JSON_FILE, JSON.stringify(reports, null, 2));
}

let reports = loadReports();

const ALLOWED_ORIGINS = new Set(
  (process.env.ALLOWED_ORIGINS ||
   'https://bugtracker.tail51f3b0.ts.net,http://127.0.0.1:3001,http://127.0.0.1:3002,http://localhost:3001,http://localhost:3002,http://127.0.0.1:3003,http://localhost:3003'
  ).split(',').map(s => s.trim()).filter(Boolean)
);

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'null',
    'Vary': 'Origin',
  };
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
  });
}

function json(req, res, data, status = 200) {
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json',
  }, corsHeaders(req)));
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  const method = req.method;
  const urlPath = req.url.split('?')[0];

  if (method === 'OPTIONS') {
    res.writeHead(204, Object.assign({
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }, corsHeaders(req)));
    return res.end();
  }

  if (urlPath === '/api/reports' && method === 'GET') {
    const sorted = [...reports].sort((a, b) => (b.fecha_inicio || '').localeCompare(a.fecha_inicio || ''));
    return json(req, res, { total: sorted.length, reports: sorted });
  }

  // Autocomplete: pull unique clients + technicians from Asistencia Técnica data
  if (urlPath === '/api/autocomplete' && method === 'GET') {
    try {
      let asistenciaRecords = [];
      if (fs.existsSync(ASISTENCIA_DATA)) {
        asistenciaRecords = JSON.parse(fs.readFileSync(ASISTENCIA_DATA, 'utf8'));
      }
      // Also merge in data from puesta-marcha's own reports
      const allClients = new Set();
      const allTechs = new Set();
      asistenciaRecords.forEach(r => {
        if (r.cliente) allClients.add(r.cliente.trim());
        if (r.tecnico) allTechs.add(r.tecnico.trim());
      });
      reports.forEach(r => {
        if (r.cliente) allClients.add(r.cliente.trim());
        if (r.tecnicos) allTechs.add(r.tecnicos.trim());
      });
      return json(req, res, {
        clients: [...allClients].sort(),
        technicians: [...allTechs].sort()
      });
    } catch (e) {
      return json(req, res, { clients: [], technicians: [] });
    }
  }

  if (urlPath === '/api/reports' && method === 'POST') {
    try {
      const body = await parseBody(req);
      const report = {
        id: uuidv4(),
        cliente: String(body.cliente || '').trim(),
        fecha_inicio: String(body.fecha_inicio || '').trim(),
        fecha_fin: String(body.fecha_fin || '').trim(),
        tecnicos: String(body.tecnicos || '').trim(),
        diario: Array.isArray(body.diario) ? body.diario : [],
        notas_adicionales: String(body.notas_adicionales || '').trim(),
        created_at: new Date().toISOString()
      };
      reports.push(report);
      saveReports(reports);
      return json(req, res, report, 201);
    } catch (e) {
      return json(req, res, { error: 'Invalid JSON' }, 400);
    }
  }

  const updateMatch = urlPath.match(/^\/api\/reports\/([^/]+)$/);
  if (updateMatch && method === 'PUT') {
    const id = updateMatch[1];
    try {
      const body = await parseBody(req);
      const idx = reports.findIndex(r => r.id === id);
      if (idx === -1) return json(req, res, { error: 'Not found' }, 404);
      
      const updated = {
        ...reports[idx],
        cliente: String(body.cliente || '').trim(),
        fecha_inicio: String(body.fecha_inicio || '').trim(),
        fecha_fin: String(body.fecha_fin || '').trim(),
        tecnicos: String(body.tecnicos || '').trim(),
        diario: Array.isArray(body.diario) ? body.diario : reports[idx].diario,
        notas_adicionales: String(body.notas_adicionales || '').trim(),
        updated_at: new Date().toISOString()
      };
      reports[idx] = updated;
      saveReports(reports);
      return json(req, res, updated);
    } catch (e) {
      return json(req, res, { error: 'Invalid JSON' }, 400);
    }
  }

  const deleteMatch = urlPath.match(/^\/api\/reports\/([^/]+)$/);
  if (deleteMatch && method === 'DELETE') {
    const id = deleteMatch[1];
    const idx = reports.findIndex(r => r.id === id);
    if (idx === -1) return json(req, res, { error: 'Not found' }, 404);
    const deleted = reports.splice(idx, 1)[0];
    saveReports(reports);
    return json(req, res, { deleted: deleted.id });
  }

  let filePath = path.join(__dirname, 'public', urlPath === '/' ? 'index.html' : urlPath);
  const publicDir = path.join(__dirname, 'public');
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== publicDir) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath)) {
    if (urlPath !== '/favicon.ico' && !urlPath.startsWith('/api/')) {
        filePath = path.join(__dirname, 'public', 'index.html');
        if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            return res.end('Not found');
        }
    } else {
        res.writeHead(404);
        return res.end('Not found');
    }
  }
  
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  const content = fs.readFileSync(filePath);
  res.writeHead(200, { 'Content-Type': mime });
  res.end(content);
});

server.listen(PORT, () => {
  console.log(`Puesta en Marcha server running on port ${PORT}`);
});
