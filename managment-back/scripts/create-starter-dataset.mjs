/**
 * Create the 6 starter dataset files specified in Section 12 of the spec.
 * Output: managment-back/test-data/
 *
 * Run: node scripts/create-starter-dataset.mjs
 */
import * as XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'test-data');

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── FILE 1: formulations_clean.xlsx ───────────────────────────────────────────
// 4 complete formulations — happy path → READY state
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['', 'APP %', 'PER', 'MEL', 'Adhesion', 'Expansion Ratio'],
    ['EXP-001', 25, 12, 8,  88, 19.4],
    ['EXP-002', 28, 14, 9,  90, 20.1],
    ['EXP-003', 30, 15, 10, 92, 21.3],
    ['EXP-004', 30, 15, 10, 92, 23.8],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Formulations');
  XLSX.writeFile(wb, path.join(OUT_DIR, 'formulations_clean.xlsx'));
  console.log('✓ formulations_clean.xlsx');
}

// ── FILE 2: formulations_mixed_labels.xlsx ────────────────────────────────────
// Same data with full chemical names — tests normalization layer
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['', 'Ammonium Polyphosphate', 'Pentaerythritol', 'Melamine', 'Bond Strength'],
    ['Run-A', 25, 12, 8, 88],
    ['Run-B', 28, 14, 9, 90],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Formulations');
  XLSX.writeFile(wb, path.join(OUT_DIR, 'formulations_mixed_labels.xlsx'));
  console.log('✓ formulations_mixed_labels.xlsx');
}

// ── FILE 3: scanned_report.pdf ────────────────────────────────────────────────
// Minimal PDF with no embedded text layer — simulates scanned image PDF
// pdf-parse will return < 50 chars → OCR_REQUIRED detection
{
  // Minimal valid PDF with only a blank page (no text stream)
  const minimalPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
trailer<</Size 4/Root 1 0 R>>
startxref
204
%%EOF`;
  fs.writeFileSync(path.join(OUT_DIR, 'scanned_report.pdf'), minimalPdf, 'latin1');
  console.log('✓ scanned_report.pdf (image-only simulation — OCR_REQUIRED)');
}

// ── FILE 4: conflicting_data.pdf ──────────────────────────────────────────────
// Contains EXP-004 with adhesion=89, expansion=22.0 — conflicts with file 1 (adhesion=92, expansion=23.8)
// Stored as .txt — engine handles .txt the same as PDF text content
{
  const text = `Laboratory Report — Fresco Colors Research
Project: Intumescent Coating Development

Experiment EXP-004 was repeated under modified conditions.
Adhesion measured at 89.
Expansion ratio: 22.0.
APP = 30.

Note: These measurements were taken after a 30-day aging period.
The results indicate that aging reduces adhesion performance significantly.
`;
  fs.writeFileSync(path.join(OUT_DIR, 'conflicting_data.txt'), text, 'utf-8');
  // Also keep a .pdf version using createTextPdf (may fail to parse → OCR_REQUIRED in engine)
  const pdfContent = createTextPdf(text);
  fs.writeFileSync(path.join(OUT_DIR, 'conflicting_data.pdf'), pdfContent);
  console.log('✓ conflicting_data.txt + conflicting_data.pdf (EXP-004 adhesion=89, expansion=22.0)');
}

// ── FILE 5: irrelevant_document.pdf ──────────────────────────────────────────
// Supplier purchase contract — no lab data
// Stored as .txt — engine handles .txt the same as PDF text content
{
  const text = `PURCHASE ORDER AGREEMENT

Supplier: Chemical Supplies Ltd.
Buyer: Fresco Colors Research Laboratory
Date: 01 January 2026

Payment Terms: Net 30 days from invoice date.
Delivery Schedule: Within 14 business days of order confirmation.
Shipping Method: DHL Express, insured freight.

Line Items:
  1. Bulk chemical containers x 100 units — USD 4,500
  2. Laboratory glassware set x 20 units — USD 1,200
  3. Safety equipment kit x 5 units — USD 800

Total Invoice Amount: USD 6,500
Tax (17%): USD 1,105
Grand Total: USD 7,605

Terms and Conditions:
All goods remain property of seller until full payment received.
Returns accepted within 7 days of delivery with original packaging.
Disputes subject to jurisdiction of local commercial court.

Authorized Signature: ___________________
`;
  fs.writeFileSync(path.join(OUT_DIR, 'irrelevant_document.txt'), text, 'utf-8');
  const pdfContent = createTextPdf(text);
  fs.writeFileSync(path.join(OUT_DIR, 'irrelevant_document.pdf'), pdfContent);
  console.log('✓ irrelevant_document.txt + irrelevant_document.pdf (supplier contract — no lab data)');
}

// ── FILE 6: broken_rows.xlsx ──────────────────────────────────────────────────
// Excel with missing cells and shifted columns — tests parser resilience
{
  const ws = XLSX.utils.aoa_to_sheet([
    ['', 'APP', 'PER', 'MEL', 'Adhesion'],
    ['EXP-A', 30,  null, 10, 92],  // Row 1: missing PER
    ['EXP-B', null, 12,  8,  88],  // Row 2: missing APP
    ['EXP-C', 28,   14,  9,  null],// Row 3: missing Adhesion
    ['', null, null, null, null],  // Row 4: entirely empty
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Formulations');
  XLSX.writeFile(wb, path.join(OUT_DIR, 'broken_rows.xlsx'));
  console.log('✓ broken_rows.xlsx (missing cells — parser resilience)');
}

console.log(`\nAll 6 starter dataset files created in ${OUT_DIR}`);
console.log('Upload these files to a project in managment-front to run acceptance tests.');

/**
 * Create a minimal but valid PDF with extractable text content.
 * Uses compact single-line object format for reliable XRef offset calculation.
 * Compatible with pdf-parse / pdfjs-dist.
 */
function createTextPdf(text) {
  function esc(s) { return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }

  // Build content stream
  const lines = text.split('\n').slice(0, 55);
  const ops = ['BT', '/F1 10 Tf'];
  let first = true;
  for (const line of lines) {
    const safe = esc(line.slice(0, 95));
    ops.push(first ? '50 740 Td' : '0 -13 Td');
    ops.push(`(${safe}) Tj`);
    first = false;
  }
  ops.push('ET');
  const stream = ops.join('\n');
  const streamBuf = Buffer.from(stream, 'latin1');

  // Compact single-line objects (offsets are easy to compute)
  const pieces = ['%PDF-1.4\n'];
  const offs = [];

  function addObj(str) {
    offs.push(pieces.reduce((s, p) => s + p.length, 0));
    pieces.push(str + '\n');
  }

  addObj('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj');
  addObj('2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj');
  addObj('3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 5 0 R/Resources<</Font<</F1 4 0 R>>>>>>endobj');
  addObj('4 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj');

  // Object 5 — content stream (must track length precisely)
  const pre5 = pieces.reduce((s, p) => s + p.length, 0);
  offs.push(pre5);
  const s5hdr  = `5 0 obj<</Length ${streamBuf.length}>>\nstream\n`;
  const s5foot = '\nendstream\nendobj\n';
  const s5hdrBuf  = Buffer.from(s5hdr,  'latin1');
  const s5footBuf = Buffer.from(s5foot, 'latin1');

  const xrefStart = pre5 + s5hdrBuf.length + streamBuf.length + s5footBuf.length;

  function xe(o) { return String(o).padStart(10, '0') + ' 00000 n \n'; }
  const xref =
    'xref\n0 6\n' +
    '0000000000 65535 f \n' +
    xe(offs[0]) + xe(offs[1]) + xe(offs[2]) + xe(offs[3]) + xe(offs[4]) +
    `trailer\n<</Size 6/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF\n`;

  const preStream = Buffer.from(pieces.join(''), 'latin1');
  return Buffer.concat([preStream, s5hdrBuf, streamBuf, s5footBuf, Buffer.from(xref, 'latin1')]);
}
