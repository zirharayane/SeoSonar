import zlib from 'zlib';
import fs from 'fs';

const files = [
  'public/index.html',
  'public/css/win98.css',
  'public/js/app.js',
  'public/js/results.js',
  'public/assets/icon-32.webp',
  'public/assets/icon-64.webp',
  'public/assets/icon-256.webp'
];

console.log('=== PAGE ASSET WEIGHT AUDIT ===');
let totalRaw = 0;
let totalGzip = 0;
let totalBrotli = 0;

for (const f of files) {
  const buf = fs.readFileSync(f);
  const raw = buf.length;
  const gz = zlib.gzipSync(buf).length;
  const br = zlib.brotliCompressSync(buf).length;
  totalRaw += raw;
  totalGzip += gz;
  totalBrotli += br;
  console.log(`${f.padEnd(28)} | Raw: ${(raw/1024).toFixed(1)} KB | Gzip: ${(gz/1024).toFixed(1)} KB | Brotli: ${(br/1024).toFixed(1)} KB`);
}

console.log('-----------------------------------------------------------------------------------');
console.log(`TOTAL (ALL ASSETS + ENGINE): Raw: ${(totalRaw/1024).toFixed(1)} KB | Gzip: ${(totalGzip/1024).toFixed(1)} KB | Brotli: ${(totalBrotli/1024).toFixed(1)} KB`);

const critical = ['public/index.html', 'public/css/win98.css', 'public/js/app.js', 'public/assets/icon-32.webp'];
let critRaw = 0, critGz = 0, critBr = 0;
for (const f of critical) {
  const buf = fs.readFileSync(f);
  critRaw += buf.length;
  critGz += zlib.gzipSync(buf).length;
  critBr += zlib.brotliCompressSync(buf).length;
}
console.log(`INITIAL CRITICAL LOAD:      Raw: ${(critRaw/1024).toFixed(1)} KB | Gzip: ${(critGz/1024).toFixed(1)} KB | Brotli: ${(critBr/1024).toFixed(1)} KB`);
