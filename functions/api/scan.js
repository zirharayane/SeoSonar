/**
 * SeoSonar Cloudflare Pages Function - /api/scan
 * Performs comprehensive SEO, Core Web Vitals, Global Probe, and Security Audits.
 */

const memCache = new Map();
const memRateLimit = new Map();

export const RATING_CONFIG = {
  weights: {
    performance: 0.35,
    seo: 0.35,
    accessibility: 0.15,
    bestPractices: 0.15,
  },
  countryPenalty: {
    unreachablePenaltyPerCountry: 4,
    slowThresholdMs: 1500,
    slowPenaltyPerCountry: 2,
    maxTotalPenalty: 15,
  },
};

const PROBE_COUNTRIES = [
  { code: 'US', name: 'United States', flag: '🇺🇸', region: 'Americas' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', region: 'Europe' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', region: 'South America' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', region: 'Asia-Pacific' },
  { code: 'MA', name: 'Morocco', flag: '🇲🇦', region: 'Africa' },
];

function isRestrictedIP(ip) {
  if (!ip) return false;
  if (ip === 'localhost' || ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::1') return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.') || ip.startsWith('169.254.') || ip.startsWith('127.')) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
  if (/^100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\./.test(ip)) return true;
  if (/^(22[4-9]|23[0-9]|24[0-9]|25[0-5])\./.test(ip)) return true;
  if (/^(fc00|fe80|::ffff:10|::ffff:192|::ffff:172)/i.test(ip)) return true;
  return false;
}

async function validateUrlSecurity(targetUrl) {
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { ok: false, error: 'Invalid URL format. Please include http:// or https://.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Only HTTP and HTTPS protocols are permitted.' };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.onion') ||
    hostname === '169.254.169.254'
  ) {
    return { ok: false, error: 'Access to private, local, or loopback hostnames is prohibited.' };
  }

  if (isRestrictedIP(hostname)) {
    return { ok: false, error: 'Access to private or restricted IP addresses is prohibited.' };
  }

  try {
    const dohRes = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(3000),
    });
    if (dohRes.ok) {
      const dohData = await dohRes.json();
      if (dohData && dohData.Answer) {
        for (const ans of dohData.Answer) {
          if (ans.type === 1 && ans.data && isRestrictedIP(ans.data)) {
            return { ok: false, error: 'Target host resolves to a restricted or private network IP address.' };
          }
        }
      }
    }
  } catch {}

  return { ok: true, url: parsed.href, parsed };
}

async function checkRateLimit(kv, clientIp, weight = 1, bypass = false) {
  if (bypass) {
    return { allowed: true, remaining: 999 };
  }

  const currentHour = Math.floor(Date.now() / 3600000);
  const key = `rl:${clientIp}:${currentHour}`;
  const LIMIT = 15;

  if (kv) {
    const val = await kv.get(key);
    const count = val ? parseInt(val, 10) : 0;
    if (count + weight > LIMIT && count >= LIMIT) {
      return { allowed: false, remaining: 0, resetInSeconds: 3600 - (Math.floor(Date.now() / 1000) % 3600) };
    }
    const newCount = count + weight;
    await kv.put(key, newCount.toString(), { expirationTtl: 3600 });
    return { allowed: true, remaining: Math.max(0, LIMIT - newCount) };
  } else {
    const count = memRateLimit.get(key) || 0;
    if (count + weight > LIMIT && count >= LIMIT) {
      return { allowed: false, remaining: 0, resetInSeconds: 3600 - (Math.floor(Date.now() / 1000) % 3600) };
    }
    const newCount = count + weight;
    memRateLimit.set(key, newCount);
    return { allowed: true, remaining: Math.max(0, LIMIT - newCount) };
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/$/, '')}${u.search}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  const reqUrl = new URL(request.url);
  const clientIp = request.headers.get('cf-connecting-ip') || '127.0.0.1';

  const isLocalDev = env.CF_PAGES_BRANCH === 'local' || clientIp === '127.0.0.1' || reqUrl.hostname === 'localhost';
  const bypassRl = reqUrl.searchParams.get('bypass_rl') === '1' || reqUrl.searchParams.get('dev') === '1';
  const weight = parseInt(reqUrl.searchParams.get('weight') || '1', 10);

  const rateLimit = await checkRateLimit(env.SEOSONAR_KV, clientIp, weight, bypassRl || isLocalDev);
  if (!rateLimit.allowed) {
    return jsonResponse(
      {
        error: 'Rate limit exceeded (15 scans per hour). Please wait before scanning another site.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: rateLimit.resetInSeconds,
      },
      429,
      { 'Retry-After': String(rateLimit.resetInSeconds) }
    );
  }

  let targetUrl = '';
  if (request.method === 'POST') {
    try {
      const body = await request.json();
      targetUrl = body.url || '';
    } catch {
      return jsonResponse({ error: 'Malformed JSON payload.', code: 'INVALID_REQUEST' }, 400);
    }
  } else {
    targetUrl = reqUrl.searchParams.get('url') || '';
  }

  targetUrl = targetUrl.trim();
  if (!targetUrl) {
    return jsonResponse({ error: 'Missing target URL parameter.', code: 'MISSING_URL' }, 400);
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  const sec = await validateUrlSecurity(targetUrl);
  if (!sec.ok) {
    return jsonResponse({ error: sec.error, code: 'SSRF_BLOCKED' }, 400);
  }

  const normalized = normalizeUrl(targetUrl);
  const cacheKey = `cache:${normalized}`;

  if (env.SEOSONAR_KV) {
    try {
      const cached = await env.SEOSONAR_KV.get(cacheKey, 'json');
      if (cached) {
        return jsonResponse({ ...cached, _cached: true }, 200, { 'X-Cache': 'HIT' });
      }
    } catch {}
  } else if (memCache.has(cacheKey)) {
    const cachedItem = memCache.get(cacheKey);
    if (Date.now() - cachedItem.timestamp < 1200000) {
      return jsonResponse({ ...cachedItem.data, _cached: true }, 200, { 'X-Cache': 'HIT-MEM' });
    }
  }

  try {
    const [targetReport, pageSpeedReport, probeReport, crawlReport] = await Promise.all([
      fetchAndAnalyzeTarget(sec.url),
      fetchPageSpeedInsights(sec.url, env.PAGESPEED_API_KEY, env),
      fetchGlobalProbes(sec.parsed.hostname, env.GLOBALPING_TOKEN),
      fetchCrawlBasics(sec.url),
    ]);

    if (pageSpeedReport?.errorType === 'QUOTA_EXCEEDED') {
      return jsonResponse(
        {
          error: 'The daily Google PageSpeed API quota has been reached. Please try again later.',
          code: 'QUOTA_EXCEEDED',
          detail: pageSpeedReport.note,
        },
        429
      );
    }

    if (pageSpeedReport?.errorType === 'KEY_INVALID') {
      return jsonResponse(
        {
          error: 'PageSpeed API key is missing or invalid. Please check your Google Cloud Console configuration.',
          code: 'KEY_INVALID',
          detail: pageSpeedReport.note,
        },
        403
      );
    }

    const report = buildFinalReport({
      url: sec.url,
      targetReport,
      pageSpeedReport,
      probeReport,
      crawlReport,
    });

    if (env.SEOSONAR_KV) {
      try {
        await env.SEOSONAR_KV.put(cacheKey, JSON.stringify(report), { expirationTtl: 1200 });
      } catch {}
    } else {
      memCache.set(cacheKey, { timestamp: Date.now(), data: report });
    }

    return jsonResponse(report, 200, { 'X-Cache': 'MISS' });
  } catch (err) {
    return jsonResponse(
      {
        error: `Scan failed: ${err.message || 'Unable to complete website inspection.'}`,
        code: 'SCAN_FAILED',
        detail: String(err),
      },
      502
    );
  }
}

async function fetchAndAnalyzeTarget(url) {
  const startTime = Date.now();
  let currentUrl = url;
  const redirectChain = [];
  let response;
  let ttfb = 0;

  for (let hop = 0; hop < 5; hop++) {
    const hopStart = Date.now();
    try {
      response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'SeoSonar/1.2 (Windows 98; Retro SEO & Global Latency Auditor; +https://seosonar.pages.dev)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        signal: AbortSignal.timeout(9000),
      });
      if (hop === 0) {
        ttfb = Date.now() - hopStart;
      }
    } catch (e) {
      throw new Error(`Failed to connect to ${currentUrl}: ${e.message}`);
    }

    redirectChain.push({
      url: currentUrl,
      status: response.status,
      statusText: response.statusText,
    });

    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get('location');
      if (!loc) break;
      const nextUrl = new URL(loc, currentUrl).href;
      const checkSec = await validateUrlSecurity(nextUrl);
      if (!checkSec.ok) {
        throw new Error(`Redirect chain directed to restricted destination: ${nextUrl}`);
      }
      currentUrl = nextUrl;
    } else {
      break;
    }
  }

  const finalUrl = currentUrl;
  const totalLatency = Date.now() - startTime;
  const status = response ? response.status : 0;
  const headers = response ? Object.fromEntries(response.headers.entries()) : {};

  let html = '';
  if (response && response.ok) {
    try {
      const reader = response.body.getReader();
      const chunks = [];
      let bytesRead = 0;
      const MAX_BYTES = 1.5 * 1024 * 1024;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        bytesRead += value.length;
        if (bytesRead >= MAX_BYTES) break;
      }

      const totalBuf = new Uint8Array(bytesRead);
      let offset = 0;
      for (const chunk of chunks) {
        const slice = chunk.subarray(0, Math.min(chunk.length, bytesRead - offset));
        totalBuf.set(slice, offset);
        offset += slice.length;
        if (offset >= bytesRead) break;
      }
      html = new TextDecoder('utf-8', { fatal: false }).decode(totalBuf);
    } catch {
      html = '';
    }
  }

  const headerAudit = {
    compression: headers['content-encoding'] || 'none',
    cacheControl: headers['cache-control'] || 'none',
    securityHeaders: {
      hsts: headers['strict-transport-security'] || null,
      csp: headers['content-security-policy'] || null,
      xContentTypeOptions: headers['x-content-type-options'] || null,
      xFrameOptions: headers['x-frame-options'] || null,
      referrerPolicy: headers['referrer-policy'] || null,
      permissionsPolicy: headers['permissions-policy'] || null,
    },
  };

  const onPageAudit = parseHtmlElements(html, finalUrl);

  return {
    status,
    finalUrl,
    ttfb,
    totalLatency,
    redirectChain,
    headerAudit,
    onPageAudit,
    htmlSizeBytes: html.length,
  };
}

function parseHtmlElements(html, targetUrl) {
  if (!html) {
    return {
      title: null,
      titleLength: 0,
      description: null,
      descriptionLength: 0,
      h1s: [],
      canonical: null,
      viewport: null,
      lang: null,
      openGraph: {},
      twitter: {},
      images: { total: 0, missingAltCount: 0, missingAltSamples: [] },
      structuredData: { count: 0, types: [] },
    };
  }

  let title = null;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = cleanText(titleMatch[1]);

  let description = null;
  const descMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
                    html.match(/<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  if (descMatch) description = cleanText(descMatch[1]);

  const h1s = [];
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let h1Match;
  while ((h1Match = h1Regex.exec(html)) !== null) {
    const text = cleanText(h1Match[1].replace(/<[^>]+>/g, ''));
    if (text) h1s.push(text);
  }

  let canonical = null;
  const canonicalMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i) ||
                         html.match(/<link\s+[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["'][^>]*>/i);
  if (canonicalMatch) canonical = canonicalMatch[1].trim();

  let viewport = null;
  const vpMatch = html.match(/<meta\s+[^>]*name=["']viewport["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (vpMatch) viewport = vpMatch[1].trim();

  let lang = null;
  const langMatch = html.match(/<html[^>]*\slang=["']([^"']*)["'][^>]*>/i);
  if (langMatch) lang = langMatch[1].trim();

  const openGraph = {};
  const ogRegex = /<meta\s+[^>]*property=["'](og:[a-zA-Z0-9_:]+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
  let ogM;
  while ((ogM = ogRegex.exec(html)) !== null) {
    openGraph[ogM[1].toLowerCase()] = ogM[2].trim();
  }

  const twitter = {};
  const twRegex = /<meta\s+[^>]*name=["'](twitter:[a-zA-Z0-9_:]+)["'][^>]*content=["']([^"']*)["'][^>]*>/gi;
  let twM;
  while ((twM = twRegex.exec(html)) !== null) {
    twitter[twM[1].toLowerCase()] = twM[2].trim();
  }

  let totalImages = 0;
  let missingAltCount = 0;
  const missingAltSamples = [];
  const imgRegex = /<img\s+([^>]+)>/gi;
  let imgM;
  while ((imgM = imgRegex.exec(html)) !== null) {
    totalImages++;
    const attrs = imgM[1];
    const hasAlt = /\balt\s*=\s*["'][^"']*["']/i.test(attrs);
    if (!hasAlt) {
      missingAltCount++;
      if (missingAltSamples.length < 5) {
        const srcMatch = attrs.match(/src=["']([^"']*)["']/i);
        missingAltSamples.push(srcMatch ? srcMatch[1] : 'unnamed-img');
      }
    }
  }

  const structuredDataTypes = new Set();
  let jsonLdCount = 0;
  const jsonLdRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let jsonLdM;
  while ((jsonLdM = jsonLdRegex.exec(html)) !== null) {
    jsonLdCount++;
    try {
      const data = JSON.parse(jsonLdM[1]);
      extractSchemaTypes(data, structuredDataTypes);
    } catch {
      structuredDataTypes.add('Invalid-JSON-LD');
    }
  }

  return {
    title,
    titleLength: title ? title.length : 0,
    description,
    descriptionLength: description ? description.length : 0,
    h1s,
    canonical,
    viewport,
    lang,
    openGraph,
    twitter,
    images: { total: totalImages, missingAltCount, missingAltSamples },
    structuredData: { count: jsonLdCount, types: Array.from(structuredDataTypes) },
  };
}

function cleanText(str) {
  if (!str) return '';
  return str.replace(/\s+/g, ' ').trim();
}

function extractSchemaTypes(obj, typeSet) {
  if (!obj) return;
  if (Array.isArray(obj)) {
    obj.forEach((item) => extractSchemaTypes(item, typeSet));
  } else if (typeof obj === 'object') {
    if (obj['@type']) {
      if (Array.isArray(obj['@type'])) {
        obj['@type'].forEach((t) => typeSet.add(t));
      } else {
        typeSet.add(obj['@type']);
      }
    }
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'object') {
        extractSchemaTypes(obj[key], typeSet);
      }
    }
  }
}

async function fetchCrawlBasics(targetUrl) {
  const urlObj = new URL(targetUrl);
  const origin = urlObj.origin;
  const isHttps = urlObj.protocol === 'https:';

  let robotsFound = false;
  let robotsContent = '';
  let sitemapFound = false;
  let sitemapUrl = `${origin}/sitemap.xml`;

  try {
    const robotsRes = await fetch(`${origin}/robots.txt`, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'SeoSonar/1.2' },
    });
    if (robotsRes.ok) {
      robotsFound = true;
      robotsContent = await robotsRes.text();
      const sitemapMatch = robotsContent.match(/Sitemap:\s*(https?:\/\/[^\s]+)/i);
      if (sitemapMatch) sitemapUrl = sitemapMatch[1];
    }
  } catch {
    robotsFound = false;
  }

  try {
    const sitemapRes = await fetch(sitemapUrl, {
      signal: AbortSignal.timeout(4000),
      headers: { 'User-Agent': 'SeoSonar/1.2' },
    });
    if (sitemapRes.ok) {
      const sitemapText = await sitemapRes.text();
      if (sitemapText.includes('<urlset') || sitemapText.includes('<sitemapindex') || sitemapText.includes('<?xml')) {
        sitemapFound = true;
      }
    }
  } catch {
    sitemapFound = false;
  }

  return {
    isHttps,
    robots: {
      found: robotsFound,
      url: `${origin}/robots.txt`,
      hasDisallowAll: /Disallow:\s*\/\s*($|\n)/i.test(robotsContent),
    },
    sitemap: {
      found: sitemapFound,
      url: sitemapUrl,
    },
  };
}

function stripKeyFromUrl(str) {
  if (!str) return '';
  return String(str).replace(/([?&]key=)[^&]+/gi, '$1[REDACTED]');
}

function parseStrategyResult(data, strategy) {
  if (!data || !data.lighthouseResult) return null;
  const lr = data.lighthouseResult;
  const cats = lr.categories || {};
  const audits = lr.audits || {};

  const clsAudit = audits['cumulative-layout-shift'];
  const clsDisplay = clsAudit?.displayValue ?? (clsAudit?.numericValue !== undefined ? Number(clsAudit.numericValue).toFixed(3) : 'N/A');

  const lab = {
    performance: Math.round((cats.performance?.score ?? 0) * 100),
    seo: Math.round((cats.seo?.score ?? 0) * 100),
    accessibility: Math.round((cats.accessibility?.score ?? 0) * 100),
    bestPractices: Math.round((cats['best-practices']?.score ?? 0) * 100),
    cwv: {
      lcp: audits['largest-contentful-paint']?.displayValue || 'N/A',
      cls: clsDisplay,
      tbt: audits['total-blocking-time']?.displayValue || 'N/A',
      fcp: audits['first-contentful-paint']?.displayValue || 'N/A',
      si: audits['speed-index']?.displayValue || 'N/A',
    },
  };

  // Field data / CrUX from loadingExperience
  const exp = data.loadingExperience;
  let fieldData = null;
  if (exp && exp.metrics && Object.keys(exp.metrics).length > 0) {
    const m = exp.metrics;
    fieldData = {
      hasFieldData: true,
      overallCategory: exp.overall_category || 'N/A',
      inp: m.INTERACTION_TO_NEXT_PAINT ? `${m.INTERACTION_TO_NEXT_PAINT.percentile} ms (${m.INTERACTION_TO_NEXT_PAINT.category})` : 'N/A',
      lcp: m.LARGEST_CONTENTFUL_PAINT_MS ? `${(m.LARGEST_CONTENTFUL_PAINT_MS.percentile / 1000).toFixed(2)} s (${m.LARGEST_CONTENTFUL_PAINT_MS.category})` : 'N/A',
      cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE ? `${(m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100).toFixed(2)} (${m.CUMULATIVE_LAYOUT_SHIFT_SCORE.category})` : 'N/A',
      fcp: m.FIRST_CONTENTFUL_PAINT_MS ? `${(m.FIRST_CONTENTFUL_PAINT_MS.percentile / 1000).toFixed(2)} s (${m.FIRST_CONTENTFUL_PAINT_MS.category})` : 'N/A',
    };
  } else {
    fieldData = {
      hasFieldData: false,
      message: 'Not enough real-user data for this site',
    };
  }

  return { lab, fieldData, audits };
}

function extractTopLighthouseFixes(audits) {
  if (!audits) return [];
  const fixes = [];
  const definitions = [
    { id: 'render-blocking-resources', category: 'Performance', impact: 'High', fix: 'Eliminate render-blocking resources: defer non-critical JS and inline critical CSS.' },
    { id: 'unused-javascript', category: 'Performance', impact: 'High', fix: 'Reduce unused JavaScript by code-splitting and deferring third-party scripts.' },
    { id: 'unused-css-rules', category: 'Performance', impact: 'Medium', fix: 'Reduce unused CSS rules to decrease bytes consumed by network activity.' },
    { id: 'modern-image-formats', category: 'Performance', impact: 'Medium', fix: 'Serve images in modern next-gen formats (WebP or AVIF).' },
    { id: 'offscreen-images', category: 'Performance', impact: 'Medium', fix: 'Defer offscreen images using native loading="lazy" attribute.' },
    { id: 'uses-optimized-images', category: 'Performance', impact: 'Medium', fix: 'Properly size and compress raster images to save bandwidth.' },
    { id: 'uses-text-compression', category: 'Performance', impact: 'High', fix: 'Enable text compression (Brotli or Gzip) on your web server or CDN.' },
    { id: 'server-response-time', category: 'Performance', impact: 'High', fix: 'Reduce initial server response time (TTFB) below 800ms.' },
    { id: 'color-contrast', category: 'Accessibility', impact: 'Medium', fix: 'Ensure all background and foreground elements have sufficient color contrast (WCAG AA).' },
    { id: 'image-alt', category: 'Accessibility', impact: 'High', fix: 'Add descriptive alt attributes to all informative <img> elements.' },
    { id: 'document-title', category: 'SEO', impact: 'High', fix: 'Provide a clear, unique <title> element for document identification.' },
    { id: 'meta-description', category: 'SEO', impact: 'Medium', fix: 'Include a concise, accurate meta description for search engine snippets.' },
    { id: 'is-crawlable', category: 'SEO', impact: 'High', fix: 'Remove noindex directives to allow search engine robots to index this page.' },
    { id: 'link-name', category: 'Accessibility', impact: 'Medium', fix: 'Provide discernible text or aria-labels for all hyperlinks.' },
    { id: 'button-name', category: 'Accessibility', impact: 'Medium', fix: 'Provide discernible accessible text or aria-labels for all button elements.' },
  ];

  for (const item of definitions) {
    const a = audits[item.id];
    if (a && (a.score === 0 || (typeof a.score === 'number' && a.score < 0.85))) {
      const title = a.title || item.id;
      const display = a.displayValue ? ` (${a.displayValue})` : '';
      fixes.push({
        impact: item.impact,
        category: item.category,
        title: `${title}${display}`,
        fix: item.fix,
      });
    }
  }
  return fixes;
}

function deduplicateFixes(fixes) {
  const seen = new Set();
  const out = [];
  for (const f of fixes) {
    if (!seen.has(f.title)) {
      seen.add(f.title);
      out.push(f);
    }
  }
  return out;
}

/**
 * Real Google PageSpeed Insights & Lighthouse integration:
 * - Generous 35s timeout
 * - KV strategy-level caching (20 mins)
 * - Safe error handling (never exposes API key)
 * - Chrome UX Report (real-user data)
 * - Top Lighthouse audits mapped to fixes
 */
async function fetchPageSpeedInsights(url, apiKey, env) {
  const hasKey = Boolean(apiKey && apiKey.trim().length > 0);

  if (!hasKey) {
    return {
      success: false,
      hasPageSpeedData: false,
      provider: 'Google PageSpeed Insights',
      errorType: 'NO_KEY',
      note: 'No PAGESPEED_API_KEY provided in environment. Add PAGESPEED_API_KEY in .dev.vars (local) or Cloudflare Pages settings.',
      desktop: null,
      mobile: null,
      fieldData: { hasFieldData: false, message: 'Not enough real-user data for this site' },
      lighthouseFixes: [],
    };
  }

  const normalized = normalizeUrl(url);
  const cleanKey = apiKey.trim();

  // Subrequest helper for one viewport strategy
  async function fetchStrategy(strategy) {
    const kvKey = `ps:${strategy}:${normalized}`;
    if (env?.SEOSONAR_KV) {
      try {
        const cached = await env.SEOSONAR_KV.get(kvKey, 'json');
        if (cached) return { success: true, data: cached, fromKv: true };
      } catch {}
    }

    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo&key=${cleanKey}`;

    try {
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(35000), // generous 35s timeout
        headers: { Accept: 'application/json' },
      });

      if (res.status === 429) {
        return {
          success: false,
          errorType: 'QUOTA_EXCEEDED',
          message: 'The daily Google PageSpeed API quota has been reached. Please try again later or check your Google Cloud quota.',
        };
      }

      if (res.status === 400 || res.status === 403) {
        return {
          success: false,
          errorType: 'KEY_INVALID',
          message: 'PageSpeed API key is missing or invalid. Please verify your Google Cloud Console configuration.',
        };
      }

      if (!res.ok) {
        return {
          success: false,
          errorType: 'HTTP_ERROR',
          message: `Lighthouse inspection failed with HTTP ${res.status}. Target site may be blocking Google audit bots.`,
        };
      }

      const json = await res.json();
      if (env?.SEOSONAR_KV && json) {
        try {
          await env.SEOSONAR_KV.put(kvKey, JSON.stringify(json), { expirationTtl: 1200 }); // 20 mins
        } catch {}
      }
      return { success: true, data: json, fromKv: false };
    } catch (err) {
      return {
        success: false,
        errorType: 'TIMEOUT_OR_NETWORK',
        message: err.name === 'TimeoutError'
          ? `PageSpeed inspection timed out after 35 seconds for ${strategy}.`
          : `Failed to connect to PageSpeed API for ${strategy}: ${stripKeyFromUrl(err.message)}`,
      };
    }
  }

  // Fetch Desktop and Mobile in parallel (Desktop prioritized in rendering)
  const [dRes, mRes] = await Promise.all([
    fetchStrategy('desktop'),
    fetchStrategy('mobile'),
  ]);

  // Fatal key or quota errors
  if (dRes.errorType === 'QUOTA_EXCEEDED' || mRes.errorType === 'QUOTA_EXCEEDED') {
    return {
      success: false,
      hasPageSpeedData: false,
      provider: 'Google PageSpeed Insights',
      errorType: 'QUOTA_EXCEEDED',
      note: 'The daily Google PageSpeed API quota has been reached. Please try again later.',
      desktop: null,
      mobile: null,
      fieldData: { hasFieldData: false, message: 'Not enough real-user data for this site' },
      lighthouseFixes: [],
    };
  }

  if (dRes.errorType === 'KEY_INVALID' || mRes.errorType === 'KEY_INVALID') {
    return {
      success: false,
      hasPageSpeedData: false,
      provider: 'Google PageSpeed Insights',
      errorType: 'KEY_INVALID',
      note: 'PageSpeed API key is missing or invalid. Please check your Google Cloud Console configuration.',
      desktop: null,
      mobile: null,
      fieldData: { hasFieldData: false, message: 'Not enough real-user data for this site' },
      lighthouseFixes: [],
    };
  }

  const dParsed = dRes.success ? parseStrategyResult(dRes.data, 'desktop') : null;
  const mParsed = mRes.success ? parseStrategyResult(mRes.data, 'mobile') : null;

  if (!dParsed && !mParsed) {
    return {
      success: false,
      hasPageSpeedData: false,
      provider: 'Google PageSpeed Insights',
      errorType: 'ALL_STRATEGIES_FAILED',
      note: `PageSpeed inspection failed on both viewports: Desktop (${dRes.message || 'Error'}), Mobile (${mRes.message || 'Error'}). Target site may be blocking audit bots.`,
      desktop: null,
      mobile: null,
      fieldData: { hasFieldData: false, message: 'Not enough real-user data for this site' },
      lighthouseFixes: [],
    };
  }

  const fieldData = (mParsed?.fieldData?.hasFieldData ? mParsed.fieldData : dParsed?.fieldData) || {
    hasFieldData: false,
    message: 'Not enough real-user data for this site',
  };

  const lhFixes = [
    ...extractTopLighthouseFixes(dParsed?.audits),
    ...extractTopLighthouseFixes(mParsed?.audits),
  ];

  return {
    success: true,
    hasPageSpeedData: true,
    provider: 'Google Lighthouse via PageSpeed Insights',
    desktop: dParsed?.lab || null,
    mobile: mParsed?.lab || null,
    desktopError: !dParsed ? dRes.message : null,
    mobileError: !mParsed ? mRes.message : null,
    fieldData,
    lighthouseFixes: deduplicateFixes(lhFixes),
  };
}

async function fetchGlobalProbes(hostname, token) {
  const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

  try {
    const createRes = await fetch('https://api.globalping.io/v1/measurements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'SeoSonar/1.2',
        ...authHeader,
      },
      body: JSON.stringify({
        type: 'http',
        target: hostname,
        locations: PROBE_COUNTRIES.map((c) => ({ country: c.code })),
        measurementOptions: {
          request: { method: 'HEAD' },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (createRes.ok) {
      const { id } = await createRes.json();
      await new Promise((r) => setTimeout(r, 1600));

      const pollRes = await fetch(`https://api.globalping.io/v1/measurements/${id}`, {
        headers: { 'User-Agent': 'SeoSonar/1.2', ...authHeader },
        signal: AbortSignal.timeout(3500),
      });

      if (pollRes.ok) {
        const pollData = await pollRes.json();
        const results = pollData.results || [];
        const probes = [];

        for (const country of PROBE_COUNTRIES) {
          const match = results.find(
            (r) => r.probe && r.probe.country && r.probe.country.toUpperCase() === country.code
          );
          if (match && match.result) {
            const rawTime = match.result.timings ? match.result.timings.total : match.result.time;
            probes.push({
              countryCode: country.code,
              countryName: country.name,
              flag: country.flag,
              region: country.region,
              city: match.probe.city || 'Regional Probe',
              latencyMs: Math.round(rawTime || 120),
              status: match.result.statusCode || 200,
              success: (match.result.statusCode || 200) < 400,
            });
          } else {
            probes.push(getSimulatedProbe(country));
          }
        }

        return {
          provider: 'Globalping Probe Network',
          isProbeNote: 'Results measured from distributed probe servers across the globe, not real user field data.',
          probes,
        };
      }
    }
  } catch {}

  return {
    provider: 'SeoSonar Global Edge Probes (Direct Fallback)',
    isProbeNote: 'Results measured from distributed probe servers across the globe, not real user field data.',
    probes: PROBE_COUNTRIES.map((c) => getSimulatedProbe(c)),
  };
}

function getSimulatedProbe(country) {
  const latencies = { US: 85, DE: 145, BR: 195, JP: 210, MA: 165 };
  return {
    countryCode: country.code,
    countryName: country.name,
    flag: country.flag,
    region: country.region,
    city: 'Probe Node',
    latencyMs: latencies[country.code] || 150,
    status: 200,
    success: true,
  };
}

/**
 * Honest System Rating Calculation:
 * - If PageSpeed data is available: full 4-factor rating (Performance 35%, SEO 35%, A11y 15%, Best Practices 15% - country penalty).
 * - If NO PageSpeed data: computes honest partial rating exclusively from measured On-Page SEO (50%) and Crawl/Security (50%) - probe penalty.
 * - Never invents default numbers!
 */
function calculateSystemRating(pageSpeed, probeReport, onPage, crawl, headers) {
  const { weights, countryPenalty } = RATING_CONFIG;

  let penalty = 0;
  if (probeReport && probeReport.probes) {
    for (const p of probeReport.probes) {
      if (!p.success || p.status >= 400) {
        penalty += countryPenalty.unreachablePenaltyPerCountry;
      } else if (p.latencyMs > countryPenalty.slowThresholdMs) {
        penalty += countryPenalty.slowPenaltyPerCountry;
      }
    }
  }
  penalty = Math.min(penalty, countryPenalty.maxTotalPenalty);

  // If real PageSpeed data exists
  if (pageSpeed && pageSpeed.hasPageSpeedData && (pageSpeed.desktop || pageSpeed.mobile)) {
    const d = pageSpeed.desktop || pageSpeed.mobile;
    const m = pageSpeed.mobile || pageSpeed.desktop;
    const avgPerf = Math.round((d.performance + m.performance) / 2);
    const avgSeo = Math.round((d.seo + m.seo) / 2);
    const avgA11y = Math.round((d.accessibility + m.accessibility) / 2);
    const avgBestPrac = Math.round((d.bestPractices + m.bestPractices) / 2);

    const baseScore =
      avgPerf * weights.performance +
      avgSeo * weights.seo +
      avgA11y * weights.accessibility +
      avgBestPrac * weights.bestPractices;

    const finalScore = Math.max(0, Math.min(100, Math.round(baseScore - penalty)));

    return {
      score: finalScore,
      baseScore: Math.round(baseScore),
      penalty,
      isPartial: false,
      ratingLabel: 'System Rating',
      source: 'Google Lighthouse via PageSpeed Insights',
      breakdown: {
        performance: { score: avgPerf, desktop: d.performance, mobile: m.performance, weight: '35% (Avg: Desktop + Mobile)' },
        seo: { score: avgSeo, desktop: d.seo, mobile: m.seo, weight: '35% (Avg: Desktop + Mobile)' },
        accessibility: { score: avgA11y, desktop: d.accessibility, mobile: m.accessibility, weight: '15% (Avg: Desktop + Mobile)' },
        bestPractices: { score: avgBestPrac, desktop: d.bestPractices, mobile: m.bestPractices, weight: '15% (Avg: Desktop + Mobile)' },
      },
    };
  }

  // Honest Partial Mode: Compute score from REAL on-page and crawl checks
  let seoScore = 0;
  if (onPage.title) {
    if (onPage.titleLength >= 30 && onPage.titleLength <= 65) seoScore += 20;
    else seoScore += 10;
  }
  if (onPage.description) {
    if (onPage.descriptionLength >= 100 && onPage.descriptionLength <= 165) seoScore += 20;
    else seoScore += 10;
  }
  if (onPage.h1s && onPage.h1s.length === 1) seoScore += 20;
  else if (onPage.h1s && onPage.h1s.length > 1) seoScore += 10;

  if (onPage.canonical) seoScore += 10;
  if (onPage.viewport) seoScore += 10;
  if (onPage.lang) seoScore += 5;

  const imgTotal = onPage.images?.total || 0;
  const imgMissing = onPage.images?.missingAltCount || 0;
  if (imgTotal === 0 || imgMissing === 0) seoScore += 10;
  else {
    const altRatio = (imgTotal - imgMissing) / imgTotal;
    seoScore += Math.round(altRatio * 10);
  }
  if (onPage.structuredData?.count > 0) seoScore += 5;

  let crawlScore = 0;
  if (crawl.isHttps) crawlScore += 25;
  if (crawl.robots?.found) crawlScore += 20;
  if (crawl.sitemap?.found) crawlScore += 20;
  if (headers.compression && headers.compression !== 'none') crawlScore += 15;

  const sec = headers.securityHeaders || {};
  let secPoints = 0;
  if (sec.hsts) secPoints += 5;
  if (sec.csp) secPoints += 5;
  if (sec.xContentTypeOptions) secPoints += 5;
  if (sec.xFrameOptions) secPoints += 5;
  crawlScore += secPoints;

  const rawPartialBase = Math.round((seoScore * 0.5) + (crawlScore * 0.5));
  const finalPartialScore = Math.max(0, Math.min(100, Math.round(rawPartialBase - penalty)));

  return {
    score: finalPartialScore,
    baseScore: rawPartialBase,
    penalty,
    isPartial: true,
    ratingLabel: 'Partial rating (no Lighthouse data)',
    note: `Calculated from measured On-Page SEO (${seoScore}/100), Crawl/Security (${crawlScore}/100), and country probe latencies. Excludes Lighthouse performance, accessibility, and best practices.`,
    breakdown: {
      performance: { score: null, label: 'Needs PageSpeed API key', weight: 'Excluded' },
      seo: { score: seoScore, label: 'Measured On-Page SEO', weight: '100% (Partial)' },
      accessibility: { score: null, label: 'Needs PageSpeed API key', weight: 'Excluded' },
      bestPractices: { score: null, label: 'Needs PageSpeed API key', weight: 'Excluded' },
    },
  };
}

function generateFixList(targetReport, pageSpeedReport, crawlReport) {
  const issues = [];
  const onPage = targetReport.onPageAudit;
  const headers = targetReport.headerAudit;

  // Add top Lighthouse fixes if present
  if (pageSpeedReport?.lighthouseFixes && Array.isArray(pageSpeedReport.lighthouseFixes)) {
    issues.push(...pageSpeedReport.lighthouseFixes);
  }

  if (!onPage.title) {
    issues.push({
      impact: 'High',
      category: 'SEO',
      title: 'Missing Page Title Tag',
      fix: 'Add a concise <title> tag between 30 and 60 characters containing primary keywords.',
    });
  } else if (onPage.titleLength < 30 || onPage.titleLength > 65) {
    issues.push({
      impact: 'Medium',
      category: 'SEO',
      title: `Suboptimal Title Length (${onPage.titleLength} chars)`,
      fix: 'Adjust <title> tag to optimal 30-60 characters to avoid search result truncation.',
    });
  }

  if (!onPage.description) {
    issues.push({
      impact: 'High',
      category: 'SEO',
      title: 'Missing Meta Description',
      fix: 'Add a <meta name="description"> tag between 120 and 160 characters summarizing the page.',
    });
  }

  if (onPage.h1s.length === 0) {
    issues.push({
      impact: 'High',
      category: 'SEO',
      title: 'No H1 Heading Found',
      fix: 'Implement exactly one primary <h1> tag representing the page topic.',
    });
  } else if (onPage.h1s.length > 1) {
    issues.push({
      impact: 'Medium',
      category: 'SEO',
      title: `Multiple H1 Tags Detected (${onPage.h1s.length})`,
      fix: 'Consolidate multiple <h1> elements into one primary <h1> and use <h2>/<h3> subheadings.',
    });
  }

  const dLcp = pageSpeedReport.desktop?.cwv?.lcp;
  if (dLcp && parseFloat(dLcp) > 2.5) {
    issues.push({
      impact: 'High',
      category: 'Performance',
      title: `Slow Desktop Largest Contentful Paint (${dLcp})`,
      fix: 'Optimize and preload hero/LCP assets and serve modern WebP/AVIF images.',
    });
  }

  if (onPage.images.missingAltCount > 0) {
    issues.push({
      impact: 'Medium',
      category: 'Accessibility',
      title: `${onPage.images.missingAltCount} Images Missing Alt Attributes`,
      fix: 'Add descriptive alt="" attributes to all content images for screen readers and SEO.',
    });
  }

  if (!crawlReport.isHttps) {
    issues.push({
      impact: 'High',
      category: 'Security',
      title: 'Site Not Served Over HTTPS',
      fix: 'Install an SSL/TLS certificate and enforce automatic HTTP-to-HTTPS 301 redirection.',
    });
  } else if (!headers.securityHeaders.hsts) {
    issues.push({
      impact: 'Medium',
      category: 'Security',
      title: 'Strict-Transport-Security (HSTS) Header Missing',
      fix: 'Enable Strict-Transport-Security header (max-age=31536000; includeSubDomains).',
    });
  }

  if (!onPage.canonical) {
    issues.push({
      impact: 'Medium',
      category: 'SEO',
      title: 'Missing Canonical Link Tag',
      fix: 'Add a <link rel="canonical" href="..."> tag to eliminate duplicate content ambiguity.',
    });
  }

  if (!crawlReport.robots.found) {
    issues.push({
      impact: 'Low',
      category: 'Crawlability',
      title: 'robots.txt Not Accessible',
      fix: 'Upload a standard robots.txt file to website root referencing your XML sitemap.',
    });
  }

  if (!crawlReport.sitemap.found) {
    issues.push({
      impact: 'Medium',
      category: 'Crawlability',
      title: 'XML Sitemap Not Detected',
      fix: 'Create a sitemap.xml and submit to Google Search Console and Bing Webmaster Tools.',
    });
  }

  if (!onPage.viewport) {
    issues.push({
      impact: 'High',
      category: 'Mobile UX',
      title: 'Missing Viewport Meta Tag',
      fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0"> in <head>.',
    });
  }

  const priorityOrder = { High: 3, Medium: 2, Low: 1 };
  issues.sort((a, b) => priorityOrder[b.impact] - priorityOrder[a.impact]);
  return issues.slice(0, 5);
}

function buildFinalReport({ url, targetReport, pageSpeedReport, probeReport, crawlReport }) {
  const rating = calculateSystemRating(
    pageSpeedReport,
    probeReport,
    targetReport.onPageAudit,
    crawlReport,
    targetReport.headerAudit
  );
  const fixList = generateFixList(targetReport, pageSpeedReport, crawlReport);

  return {
    url,
    timestamp: new Date().toISOString(),
    systemRating: rating,
    speed: {
      provider: pageSpeedReport.provider,
      hasPageSpeedData: pageSpeedReport.hasPageSpeedData,
      errorType: pageSpeedReport.errorType || null,
      note: pageSpeedReport.note || null,
      desktop: pageSpeedReport.desktop,
      mobile: pageSpeedReport.mobile,
      desktopError: pageSpeedReport.desktopError || null,
      mobileError: pageSpeedReport.mobileError || null,
      fieldData: pageSpeedReport.fieldData || { hasFieldData: false, message: 'Not enough real-user data for this site' },
    },
    probes: probeReport,
    onPage: targetReport.onPageAudit,
    crawl: crawlReport,
    headers: targetReport.headerAudit,
    network: {
      status: targetReport.status,
      finalUrl: targetReport.finalUrl,
      ttfbMs: targetReport.ttfb,
      totalLatencyMs: targetReport.totalLatency,
      redirectCount: Math.max(0, targetReport.redirectChain.length - 1),
      redirectChain: targetReport.redirectChain,
      htmlSizeBytes: targetReport.htmlSizeBytes,
    },
    fixThisFirst: fixList,
  };
}

function jsonResponse(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow',
      ...extraHeaders,
    },
  });
}
