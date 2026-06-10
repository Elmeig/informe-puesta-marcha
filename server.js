const http = require('http');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Busboy = require('busboy');
const mammoth = require('mammoth');
const docx = require('docx');

const PORT = 3003;
const DATA_DIR = path.join(__dirname, 'data');
const JSON_FILE = path.join(DATA_DIR, 'reports.json');
const IMAGES_DIR = path.join(DATA_DIR, 'images');

// Path to the Asistencia Técnica data (for autocomplete)
const ASISTENCIA_DATA = path.resolve(__dirname, '..', 'asistencia-tecnica', 'data', 'records.json');

const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
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

  // ── DOCX Export ─────────────────────────────────────
  const exportMatch = urlPath.match(/^\/api\/export\/([^/]+)$/);
  if (exportMatch && method === 'GET') {
    const id = exportMatch[1];
    const report = reports.find(r => r.id === id);
    if (!report) return json(req, res, { error: 'Not found' }, 404);

    try {
      const buf = await buildDocx(report);
      const safeName = (report.cliente || 'Informe').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
      res.writeHead(200, Object.assign({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="Puesta_en_Marcha_${safeName}.docx"`,
        'Content-Length': buf.length,
      }, corsHeaders(req)));
      return res.end(buf);
    } catch (e) {
      console.error('Export error:', e);
      return json(req, res, { error: 'Export failed' }, 500);
    }
  }

  // ── Serve report images ─────────────────────────────
  const imgMatch = urlPath.match(/^\/api\/images\/([^/]+)\/([^/]+)$/);
  if (imgMatch && method === 'GET') {
    const reportId = imgMatch[1];
    const filename = imgMatch[2];
    // Sanitize filename to prevent path traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.writeHead(400); return res.end('Bad request');
    }
    const imgPath = path.join(IMAGES_DIR, reportId, filename);
    if (!fs.existsSync(imgPath)) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(filename).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    const buf = fs.readFileSync(imgPath);
    res.writeHead(200, Object.assign({ 'Content-Type': mime, 'Content-Length': buf.length, 'Cache-Control': 'public, max-age=86400' }, corsHeaders(req)));
    return res.end(buf);
  }

  // ── Upload images for a report's diary entry ───────
  const uploadMatch = urlPath.match(/^\/api\/reports\/([^/]+)\/upload-images$/);
  if (uploadMatch && method === 'POST') {
    const reportId = uploadMatch[1];
    const report = reports.find(r => r.id === reportId);
    if (!report) return json(req, res, { error: 'Report not found' }, 404);

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return json(req, res, { error: 'multipart/form-data required' }, 400);
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });
    const uploadedFiles = [];
    let dayIndex = -1; // -1 means "final photos"
    
    busboy.on('field', (name, val) => {
      if (name === 'dayIndex') dayIndex = parseInt(val);
    });

    busboy.on('file', (field, stream, info) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const ct = info.mimeType || 'image/jpeg';
        const ext = ct.includes('png') ? '.png' : ct.includes('gif') ? '.gif' : '.jpg';
        // Find next available image number for this report
        const existingImages = (report.images || []).length;
        const imgNum = existingImages + uploadedFiles.length + 1;
        const filename = `img_${String(imgNum).padStart(3, '0')}${ext}`;
        uploadedFiles.push({ filename, buffer, contentType: ct });
      });
    });

    busboy.on('finish', () => {
      if (uploadedFiles.length === 0) {
        return json(req, res, { error: 'No files received' }, 400);
      }

      // Ensure image directory exists
      const imgDir = path.join(IMAGES_DIR, reportId);
      if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

      // Save files to disk
      const savedFilenames = [];
      for (const file of uploadedFiles) {
        const imgPath = path.join(imgDir, file.filename);
        fs.writeFileSync(imgPath, file.buffer);
        if (!report.images) report.images = [];
        report.images.push({ filename: file.filename, contentType: file.contentType });
        savedFilenames.push(file.filename);
      }

      // Associate with diary entry or final photos
      if (dayIndex >= 0 && report.diario && report.diario[dayIndex]) {
        if (!report.diario[dayIndex].images) report.diario[dayIndex].images = [];
        report.diario[dayIndex].images.push(...savedFilenames);
      } else {
        // Add to finalImages
        if (!report.finalImages) report.finalImages = [];
        report.finalImages.push(...savedFilenames);
      }

      saveReports(reports);
      return json(req, res, { uploaded: savedFilenames.length, filenames: savedFilenames });
    });

    req.pipe(busboy);
    return;
  }

  // ── DOCX Import ─────────────────────────────────────
  if (urlPath === '/api/import' && method === 'POST') {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return json(req, res, { error: 'multipart/form-data required' }, 400);
    }

    const busboy = Busboy({ headers: { 'content-type': contentType } });
    let fileBuffer = null;

    busboy.on('file', (field, stream, info) => {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => { fileBuffer = Buffer.concat(chunks); });
    });

    busboy.on('finish', async () => {
      if (!fileBuffer) return json(req, res, { error: 'No file received' }, 400);

      try {
        const result = await parseDocxImport(fileBuffer);
        if (result.error) return json(req, res, { error: result.error }, 400);

        // Check for duplicates (same client + same dates)
        const isDuplicate = reports.some(r =>
          r.cliente === result.cliente &&
          r.fecha_inicio === result.fecha_inicio &&
          r.fecha_fin === result.fecha_fin
        );

        if (isDuplicate) {
          return json(req, res, { inserted: 0, skipped: 1, message: 'Informe duplicado (mismo cliente y fechas)' });
        }

        const reportId = uuidv4();

        // Save extracted images to disk
        const images = [];
        if (result.images && result.images.length > 0) {
          const imgDir = path.join(IMAGES_DIR, reportId);
          if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });
          for (const img of result.images) {
            const imgPath = path.join(imgDir, img.filename);
            fs.writeFileSync(imgPath, img.buffer);
            images.push({ filename: img.filename, contentType: img.contentType });
          }
        }

        const newReport = {
          id: reportId,
          cliente: result.cliente,
          fecha_inicio: result.fecha_inicio,
          fecha_fin: result.fecha_fin,
          tecnicos: result.tecnicos,
          diario: result.diario,
          notas_adicionales: result.notas_adicionales,
          images: images,
          finalImages: result.finalImages || [],
          created_at: new Date().toISOString()
        };
        reports.push(newReport);
        saveReports(reports);
        return json(req, res, { inserted: 1, skipped: 0, imageCount: images.length, report: newReport }, 201);
      } catch (e) {
        console.error('Import error:', e);
        return json(req, res, { error: 'Failed to parse DOCX file' }, 400);
      }
    });

    req.pipe(busboy);
    return;
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

// ─── DOCX Export Builder ─────────────────────────────
const { Document, Packer, Paragraph, Table, TableRow, TableCell,
        TextRun, ImageRun, AlignmentType, WidthType, BorderStyle, HeadingLevel,
        ShadingType, TableLayoutType, VerticalAlign, PageBreak, TabStopPosition,
        TabStopType, Tab } = docx;

const BRAND_BLUE = '1E40AF';
const ACCENT_BLUE = '3B82F6';
const LIGHT_BG = 'F0F5FF';
const DARK_TEXT = '1E293B';
const MUTED_TEXT = '64748B';

// Day name lookup for date formatting
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function formatDateNice(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    return `${DAY_NAMES[d.getDay()]} ${d.getDate()} de ${MONTH_NAMES[d.getMonth()]} de ${d.getFullYear()}`;
  } catch (e) { return dateStr; }
}

function buildDocx(report) {
  const diario = report.diario || [];
  const children = [];

  // ═══ COVER SECTION ═══════════════════════════════════
  // Spacer
  children.push(new Paragraph({ spacing: { before: 1200 } }));

  // Main title
  children.push(new Paragraph({
    children: [new TextRun({ text: 'INFORME DE', font: 'Calibri', size: 44, color: MUTED_TEXT })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 0 },
  }));
  children.push(new Paragraph({
    children: [new TextRun({ text: 'PUESTA EN MARCHA', font: 'Calibri', size: 56, bold: true, color: BRAND_BLUE })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
  }));

  // Decorative line
  children.push(new Paragraph({
    children: [new TextRun({ text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', font: 'Calibri', size: 20, color: ACCENT_BLUE })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 400 },
  }));

  // Client name — large and prominent
  children.push(new Paragraph({
    children: [new TextRun({ text: report.cliente || '', font: 'Calibri', size: 40, bold: true, color: DARK_TEXT })],
    alignment: AlignmentType.CENTER,
    spacing: { after: 300 },
  }));

  // Info details — clean lines
  const infoItems = [
    { label: 'Período', value: `${report.fecha_inicio || '—'} a ${report.fecha_fin || '—'}` },
    { label: 'Técnicos', value: report.tecnicos || '—' },
  ];
  for (const item of infoItems) {
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${item.label}: `, font: 'Calibri', size: 22, color: MUTED_TEXT }),
        new TextRun({ text: item.value, font: 'Calibri', size: 22, color: DARK_TEXT, bold: true }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
    }));
  }

  // Page break after cover
  children.push(new Paragraph({ children: [new PageBreak()] }));

  // ═══ DIARY ENTRIES ═══════════════════════════════════
  diario.forEach((day, dayIdx) => {
    // Day header — styled with bottom border
    const dateDisplay = formatDateNice(day.fecha);
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `📅  `, font: 'Calibri', size: 24 }),
        new TextRun({ text: dateDisplay || day.fecha, font: 'Calibri', size: 28, bold: true, color: BRAND_BLUE }),
      ],
      spacing: { before: dayIdx > 0 ? 400 : 100, after: 60 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_BLUE },
      },
    }));

    // Description paragraphs
    const descLines = (day.descripcion || '').split('\n');
    for (const line of descLines) {
      if (!line.trim()) continue;
      children.push(new Paragraph({
        children: [new TextRun({ text: line, font: 'Calibri', size: 20, color: DARK_TEXT })],
        spacing: { after: 60 },
      }));
    }

    // Inline images for this day
    const dayImages = day.images || [];
    if (dayImages.length > 0) {
      children.push(new Paragraph({ spacing: { before: 120, after: 60 } }));
      for (const imgFilename of dayImages) {
        const imgMeta = (report.images || []).find(m => m.filename === imgFilename);
        const imgPath = path.join(IMAGES_DIR, report.id, imgFilename);
        if (fs.existsSync(imgPath)) {
          const imgBuf = fs.readFileSync(imgPath);
          try {
            children.push(new Paragraph({
              children: [
                new ImageRun({
                  data: imgBuf,
                  transformation: { width: 450, height: 338 },
                }),
              ],
              alignment: AlignmentType.CENTER,
              spacing: { after: 120 },
            }));
          } catch (e) {
            console.warn('Could not embed image:', imgFilename, e.message);
          }
        }
      }
    }

    // Subtle separator between days (not on last)
    if (dayIdx < diario.length - 1) {
      children.push(new Paragraph({
        children: [new TextRun({ text: '', font: 'Calibri', size: 8 })],
        spacing: { before: 200, after: 200 },
        border: {
          bottom: { style: BorderStyle.DOTTED, size: 1, color: 'CBD5E1' },
        },
      }));
    }
  });

  // ═══ NOTES SECTION ═══════════════════════════════════
  if (report.notas_adicionales) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: '📝  ', font: 'Calibri', size: 24 }),
        new TextRun({ text: 'NOTAS ADICIONALES', font: 'Calibri', size: 28, bold: true, color: BRAND_BLUE }),
      ],
      spacing: { after: 60 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_BLUE },
      },
    }));
    children.push(new Paragraph({ spacing: { after: 120 } }));
    for (const line of report.notas_adicionales.split('\n')) {
      children.push(new Paragraph({
        children: [new TextRun({ text: line, font: 'Calibri', size: 20, color: DARK_TEXT })],
        spacing: { after: 60 },
      }));
    }
  }

  // ═══ FINAL PHOTOS SECTION ════════════════════════════
  const finalImgs = (report.finalImages || []);
  if (finalImgs.length > 0) {
    children.push(new Paragraph({ children: [new PageBreak()] }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: '📸  ', font: 'Calibri', size: 24 }),
        new TextRun({ text: 'FOTOS FINALES', font: 'Calibri', size: 28, bold: true, color: BRAND_BLUE }),
      ],
      spacing: { after: 200 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: ACCENT_BLUE },
      },
    }));
    for (const imgFilename of finalImgs) {
      const imgPath = path.join(IMAGES_DIR, report.id, imgFilename);
      if (fs.existsSync(imgPath)) {
        const imgBuf = fs.readFileSync(imgPath);
        try {
          children.push(new Paragraph({
            children: [
              new ImageRun({
                data: imgBuf,
                transformation: { width: 450, height: 338 },
              }),
            ],
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
          }));
        } catch (e) {
          console.warn('Could not embed final image:', imgFilename, e.message);
        }
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 900, right: 900, bottom: 900, left: 900 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// ─── DOCX Import Parser ──────────────────────────────
async function parseDocxImport(buffer) {
  // Step 1: Extract raw text for field parsing
  const rawResult = await mammoth.extractRawText({ buffer });
  const text = rawResult.value || '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Step 2: Extract images AND track their position in the HTML flow
  const extractedImages = [];
  let imgCounter = 0;

  const htmlResult = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(function(image) {
      return image.read().then(function(imageBuffer) {
        imgCounter++;
        const ct = image.contentType || 'image/png';
        const ext = ct.includes('jpeg') || ct.includes('jpg') ? '.jpg'
                  : ct.includes('gif') ? '.gif'
                  : ct.includes('webp') ? '.webp'
                  : ct.includes('svg') ? '.svg'
                  : '.png';
        const filename = `img_${String(imgCounter).padStart(3, '0')}${ext}`;
        extractedImages.push({ filename, buffer: imageBuffer, contentType: ct });
        return { src: `__IMG_${imgCounter}__` };
      });
    })
  });

  // Step 3: Analyze HTML flow to associate images with diary entries
  const html = htmlResult.value || '';
  const dayNameRe = /(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/gi;
  const imgRe = /__IMG_(\d+)__/g;
  const noteRe = /ADDITIONAL\s+NOTE/gi;
  const finalPhotoRe = /FINAL\s+PHOTOS/gi;

  // Build position map of all markers
  const markers = [];
  let m;

  while ((m = dayNameRe.exec(html)) !== null) {
    const rawDate = m[2];
    const parts = rawDate.split('/');
    let fecha = rawDate;
    if (parts.length === 3) {
      const dd = parts[0].padStart(2, '0');
      const mm = parts[1].padStart(2, '0');
      const yyyy = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
      fecha = `${yyyy}-${mm}-${dd}`;
    }
    markers.push({ type: 'DAY', fecha, pos: m.index });
  }
  while ((m = imgRe.exec(html)) !== null) {
    markers.push({ type: 'IMG', num: parseInt(m[1]), pos: m.index });
  }
  while ((m = noteRe.exec(html)) !== null) {
    markers.push({ type: 'NOTE', pos: m.index });
  }
  while ((m = finalPhotoRe.exec(html)) !== null) {
    markers.push({ type: 'FINAL', pos: m.index });
  }
  markers.sort((a, b) => a.pos - b.pos);

  // Walk through markers and assign images to the current day
  const dayImageMap = {}; // fecha -> [filename, ...]
  const finalImageList = [];
  let currentDay = null;
  let inFinal = false;

  for (const marker of markers) {
    if (marker.type === 'DAY') {
      currentDay = marker.fecha;
      inFinal = false;
      if (!dayImageMap[currentDay]) dayImageMap[currentDay] = [];
    } else if (marker.type === 'FINAL') {
      inFinal = true;
      currentDay = null;
    } else if (marker.type === 'NOTE') {
      currentDay = null;
      inFinal = false;
    } else if (marker.type === 'IMG') {
      const img = extractedImages[marker.num - 1];
      if (img) {
        if (inFinal) {
          finalImageList.push(img.filename);
        } else if (currentDay) {
          dayImageMap[currentDay].push(img.filename);
        } else {
          // Image before any day — could be header/logo, add to final
          finalImageList.push(img.filename);
        }
      }
    }
  }

  // Step 4: Parse structured fields (same as before)
  let cliente = '', fecha_inicio = '', fecha_fin = '', tecnicos = '', notas_adicionales = '';
  const diario = [];

  const isFormatB = lines.some(l => /^CUSTOMER\s+NAME\s*:/i.test(l));

  if (isFormatB) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^CUSTOMER\s+NAME\s*:/i.test(line)) {
        cliente = line.replace(/^CUSTOMER\s+NAME\s*:\s*/i, '').trim();
      } else if (/^DATE\s*:/i.test(line)) {
        const dateStr = line.replace(/^DATE\s*:\s*/i, '').trim();
        fecha_inicio = dateStr;
        fecha_fin = dateStr;
      } else if (/^EQUIPMENT\s*:/i.test(line)) {
        const equip = line.replace(/^EQUIPMENT\s*:\s*/i, '').trim();
        if (!tecnicos) tecnicos = equip;
      }
    }

    const dayLineRe = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
    let inAction = false;
    let inNotes = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^ACTION\s*:/i.test(line)) { inAction = true; inNotes = false; continue; }
      if (/^ADDITIONAL\s+NOTE\s*:/i.test(line)) { inAction = false; inNotes = true; continue; }
      if (/^PURPOSE\s+OF\s+VISIT\s*:/i.test(line)) continue;
      if (/^FINAL\s+PHOTOS/i.test(line)) { inNotes = false; continue; }

      if (inNotes) {
        notas_adicionales += (notas_adicionales ? '\n' : '') + line;
      } else if (inAction) {
        const dayMatch = line.match(dayLineRe);
        if (dayMatch) {
          const rawDate = dayMatch[2];
          const parts = rawDate.split('/');
          let fecha = rawDate;
          if (parts.length === 3) {
            const dd = parts[0].padStart(2, '0');
            const mm = parts[1].padStart(2, '0');
            const yyyy = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
            fecha = `${yyyy}-${mm}-${dd}`;
          }

          const descLines = [];
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (dayLineRe.test(nextLine)) break;
            if (/^ADDITIONAL\s+NOTE\s*:/i.test(nextLine)) break;
            if (/^FINAL\s+PHOTOS/i.test(nextLine)) break;
            i++;
            descLines.push(lines[i]);
          }
          diario.push({
            fecha,
            descripcion: descLines.join('\n'),
            images: dayImageMap[fecha] || []
          });
        }
      }
    }

    if (diario.length > 0) {
      const sorted = [...diario].sort((a, b) => a.fecha.localeCompare(b.fecha));
      fecha_inicio = sorted[0].fecha;
      fecha_fin = sorted[sorted.length - 1].fecha;
    }

  } else {
    // Format A (our export)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/cliente\s*\/?\s*proyecto/i.test(line)) {
        const after = line.replace(/.*cliente\s*\/?\s*proyecto\s*/i, '').trim();
        cliente = after || (lines[i + 1] || '').trim();
        if (!after && lines[i + 1]) i++;
      } else if (/fecha\s+inicio/i.test(line)) {
        const after = line.replace(/.*fecha\s+inicio\s*/i, '').trim();
        fecha_inicio = after || (lines[i + 1] || '').trim();
        if (!after && lines[i + 1]) i++;
      } else if (/fecha\s+fin/i.test(line)) {
        const after = line.replace(/.*fecha\s+fin\s*/i, '').trim();
        fecha_fin = after || (lines[i + 1] || '').trim();
        if (!after && lines[i + 1]) i++;
      } else if (/t.cnicos?\s+involucrados?/i.test(line)) {
        const after = line.replace(/.*t.cnicos?\s+involucrados?\s*/i, '').trim();
        tecnicos = after || (lines[i + 1] || '').trim();
        if (!after && lines[i + 1]) i++;
      }
    }

    let inDiary = false;
    let inNotas = false;
    const dateRe = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/diario\s+de\s+puesta/i.test(line)) { inDiary = true; inNotas = false; continue; }
      if (/notas?\s+adicionales?/i.test(line)) { inDiary = false; inNotas = true; continue; }
      if (/tareas\s+realizadas?/i.test(line)) continue;
      if (line === 'Fecha') continue;
      if (/fotos?\s+finales?/i.test(line)) { inDiary = false; continue; }

      if (inNotas) {
        notas_adicionales += (notas_adicionales ? '\n' : '') + line;
      } else if (inDiary) {
        if (dateRe.test(line)) {
          const descLines = [];
          while (i + 1 < lines.length && !dateRe.test(lines[i + 1]) && !/notas?\s+adicionales?/i.test(lines[i + 1]) && !/fotos?\s+finales?/i.test(lines[i + 1])) {
            i++;
            if (lines[i] === 'Fecha' || /tareas\s+realizadas?/i.test(lines[i])) continue;
            descLines.push(lines[i]);
          }
          diario.push({
            fecha: line,
            descripcion: descLines.join('\n'),
            images: dayImageMap[line] || []
          });
        }
      }
    }
  }

  if (!cliente) {
    return { error: 'No se pudo extraer el cliente del documento. Asegúrese de que el documento contiene "CUSTOMER NAME:" o "Cliente / Proyecto".' };
  }

  return { cliente, fecha_inicio, fecha_fin, tecnicos, diario, notas_adicionales, images: extractedImages, finalImages: finalImageList };
}

server.listen(PORT, () => {
  console.log(`Puesta en Marcha server running on port ${PORT}`);
});
