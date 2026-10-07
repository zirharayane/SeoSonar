import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. Get and normalize target URL from CLI arguments
const rawArg = process.argv[2];
if (!rawArg) {
  console.error('Usage: npm run set-url -- <https://example.com>');
  process.exit(1);
}

let parsedUrl;
try {
  parsedUrl = new URL(rawArg);
} catch (err) {
  console.error(`Invalid URL "${rawArg}": ${err.message}`);
  process.exit(1);
}

if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
  console.error(`URL must begin with http:// or https://: ${rawArg}`);
  process.exit(1);
}

// Strip trailing slash for consistency
const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
const isWorkersDev = parsedUrl.hostname.endsWith('.workers.dev');

console.log(`Setting public site URL to: ${baseUrl}`);
console.log(`Domain is workers.dev: ${isWorkersDev}`);

// 2. Update public/index.html
const indexHtmlPath = path.join(rootDir, 'public', 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// Replace canonical, og, twitter URLs
indexHtml = indexHtml.replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${baseUrl}/">`);
indexHtml = indexHtml.replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${baseUrl}/">`);
indexHtml = indexHtml.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${baseUrl}/og-image.png">`);
indexHtml = indexHtml.replace(/<meta name="twitter:url" content="[^"]*">/, `<meta name="twitter:url" content="${baseUrl}/">`);
indexHtml = indexHtml.replace(/<meta name="twitter:image" content="[^"]*">/, `<meta name="twitter:image" content="${baseUrl}/og-image.png">`);

// Replace schema.org JSON-LD IDs and URLs
indexHtml = indexHtml.replace(/"@id":\s*"https?:\/\/[^"#]+#webapp"/, `"@id": "${baseUrl}/#webapp"`);
indexHtml = indexHtml.replace(/"@id":\s*"https?:\/\/[^"#]+#faq"/, `"@id": "${baseUrl}/#faq"`);
indexHtml = indexHtml.replace(/"url":\s*"https?:\/\/seosonar\.pages\.dev\/"/g, `"url": "${baseUrl}/"`);
indexHtml = indexHtml.replace(new RegExp(`"url":\\s*"https?:\\/\\/[^"\\/]+\\/"`, 'g'), `"url": "${baseUrl}/"`);

fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
console.log('✓ Updated public/index.html');

// 3. Update public/robots.txt
const robotsPath = path.join(rootDir, 'public', 'robots.txt');
let robots = fs.readFileSync(robotsPath, 'utf8');
robots = robots.replace(/Sitemap:\s*https?:\/\/[^\r\n]+/i, `Sitemap: ${baseUrl}/sitemap.xml`);
fs.writeFileSync(robotsPath, robots, 'utf8');
console.log('✓ Updated public/robots.txt');

// 4. Update public/sitemap.xml
const sitemapPath = path.join(rootDir, 'public', 'sitemap.xml');
let sitemap = fs.readFileSync(sitemapPath, 'utf8');
sitemap = sitemap.replace(/<loc>https?:\/\/[^<]+<\/loc>/, `<loc>${baseUrl}/</loc>`);
const today = new Date().toISOString().split('T')[0];
sitemap = sitemap.replace(/<lastmod>[^<]+<\/lastmod>/, `<lastmod>${today}</lastmod>`);
fs.writeFileSync(sitemapPath, sitemap, 'utf8');
console.log('✓ Updated public/sitemap.xml');

// 5. Update public/_headers for X-Robots-Tag on workers.dev
const headersPath = path.join(rootDir, 'public', '_headers');
let headers = fs.readFileSync(headersPath, 'utf8');
const hasGlobalNoindex = /^\/\*\r?\n\s*X-Robots-Tag:\s*noindex/m.test(headers);

if (isWorkersDev) {
  if (!hasGlobalNoindex) {
    // Add under /*
    headers = headers.replace(/(\/\*\r?\n)/, `$1  X-Robots-Tag: noindex\n`);
    fs.writeFileSync(headersPath, headers, 'utf8');
    console.log('✓ Added "X-Robots-Tag: noindex" to public/_headers (workers.dev domain)');
  }
} else {
  // If attached to custom domain, remove global noindex from /*
  if (hasGlobalNoindex) {
    headers = headers.replace(/^\/\*(\r?\n)\s*X-Robots-Tag:\s*noindex\r?\n/m, '/*$1');
    fs.writeFileSync(headersPath, headers, 'utf8');
    console.log('✓ Removed "X-Robots-Tag: noindex" from public/_headers (production custom domain)');
  }
}

// 6. Write site.config.json as single source of truth
const configPath = path.join(rootDir, 'site.config.json');
const config = {
  siteUrl: baseUrl,
  isWorkersDev,
  noindex: isWorkersDev,
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('✓ Saved configuration to site.config.json');
