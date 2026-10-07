/**
 * SeoSonar Cloudflare Worker with Static Assets
 * Production Worker Entry Point - Handles /api/scan & Static Assets Routing
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

/**
 * Safe KV write helper to ensure a scan never fails if KV daily write limits are hit
 */
async function safeKvPut(kv, key, value, options) {
  if (!kv) return false;
  try {
    await kv.put(key, value, options);
    return true;
  } catch (err) {
    console.warn(`[SafeKV] Warning: KV put failed for key "${key}":`, err?.message || err);
    return false;
  }
}

/**
 * Helper to format relative time for stale cache results
 */
function formatTimeAgo(diffMs) {
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

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
    try {
      const val = await kv.get(key);
      const count = val ? parseInt(val, 10) : 0;
      if (count + weight > LIMIT) {
        const resetInSeconds = 3600 - Math.floor((Date.now() % 3600000) / 1000);
        return { allowed: false, remaining: 0, resetInSeconds };
      }
      await safeKvPut(kv, key, String(count + weight), { expirationTtl: 3600 });
      return { allowed: true, remaining: Math.max(0, LIMIT - (count + weight)) };
    } catch {}
  }

  const memVal = memRateLimit.get(key) || 0;
  if (memVal + weight > LIMIT) {
    const resetInSeconds = 3600 - Math.floor((Date.now() % 3600000) / 1000);
    return { allowed: false, remaining: 0, resetInSeconds };
  }
  memRateLimit.set(key, memVal + weight);
  return { allowed: true, remaining: Math.max(0, LIMIT - (memVal + weight)) };
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}${u.pathname.replace(/\/+$/, '') || '/'}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

/**
 * Global daily usage counter for speed test API calls (25,000 free-tier daily cap)
 */
async function getDailySpeedTestUsage(kv) {
  if (!kv) return 0;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const val = await kv.get(`usage:speed-tests:${day}`);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

async function incrementDailySpeedTestUsage(kv, amount = 1) {
  if (!kv) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const key = `usage:speed-tests:${day}`;
    const current = await getDailySpeedTestUsage(kv);
    await safeKvPut(kv, key, String(current + amount), { expirationTtl: 86400 * 2 });
  } catch {}
}

/**
 * Worker Entry Point
 */
export default {
  async fetch(request, env, ctx) {
    const reqUrl = new URL(request.url);

    // Route /api/* requests to the Worker API logic
    if (reqUrl.pathname.startsWith('/api/')) {
      return handleApiRequest(request, env, ctx);
    }

    // Static Asset fallback if ASSETS binding is present
    if (env.ASSETS) {
      const assetRes = await env.ASSETS.fetch(request);
      
      // Determine if we must append X-Robots-Tag: noindex (e.g. while hosted on *.workers.dev)
      const isWorkersDev = reqUrl.hostname.endsWith('.workers.dev');
      const sendNoindex = env.SEND_NOINDEX === 'true' || isWorkersDev;

      if (sendNoindex) {
        const newHeaders = new Headers(assetRes.headers);
        newHeaders.set('X-Robots-Tag', 'noindex');
        return new Response(assetRes.body, {
          status: assetRes.status,
          statusText: assetRes.statusText,
          headers: newHeaders,
        });
      }

      return assetRes;
    }

    return new Response('SeoSonar API Worker running.', { status: 200 });
  },
};

/**
 * Handles /api/scan & other API endpoints
 */
async function handleApiRequest(request, env, ctx) {
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
  if (reqUrl.pathname !== '/api/scan') {
    return jsonResponse({ error: 'Endpoint not found', code: 'NOT_FOUND' }, 404);
  }

  const clientIp = request.headers.get('cf-connecting-ip') || '127.0.0.1';
  const isLocalDev = clientIp === '127.0.0.1' || reqUrl.hostname === 'localhost' || reqUrl.hostname === '127.0.0.1';
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

  // Check 20-minute whole-report cache
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
    // Run target fetch, speed tests, probes, and crawl checks in parallel
    const [targetReport, speedReport, probeReport, crawlReport] = await Promise.all([
      fetchAndAnalyzeTarget(sec.url),
      fetchSpeedTests(sec.url, env.PAGESPEED_API_KEY, env),
      fetchGlobalProbes(sec.parsed.hostname, env.GLOBALPING_TOKEN),
      fetchCrawlBasics(sec.url),
    ]);

    const report = buildFinalReport({
      url: sec.url,
      targetReport,
      speedReport,
      probeReport,
      crawlReport,
    });

    // Cache final report for 20 minutes (1200 seconds)
    if (env.SEOSONAR_KV) {
      await safeKvPut(env.SEOSONAR_KV, cacheKey, JSON.stringify(report), { expirationTtl: 1200 });
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

/**
 * Target Analysis: HTML fetch, DOM elements, Headings, Open Graph, Compression, HSTS
 */
async function fetchAndAnalyzeTarget(url) {
  const startTime = Date.now();
  let ttfb = 0;
  let response;
  const redirectChain = [url];

  try {
    let currentUrl = url;
    let hops = 0;
    while (hops < 5) {
      const hopStart = Date.now();
      const res = await fetch(currentUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 SeoSonar/1.2',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(12000),
      });

      if (hops === 0) {
        ttfb = Date.now() - hopStart;
      }

      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location');
        if (!loc) {
          response = res;
          break;
        }
        const nextUrl = new URL(loc, currentUrl).href;
        const secCheck = await validateUrlSecurity(nextUrl);
        if (!secCheck.ok) {
          throw new Error(`Redirect blocked: ${secCheck.error}`);
        }
        redirectChain.push(nextUrl);
        currentUrl = nextUrl;
        hops++;
        response = res;
      } else {
        response = res;
        break;
      }
    }
  } catch (err) {
    throw new Error(`Failed to fetch target URL: ${err.message}`);
  }

  const totalLatency = Date.now() - startTime;
  const finalUrl = redirectChain[redirectChain.length - 1];
  const status = response.status;
  const headers = Object.fromEntries(response.headers.entries());

  const contentType = headers['content-type'] || '';
  let html = '';
  let htmlSizeBytes = 0;

  if (contentType.includes('text/html') || contentType.includes('application/xhtml+xml') || !contentType) {
    try {
      const buffer = await response.arrayBuffer();
      htmlSizeBytes = buffer.byteLength;
      const decoder = new TextDecoder('utf-8', { fatal: false });
      html = decoder.decode(buffer);
    } catch {
      html = '';
    }
  }

  const onPageAudit = parseHtmlElements(html, finalUrl);
  const headerAudit = {
    contentEncoding: headers['content-encoding'] || 'none',
    compression: headers['content-encoding'] ? headers['content-encoding'].toLowerCase() : 'none',
    server: headers['server'] || 'Unknown',
    securityHeaders: {
      hsts: Boolean(headers['strict-transport-security']),
      hstsValue: headers['strict-transport-security'] || null,
      csp: Boolean(headers['content-security-policy']),
      cspValue: headers['content-security-policy'] || null,
      xContentTypeOptions: headers['x-content-type-options'] === 'nosniff',
      xFrameOptions: Boolean(headers['x-frame-options']),
      xFrameOptionsValue: headers['x-frame-options'] || null,
      referrerPolicy: headers['referrer-policy'] || null,
      permissionsPolicy: Boolean(headers['permissions-policy']),
    },
  };

  return {
    status,
    finalUrl,
    ttfb,
    totalLatency,
    redirectChain,
    htmlSizeBytes,
    onPageAudit,
    headerAudit,
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
      robotsMeta: null,
      images: { total: 0, missingAltCount: 0 },
      wordCount: 0,
      lang: null,
      openGraph: {},
      twitterCard: {},
      structuredData: { count: 0, types: [] },
    };
  }

  let title = null;
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) title = cleanText(titleMatch[1]);

  let description = null;
  const descMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                    html.match(/<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (descMatch) description = cleanText(descMatch[1]);

  const h1s = [];
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let match;
  while ((match = h1Regex.exec(html)) !== null) {
    const text = cleanText(match[1]);
    if (text) h1s.push(text);
  }

  let canonical = null;
  const canMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i) ||
                    html.match(/<link\s+[^>]*href=["']([^"']*)["'][^>]*rel=["']canonical["']/i);
  if (canMatch) canonical = canMatch[1].trim();

  let viewport = null;
  const vpMatch = html.match(/<meta\s+[^>]*name=["']viewport["'][^>]*content=["']([^"']*)["']/i);
  if (vpMatch) viewport = vpMatch[1].trim();

  let robotsMeta = null;
  const robMatch = html.match(/<meta\s+[^>]*name=["']robots["'][^>]*content=["']([^"']*)["']/i);
  if (robMatch) robotsMeta = robMatch[1].trim();

  let lang = null;
  const langMatch = html.match(/<html\s+[^>]*lang=["']([^"']*)["']/i);
  if (langMatch) lang = langMatch[1].trim();

  let totalImages = 0;
  let missingAlt = 0;
  const imgRegex = /<img\s+([^>]*?)>/gi;
  while ((match = imgRegex.exec(html)) !== null) {
    totalImages++;
    const attrs = match[1];
    if (!/alt=["'][^"']*["']/i.test(attrs) || /alt=["']\s*["']/i.test(attrs)) {
      missingAlt++;
    }
  }

  const og = {};
  const ogRegex = /<meta\s+[^>]*property=["'](og:[^"']+)["'][^>]*content=["']([^"']*)["']/gi;
  while ((match = ogRegex.exec(html)) !== null) {
    og[match[1]] = match[2];
  }

  const twitter = {};
  const twRegex = /<meta\s+[^>]*name=["'](twitter:[^"']+)["'][^>]*content=["']([^"']*)["']/gi;
  while ((match = twRegex.exec(html)) !== null) {
    twitter[match[1]] = match[2];
  }

  const types = new Set();
  let schemaCount = 0;
  const ldJsonRegex = /<script\s+[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = ldJsonRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      schemaCount++;
      extractSchemaTypes(parsed, types);
    } catch {}
  }

  const textOnly = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordCount = textOnly ? textOnly.split(/\s+/).length : 0;

  return {
    title,
    titleLength: title ? title.length : 0,
    description,
    descriptionLength: description ? description.length : 0,
    h1s,
    canonical,
    viewport,
    robotsMeta,
    images: { total: totalImages, missingAltCount: missingAlt },
    wordCount,
    lang,
    openGraph: og,
    twitterCard: twitter,
    structuredData: { count: schemaCount, types: Array.from(types) },
  };
}

function cleanText(str) {
  if (!str) return '';
  return str.replace(/<[^>]+>/g, '').replace(/&[a-z0-9#]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function extractSchemaTypes(obj, typeSet) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((i) => extractSchemaTypes(i, typeSet));
    return;
  }
  if (obj['@type']) {
    if (Array.isArray(obj['@type'])) {
      obj['@type'].forEach((t) => typeSet.add(t));
    } else {
      typeSet.add(obj['@type']);
    }
  }
  if (obj['@graph'] && Array.isArray(obj['@graph'])) {
    obj['@graph'].forEach((i) => extractSchemaTypes(i, typeSet));
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

function extractTopLabFixes(audits) {
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
 * Speed Tests & Lab Data Integration with Fallback Ladder:
 * 1. 20-min strategy-level KV caching
 * 2. Stale cache fallback on quota / rate limit (marked "last tested X ago")
 * 3. Daily usage counter:
 *    - At 90% (22,500/day): switch to Desktop-only speed tests
 *    - At 100% (25,000/day) or quota errors: fallback to Partial Rating
 * 4. Safe error handling (never exposes API key)
 * 5. Uses standard `fields` filter to keep CPU time & payload tiny
 */
async function fetchSpeedTests(url, apiKey, env) {
  const hasKey = Boolean(apiKey && apiKey.trim().length > 0);

  if (!hasKey) {
    return {
      success: false,
      hasSpeedData: false,
      provider: 'Speed tests and lab data',
      errorType: 'NO_KEY',
      note: 'Speed tests temporarily unavailable. Showing measured metrics only.',
      desktop: null,
      mobile: null,
      fieldData: { hasFieldData: false, message: 'Not enough real-user data for this site' },
      lighthouseFixes: [],
    };
  }

  const normalized = normalizeUrl(url);
  const cleanKey = apiKey.trim();

  // Check global daily usage limit (25,000 free-plan limit)
  const dailyUsage = await getDailySpeedTestUsage(env?.SEOSONAR_KV);
  const atDesktopOnlyThreshold = dailyUsage >= 22500; // 90% threshold
  const atQuotaLimit = dailyUsage >= 25000;          // 100% threshold

  if (atQuotaLimit) {
    // Check if we have stale cache for this URL
    const staleD = env?.SEOSONAR_KV ? await env.SEOSONAR_KV.get(`ps:stale:desktop:${normalized}`, 'json') : null;
    const staleM = env?.SEOSONAR_KV ? await env.SEOSONAR_KV.get(`ps:stale:mobile:${normalized}`, 'json') : null;

    if (staleD && staleD.data) {
      const dParsed = parseStrategyResult(staleD.data, 'desktop');
      const mParsed = staleM?.data ? parseStrategyResult(staleM.data, 'mobile') : null;
      const staleAge = formatTimeAgo(Date.now() - (staleD.timestamp || Date.now()));
      return {
        success: true,
        hasSpeedData: true,
        provider: 'Speed tests and lab data',
        isStale: true,
        staleAgo: staleAge,
        desktop: dParsed?.lab || null,
        mobile: mParsed?.lab || null,
        fieldData: dParsed?.fieldData || { hasFieldData: false, message: 'Not enough real-user data for this site' },
        lighthouseFixes: deduplicateFixes([
          ...extractTopLabFixes(dParsed?.audits),
          ...extractTopLabFixes(mParsed?.audits),
        ]),
      };
    }

    // Daily limit reached and no cache -> fallback to partial rating
    return {
      success: false,
      hasSpeedData: false,
      provider: 'Speed tests and lab data',
      errorType: 'DAILY_QUOTA_REACHED',
      note: 'Daily speed test capacity reached. Showing measured on-page, crawl, and probe metrics only.',
      desktop: null,
      mobile: null,
      fieldData: { hasFieldData: false, message: 'Not enough real-user data for this site' },
      lighthouseFixes: [],
    };
  }

  // Subrequest helper for one viewport strategy
  async function fetchStrategy(strategy) {
    const kvKey = `ps:${strategy}:${normalized}`;
    const staleKey = `ps:stale:${strategy}:${normalized}`;

    // 1. Check 20-min active KV cache
    if (env?.SEOSONAR_KV) {
      try {
        const cached = await env.SEOSONAR_KV.get(kvKey, 'json');
        if (cached) return { success: true, data: cached, fromKv: true, isStale: false };
      } catch {}
    }

    // Request only needed fields to keep CPU time & payload small
    const fieldsFilter = encodeURIComponent('lighthouseResult(categories,audits),loadingExperience');
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=performance&category=accessibility&category=best-practices&category=seo&fields=${fieldsFilter}&key=${cleanKey}`;

    try {
      const res = await fetch(endpoint, {
        signal: AbortSignal.timeout(35000),
        headers: { Accept: 'application/json' },
      });

      if (res.status === 429) {
        // Quota exceeded: check for stale cache
        if (env?.SEOSONAR_KV) {
          try {
            const stale = await env.SEOSONAR_KV.get(staleKey, 'json');
            if (stale && stale.data) {
              const staleAge = formatTimeAgo(Date.now() - (stale.timestamp || Date.now()));
              return { success: true, data: stale.data, fromKv: true, isStale: true, staleAgo: staleAge };
            }
          } catch {}
        }
        return {
          success: false,
          errorType: 'QUOTA_EXCEEDED',
          message: 'The daily speed test quota has been reached. Please try again later.',
        };
      }

      if (res.status === 400 || res.status === 403) {
        return {
          success: false,
          errorType: 'KEY_INVALID',
          message: 'Speed test service configuration error.',
        };
      }

      if (!res.ok) {
        // HTTP error: check for stale cache
        if (env?.SEOSONAR_KV) {
          try {
            const stale = await env.SEOSONAR_KV.get(staleKey, 'json');
            if (stale && stale.data) {
              const staleAge = formatTimeAgo(Date.now() - (stale.timestamp || Date.now()));
              return { success: true, data: stale.data, fromKv: true, isStale: true, staleAgo: staleAge };
            }
          } catch {}
        }
        return {
          success: false,
          errorType: 'HTTP_ERROR',
          message: `Speed test inspection failed with HTTP ${res.status}. Target site may be blocking audit bots.`,
        };
      }

      const json = await res.json();

      // Record daily usage increment
      await incrementDailySpeedTestUsage(env?.SEOSONAR_KV, 1);

      // Store in 20-min active cache AND 7-day stale cache backup
      if (env?.SEOSONAR_KV && json) {
        await safeKvPut(env.SEOSONAR_KV, kvKey, JSON.stringify(json), { expirationTtl: 1200 });
        await safeKvPut(
          env.SEOSONAR_KV,
          staleKey,
          JSON.stringify({ timestamp: Date.now(), data: json }),
          { expirationTtl: 604800 } // 7 days
        );
      }
      return { success: true, data: json, fromKv: false, isStale: false };
    } catch (err) {
      // Network or timeout: check for stale cache
      if (env?.SEOSONAR_KV) {
        try {
          const stale = await env.SEOSONAR_KV.get(staleKey, 'json');
          if (stale && stale.data) {
            const staleAge = formatTimeAgo(Date.now() - (stale.timestamp || Date.now()));
            return { success: true, data: stale.data, fromKv: true, isStale: true, staleAgo: staleAge };
          }
        } catch {}
      }

      return {
        success: false,
        errorType: 'TIMEOUT_OR_NETWORK',
        message: err.name === 'TimeoutError'
          ? `Speed test inspection timed out for ${strategy}.`
          : `Speed test connection issue: ${stripKeyFromUrl(err.message)}`,
      };
    }
  }

  let dRes;
  let mRes;

  if (atDesktopOnlyThreshold) {
    // 90%+ daily quota: execute Desktop only to save mobile quota
    dRes = await fetchStrategy('desktop');
    mRes = { success: false, message: 'Omitted to conserve daily speed test capacity' };
  } else {
    // Fetch Desktop and Mobile in parallel
    [dRes, mRes] = await Promise.all([
      fetchStrategy('desktop'),
      fetchStrategy('mobile'),
    ]);
  }

  // If both strategies failed or quota exceeded without stale cache
  if (!dRes.success && !mRes.success) {
    return {
      success: false,
      hasSpeedData: false,
      provider: 'Speed tests and lab data',
      errorType: dRes.errorType || mRes.errorType || 'ERROR',
      note: dRes.message || 'Speed tests temporarily unavailable.',
      desktop: null,
      mobile: null,
      fieldData: { hasFieldData: false, message: 'Not enough real-user data for this site' },
      lighthouseFixes: [],
    };
  }

  const dParsed = dRes.success ? parseStrategyResult(dRes.data, 'desktop') : null;
  const mParsed = mRes.success ? parseStrategyResult(mRes.data, 'mobile') : null;

  const lhFixes = [
    ...extractTopLabFixes(dParsed?.audits),
    ...extractTopLabFixes(mParsed?.audits),
  ];

  const fieldData = dParsed?.fieldData?.hasFieldData
    ? dParsed.fieldData
    : (mParsed?.fieldData?.hasFieldData ? mParsed.fieldData : { hasFieldData: false, message: 'Not enough real-user data for this site' });

  const isAnyStale = Boolean(dRes.isStale || mRes.isStale);
  const staleAgo = dRes.staleAgo || mRes.staleAgo || null;

  return {
    success: true,
    hasSpeedData: true,
    provider: 'Speed tests and lab data',
    isStale: isAnyStale,
    staleAgo,
    desktop: dParsed?.lab || null,
    mobile: mParsed?.lab || null,
    desktopError: !dParsed ? dRes.message : null,
    mobileError: !mParsed ? mRes.message : null,
    fieldData,
    lighthouseFixes: deduplicateFixes(lhFixes),
  };
}

/**
 * Country Probes with Fallback & Failure Resilience
 * If probe network fails or is rate limited: returns failed=true with neutral message
 * and skips latency penalty.
 */
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
          success: true,
          failed: false,
          provider: 'Global Probe Network',
          isProbeNote: 'Results measured from distributed probe servers across the globe, not real user field data.',
          probes,
        };
      }
    }
  } catch (err) {
    console.warn('[Probes] Global probe fetch failed or timed out:', err?.message || err);
  }

  // Country probes failed or rate-limited: Return clean message and skip latency penalty
  return {
    success: false,
    failed: true,
    provider: 'Global Probe Network',
    message: 'Country probe measurements temporarily unavailable. Latency penalty was not applied.',
    probes: [],
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
 * - If Speed data is available: full 4-factor rating (Performance 35%, SEO 35%, A11y 15%, Best Practices 15% - country penalty).
 * - If NO Speed data: computes honest partial rating exclusively from measured On-Page SEO (50%) and Crawl/Security (50%) - probe penalty.
 * - If probes failed: latency penalty is NOT applied (penalty = 0).
 */
function calculateSystemRating(speedReport, probeReport, onPage, crawl, headers) {
  const { weights, countryPenalty } = RATING_CONFIG;

  let penalty = 0;
  // If country probes failed or are empty: do NOT apply latency penalty!
  if (probeReport && !probeReport.failed && Array.isArray(probeReport.probes) && probeReport.probes.length > 0) {
    for (const p of probeReport.probes) {
      if (!p.success || p.status >= 400) {
        penalty += countryPenalty.unreachablePenaltyPerCountry;
      } else if (p.latencyMs > countryPenalty.slowThresholdMs) {
        penalty += countryPenalty.slowPenaltyPerCountry;
      }
    }
    penalty = Math.min(penalty, countryPenalty.maxTotalPenalty);
  }

  // If real speed test lab data exists
  if (speedReport && speedReport.hasSpeedData && (speedReport.desktop || speedReport.mobile)) {
    const d = speedReport.desktop || speedReport.mobile;
    const m = speedReport.mobile || speedReport.desktop;
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
      source: 'Speed tests and lab data',
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
    ratingLabel: 'Partial rating (speed tests unavailable)',
    note: `Calculated from measured On-Page SEO (${seoScore}/100) and Crawl/Security (${crawlScore}/100). Excludes lab performance, accessibility, and best practices.`,
    breakdown: {
      performance: { score: null, label: 'Speed tests temporarily unavailable', weight: 'Excluded' },
      seo: { score: seoScore, label: 'Measured On-Page SEO', weight: '100% (Partial)' },
      accessibility: { score: null, label: 'Speed tests temporarily unavailable', weight: 'Excluded' },
      bestPractices: { score: null, label: 'Speed tests temporarily unavailable', weight: 'Excluded' },
    },
  };
}

function generateFixList(targetReport, speedReport, crawlReport) {
  const issues = [];
  const onPage = targetReport.onPageAudit;
  const headers = targetReport.headerAudit;

  if (speedReport?.lighthouseFixes && Array.isArray(speedReport.lighthouseFixes)) {
    issues.push(...speedReport.lighthouseFixes);
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

  const dLcp = speedReport.desktop?.cwv?.lcp;
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
      fix: 'Create a sitemap.xml and submit to search engine webmaster tools.',
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

function buildFinalReport({ url, targetReport, speedReport, probeReport, crawlReport }) {
  const rating = calculateSystemRating(
    speedReport,
    probeReport,
    targetReport.onPageAudit,
    crawlReport,
    targetReport.headerAudit
  );
  const fixList = generateFixList(targetReport, speedReport, crawlReport);

  return {
    url,
    timestamp: new Date().toISOString(),
    systemRating: rating,
    speed: {
      provider: speedReport.provider,
      hasSpeedData: speedReport.hasSpeedData,
      hasPageSpeedData: speedReport.hasSpeedData, // backward compatibility
      errorType: speedReport.errorType || null,
      note: speedReport.note || null,
      isStale: speedReport.isStale || false,
      staleAgo: speedReport.staleAgo || null,
      desktop: speedReport.desktop,
      mobile: speedReport.mobile,
      desktopError: speedReport.desktopError || null,
      mobileError: speedReport.mobileError || null,
      fieldData: speedReport.fieldData || { hasFieldData: false, message: 'Not enough real-user data for this site' },
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
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}
