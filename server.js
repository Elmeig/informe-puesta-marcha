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
        ShadingType, TableLayoutType, VerticalAlign } = docx;

const BRAND_BLUE = '1E40AF';
const HEADER_BG = 'EFF6FF';

function buildDocx(report) {
  const diario = report.diario || [];

  // Info table (Cliente, Período, Técnicos)
  const infoRows = [
    makeInfoRow('Cliente / Proyecto', report.cliente || ''),
    makeInfoRow('Fecha Inicio', report.fecha_inicio || ''),
    makeInfoRow('Fecha Fin', report.fecha_fin || ''),
    makeInfoRow('Técnicos Involucrados', report.tecnicos || ''),
  ];

  const infoTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: infoRows,
  });

  // Diary table
  const diaryHeaderRow = new TableRow({
    tableHeader: true,
    children: [
      new TableCell({
        width: { size: 20, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: BRAND_BLUE },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          children: [new TextRun({ text: 'Fecha', bold: true, color: 'FFFFFF', font: 'Calibri', size: 22 })],
          alignment: AlignmentType.CENTER,
        })],
      }),
      new TableCell({
        width: { size: 80, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: BRAND_BLUE },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          children: [new TextRun({ text: 'Tareas Realizadas', bold: true, color: 'FFFFFF', font: 'Calibri', size: 22 })],
          alignment: AlignmentType.CENTER,
        })],
      }),
    ],
  });

  const diaryRows = diario.map((d, i) => new TableRow({
    children: [
      new TableCell({
        shading: i % 2 === 0 ? { type: ShadingType.SOLID, color: HEADER_BG } : undefined,
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          children: [new TextRun({ text: d.fecha || '', font: 'Calibri', size: 20 })],
          alignment: AlignmentType.CENTER,
        })],
      }),
      new TableCell({
        shading: i % 2 === 0 ? { type: ShadingType.SOLID, color: HEADER_BG } : undefined,
        verticalAlign: VerticalAlign.TOP,
        children: (d.descripcion || '').split('\n').map(line =>
          new Paragraph({
            children: [new TextRun({ text: line, font: 'Calibri', size: 20 })],
            spacing: { after: 40 },
          })
        ),
      }),
    ],
  }));

  if (diaryRows.length === 0) {
    diaryRows.push(new TableRow({
      children: [
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '-', font: 'Calibri' })] })] }),
        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Sin registros diarios', font: 'Calibri', italics: true })] })] }),
      ],
    }));
  }

  const diaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.FIXED,
    rows: [diaryHeaderRow, ...diaryRows],
  });

  const children = [
    // Title
    new Paragraph({
      children: [new TextRun({ text: 'INFORME DE PUESTA EN MARCHA', bold: true, font: 'Calibri', size: 32, color: BRAND_BLUE })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 },
    }),
    // Info table
    infoTable,
    // Spacing
    new Paragraph({ spacing: { before: 300, after: 100 } }),
    // Diary heading
    new Paragraph({
      children: [new TextRun({ text: 'DIARIO DE PUESTA EN MARCHA', bold: true, font: 'Calibri', size: 26, color: BRAND_BLUE })],
      spacing: { after: 200 },
    }),
    // Diary table
    diaryTable,
  ];

  // Notas adicionales
  if (report.notas_adicionales) {
    children.push(
      new Paragraph({ spacing: { before: 300, after: 100 } }),
      new Paragraph({
        children: [new TextRun({ text: 'NOTAS ADICIONALES', bold: true, font: 'Calibri', size: 26, color: BRAND_BLUE })],
        spacing: { after: 200 },
      }),
      ...report.notas_adicionales.split('\n').map(line =>
        new Paragraph({ children: [new TextRun({ text: line, font: 'Calibri', size: 20 })], spacing: { after: 60 } })
      )
    );
  }

  // Images
  if (report.images && report.images.length > 0) {
    children.push(
      new Paragraph({ spacing: { before: 300, after: 100 } }),
      new Paragraph({
        children: [new TextRun({ text: 'FOTOS', bold: true, font: 'Calibri', size: 26, color: BRAND_BLUE })],
        spacing: { after: 200 },
      })
    );
    for (const img of report.images) {
      const imgPath = path.join(IMAGES_DIR, report.id, img.filename);
      if (fs.existsSync(imgPath)) {
        const imgBuf = fs.readFileSync(imgPath);
        try {
          children.push(
            new Paragraph({
              children: [
                new ImageRun({
                  data: imgBuf,
                  transformation: { width: 500, height: 375 },
                  type: img.contentType === 'image/png' ? 'png' : 'jpg',
                }),
              ],
              spacing: { after: 200 },
            })
          );
        } catch (e) {
          // Skip images that can't be embedded
          console.warn('Could not embed image:', img.filename, e.message);
        }
      }
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

function makeInfoRow(label, value) {
  return new TableRow({
    children: [
      new TableCell({
        width: { size: 30, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: BRAND_BLUE },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          children: [new TextRun({ text: label, bold: true, color: 'FFFFFF', font: 'Calibri', size: 22 })],
          spacing: { before: 60, after: 60 },
        })],
      }),
      new TableCell({
        width: { size: 70, type: WidthType.PERCENTAGE },
        shading: { type: ShadingType.SOLID, color: HEADER_BG },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({
          children: [new TextRun({ text: value, font: 'Calibri', size: 22 })],
          spacing: { before: 60, after: 60 },
        })],
      }),
    ],
  });
}

// ─── DOCX Import Parser ──────────────────────────────
async function parseDocxImport(buffer) {
  // Extract text
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value || '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Extract images using mammoth's convertToHtml with image handler
  const extractedImages = [];
  let imgCounter = 0;
  await mammoth.convertToHtml({ buffer }, {
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
        return { src: filename }; // placeholder, we don't use the HTML
      });
    })
  });

  let cliente = '', fecha_inicio = '', fecha_fin = '', tecnicos = '', notas_adicionales = '';
  const diario = [];

  // ── Detect format ──────────────────────────────────
  // Format A: Our export (labels: "Cliente / Proyecto", "Fecha Inicio", etc.)
  // Format B: Original Word template (labels: "CUSTOMER NAME:", "DATE:", "EQUIPMENT:", etc.)
  const isFormatB = lines.some(l => /^CUSTOMER\s+NAME\s*:/i.test(l));

  if (isFormatB) {
    // ── Parse Format B (original Word template) ──────
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^CUSTOMER\s+NAME\s*:/i.test(line)) {
        cliente = line.replace(/^CUSTOMER\s+NAME\s*:\s*/i, '').trim();
      } else if (/^DATE\s*:/i.test(line)) {
        const dateStr = line.replace(/^DATE\s*:\s*/i, '').trim();
        // Try to extract start and end dates from free text like "Del 21 al 31 de octubre del 2024"
        fecha_inicio = dateStr;
        fecha_fin = dateStr;
      } else if (/^EQUIPMENT\s*:/i.test(line)) {
        // Store equipment info in tecnicos if no techs found
        const equip = line.replace(/^EQUIPMENT\s*:\s*/i, '').trim();
        if (!tecnicos) tecnicos = equip;
      }
    }

    // Parse diary: day entries start with day-name + date (e.g., "Lunes 21/10/24", "MARTES 22/10/24")
    const dayNameRe = /^(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
    let inAction = false;
    let inNotes = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Section markers
      if (/^ACTION\s*:/i.test(line)) { inAction = true; inNotes = false; continue; }
      if (/^ADDITIONAL\s+NOTE\s*:/i.test(line)) { inAction = false; inNotes = true; continue; }
      if (/^PURPOSE\s+OF\s+VISIT\s*:/i.test(line)) continue;
      if (/^FINAL\s+PHOTOS/i.test(line)) { inNotes = false; continue; }

      if (inNotes) {
        notas_adicionales += (notas_adicionales ? '\n' : '') + line;
      } else if (inAction) {
        const dayMatch = line.match(dayNameRe);
        if (dayMatch) {
          const rawDate = dayMatch[2];
          // Normalize date: DD/MM/YY → DD/MM/YYYY
          let fecha = rawDate;
          const parts = rawDate.split('/');
          if (parts.length === 3 && parts[2].length === 2) {
            fecha = `${parts[0]}/${parts[1]}/20${parts[2]}`;
          }
          // Convert to YYYY-MM-DD for consistency
          if (parts.length === 3) {
            const dd = parts[0].padStart(2, '0');
            const mm = parts[1].padStart(2, '0');
            const yyyy = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
            fecha = `${yyyy}-${mm}-${dd}`;
          }

          // Collect description lines until next day or section
          const descLines = [];
          while (i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            if (dayNameRe.test(nextLine)) break;
            if (/^ADDITIONAL\s+NOTE\s*:/i.test(nextLine)) break;
            if (/^FINAL\s+PHOTOS/i.test(nextLine)) break;
            i++;
            descLines.push(lines[i]);
          }
          diario.push({ fecha, descripcion: descLines.join('\n') });
        }
      }
    }

    // Set fecha_inicio and fecha_fin from diary entries if possible
    if (diario.length > 0) {
      const sorted = [...diario].sort((a, b) => a.fecha.localeCompare(b.fecha));
      fecha_inicio = sorted[0].fecha;
      fecha_fin = sorted[sorted.length - 1].fecha;
    }

  } else {
    // ── Parse Format A (our export format) ────────────
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

    // Parse diary from our format
    let inDiary = false;
    let inNotas = false;
    const dateRe = /^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/diario\s+de\s+puesta/i.test(line)) { inDiary = true; inNotas = false; continue; }
      if (/notas?\s+adicionales?/i.test(line)) { inDiary = false; inNotas = true; continue; }
      if (/tareas\s+realizadas?/i.test(line)) continue;
      if (line === 'Fecha') continue;

      if (inNotas) {
        notas_adicionales += (notas_adicionales ? '\n' : '') + line;
      } else if (inDiary) {
        if (dateRe.test(line)) {
          const descLines = [];
          while (i + 1 < lines.length && !dateRe.test(lines[i + 1]) && !/notas?\s+adicionales?/i.test(lines[i + 1])) {
            i++;
            if (lines[i] === 'Fecha' || /tareas\s+realizadas?/i.test(lines[i])) continue;
            descLines.push(lines[i]);
          }
          diario.push({ fecha: line, descripcion: descLines.join('\n') });
        }
      }
    }
  }

  if (!cliente) {
    return { error: 'No se pudo extraer el cliente del documento. Asegúrese de que el documento contiene "CUSTOMER NAME:" o "Cliente / Proyecto".' };
  }

  return { cliente, fecha_inicio, fecha_fin, tecnicos, diario, notas_adicionales, images: extractedImages };
}

server.listen(PORT, () => {
  console.log(`Puesta en Marcha server running on port ${PORT}`);
});
