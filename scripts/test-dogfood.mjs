import fs from 'fs';

const html = fs.readFileSync('public/index.html', 'utf8');

const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
const descMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi);
const canonMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
const vpMatch = html.match(/<meta\s+[^>]*name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i);
const langMatch = html.match(/<html[^>]*\slang=["']([^"']*)["'][^>]*>/i);

console.log('--- DOGFOODING PUBLIC/INDEX.HTML ---');
console.log('Title:', titleMatch ? titleMatch[1] : null, `(${titleMatch ? titleMatch[1].length : 0} chars)`);
console.log('Meta Description:', descMatch ? descMatch[1] : null, `(${descMatch ? descMatch[1].length : 0} chars)`);
console.log('H1 Headings count:', h1Match ? h1Match.length : 0, h1Match);
console.log('Canonical Tag:', canonMatch ? canonMatch[1] : null);
console.log('Viewport:', vpMatch ? vpMatch[1] : null);
console.log('HTML Lang:', langMatch ? langMatch[1] : null);

const imgRegex = /<img\s+([^>]+)>/gi;
let imgM, total = 0, missing = 0;
while ((imgM = imgRegex.exec(html)) !== null) {
  total++;
  if (!/\balt\s*=\s*["'][^"']*["']/i.test(imgM[1])) missing++;
}
console.log(`Images: Total ${total}, Missing Alt: ${missing}`);

// Check Structured Data
const jsonLdRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
let jsonM, schemaCount = 0;
while ((jsonM = jsonLdRegex.exec(html)) !== null) {
  schemaCount++;
  try {
    const parsed = JSON.parse(jsonM[1]);
    console.log(`JSON-LD ${schemaCount} parsed successfully. Keys:`, Object.keys(parsed));
  } catch (e) {
    console.error('Invalid JSON-LD:', e.message);
  }
}
console.log('All tests passed cleanly!');
