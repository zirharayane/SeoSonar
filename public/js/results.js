/**
 * SeoSonar - Results Engine, Tab Manager, Compare Mode & History
 * Accessible Windows 98 Modal Popups & Arrow-Key Tab Navigation
 */

import { openModal, showErrorDialog } from './app.js';

let lastReportData = null;

export function hasLastReport() {
  return Boolean(lastReportData);
}

/**
 * Accessible Tab Navigation with Left/Right Arrow Key Support
 */
export function initTabs() {
  const tablist = document.querySelector('menu[role="tablist"]');
  if (!tablist) return;

  const tabs = Array.from(tablist.querySelectorAll('button[role="tab"]'));

  tabs.forEach((tabBtn, index) => {
    // Click selection
    tabBtn.onclick = () => activateTab(tabBtn, tabs);

    // Keyboard Arrow navigation (W3C ARIA Tab Pattern)
    tabBtn.onkeydown = (e) => {
      let nextIndex = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        nextIndex = (index + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      }

      if (nextIndex !== null) {
        e.preventDefault();
        const targetTab = tabs[nextIndex];
        activateTab(targetTab, tabs);
        targetTab.focus();
      }
    };
  });
}

function activateTab(activeTabBtn, allTabs) {
  const targetPanelId = activeTabBtn.getAttribute('aria-controls');

  allTabs.forEach((btn) => {
    btn.setAttribute('aria-selected', 'false');
    btn.classList.remove('active');
    btn.setAttribute('tabindex', '-1');
  });

  activeTabBtn.setAttribute('aria-selected', 'true');
  activeTabBtn.classList.add('active');
  activeTabBtn.setAttribute('tabindex', '0');

  const container = activeTabBtn.closest('.modal-dialog') || document;
  container.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.remove('active');
  });

  const targetPanel = document.getElementById(targetPanelId);
  if (targetPanel) {
    targetPanel.classList.add('active');
  }
}

/**
 * Render Complete Audit Report into the Centered Modal Popup
 */
export function renderReport(data) {
  lastReportData = data;
  initTabs();

  // Save to Local History
  saveToHistory(data);

  // Update popup window title
  const domain = getDomainName(data.url);
  const titleEl = document.getElementById('results-window-title');
  if (titleEl) {
    titleEl.textContent = `Report - ${domain} (${data.network?.status || 200} OK)`;
  }

  // 1. Overview Tab (Desktop first, then Mobile)
  renderOverview(data);

  // 2. Speed & CWV Tab (Desktop first, then Mobile)
  renderSpeedTab(data);

  // 3. Global Probes Tab
  renderProbesTab(data);

  // 4. On-Page SEO Tab
  renderOnPageTab(data);

  // 5. Headers & Crawl Tab
  renderHeadersTab(data);

  // 6. Export Actions
  setupExportActions(data);

  // Reset to first tab (Overview)
  const firstTab = document.getElementById('tab-btn-overview');
  if (firstTab) {
    const tabs = Array.from(document.querySelectorAll('menu[role="tablist"] button[role="tab"]'));
    activateTab(firstTab, tabs);
  }
}

function getDomainName(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function renderOverview(data) {
  const rating = data.systemRating || { score: 80, baseScore: 80, penalty: 0, breakdown: {} };
  const speed = data.speed || {};
  const hasSpeedData = speed.hasSpeedData === true;
  const d = speed.desktop;
  const m = speed.mobile;

  const ratingBar = document.getElementById('rating-progress-bar');
  const ratingScore = document.getElementById('rating-score-display');
  const ratingDesc = document.getElementById('rating-summary-desc');
  const desktopMobileScores = document.getElementById('overview-desktop-mobile-scores');
  const estimatedBanner = document.getElementById('estimated-data-banner');

  if (ratingBar) ratingBar.style.width = `${rating.score}%`;
  if (ratingScore) ratingScore.textContent = `${rating.score} / 100`;

  let grade = 'Excellent';
  if (rating.score < 50) grade = 'Critical Issues Detected';
  else if (rating.score < 75) grade = 'Needs Optimization';
  else if (rating.score < 90) grade = 'Good Performance';

  if (ratingDesc) {
    if (rating.isPartial) {
      ratingDesc.innerHTML = `<strong>${escapeHtml(rating.ratingLabel || 'Partial rating (measured metrics only)')}</strong> (${rating.baseScore} base - ${rating.penalty} country probe latency penalty)`;
    } else {
      ratingDesc.innerHTML = `<strong>Rating: ${grade}</strong> (${rating.baseScore} base - ${rating.penalty} country probe latency penalty)`;
    }
  }

  // Desktop first, then Mobile scores badge next to System Rating
  if (desktopMobileScores) {
    if (!hasSpeedData) {
      desktopMobileScores.innerHTML = `<span class="badge-needs-key">Speed tests unavailable</span>`;
    } else {
      const dScore = d?.performance ?? '--';
      const mScore = m?.performance ?? '--';
      desktopMobileScores.innerHTML = `
        <span>Desktop: <strong class="metric-rating ${getRatingClass(dScore)}">${dScore}</strong></span>
        <span style="margin: 0 4px; color: #808080;">|</span>
        <span>Mobile: <strong class="metric-rating ${getRatingClass(mScore)}">${mScore}</strong></span>
      `;
    }
  }

  if (estimatedBanner) {
    if (speed.isStale) {
      estimatedBanner.style.display = 'block';
      estimatedBanner.innerHTML = `<strong>Notice:</strong> Speed test service temporarily at capacity. Showing cached result (last tested ${escapeHtml(speed.staleAgo || 'earlier')}).`;
    } else if (!hasSpeedData) {
      estimatedBanner.style.display = 'block';
      estimatedBanner.innerHTML = `<strong>Notice:</strong> ${escapeHtml(speed.note || 'Speed tests temporarily unavailable. Showing measured on-page, crawl, and probe metrics only.')}`;
    } else {
      estimatedBanner.style.display = 'none';
    }
  }

  const b = rating.breakdown || {};
  const perfEl = document.getElementById('score-perf');
  if (perfEl) {
    if (!hasSpeedData) {
      perfEl.innerHTML = '<span class="badge-needs-key">Speed tests unavailable</span>';
      perfEl.className = 'metric-rating';
    } else {
      const dPerf = d?.performance ?? 80;
      const mPerf = m?.performance ?? 80;
      const avgPerf = b.performance?.score ?? Math.round((dPerf + mPerf) / 2);
      perfEl.textContent = `${avgPerf} (PC: ${dPerf}, Mobile: ${mPerf})`;
      perfEl.className = 'metric-rating ' + getRatingClass(avgPerf);
    }
  }

  setScoreBadge('score-seo', b.seo?.score);

  const a11yEl = document.getElementById('score-a11y');
  if (a11yEl) {
    if (!hasSpeedData) {
      a11yEl.innerHTML = '<span class="badge-needs-key">Speed tests unavailable</span>';
      a11yEl.className = 'metric-rating';
    } else {
      setScoreBadge('score-a11y', b.accessibility?.score);
    }
  }

  const bestEl = document.getElementById('score-best');
  if (bestEl) {
    if (!hasSpeedData) {
      bestEl.innerHTML = '<span class="badge-needs-key">Speed tests unavailable</span>';
      bestEl.className = 'metric-rating';
    } else {
      setScoreBadge('score-best', b.bestPractices?.score);
    }
  }

  // Fix This First Top 5 List
  const fixListEl = document.getElementById('fix-this-first-list');
  if (fixListEl) {
    fixListEl.innerHTML = '';
    const fixes = data.fixThisFirst || [];
    if (fixes.length === 0) {
      fixListEl.innerHTML = '<li class="fix-item"><strong>✓ No critical errors identified! Great work.</strong></li>';
    } else {
      fixes.forEach((f) => {
        const li = document.createElement('li');
        li.className = 'fix-item';
        li.innerHTML = `
          <span class="fix-badge ${f.impact.toLowerCase()}">${f.impact}</span>
          <div>
            <div class="fix-title">[${f.category}] ${escapeHtml(f.title)}</div>
            <div class="fix-desc"><strong>Fix:</strong> ${escapeHtml(f.fix)}</div>
          </div>
        `;
        fixListEl.appendChild(li);
      });
    }
  }

  const net = data.network || {};
  setElementText('net-final-url', net.finalUrl);
  setElementText('net-ttfb', `${net.ttfbMs} ms`);
  setElementText('net-redirects', `${net.redirectCount} hops`);
  setElementText('net-size', `${((net.htmlSizeBytes || 0) / 1024).toFixed(1)} KB`);
}

function getRatingClass(score) {
  if (typeof score !== 'number') return '';
  return score >= 90 ? 'rating-good' : score >= 60 ? 'rating-warning' : 'rating-poor';
}

function setScoreBadge(id, score) {
  const el = document.getElementById(id);
  if (!el) return;
  const num = typeof score === 'number' ? score : '--';
  el.textContent = `${num}`;
  el.className = 'metric-rating ' + getRatingClass(num);
}

function renderSpeedTab(data) {
  const speed = data.speed || {};
  const d = speed.desktop || {};
  const m = speed.mobile || {};
  const hasSpeedData = speed.hasSpeedData === true;

  const dScoreEl = document.getElementById('desktop-perf-score');
  const mScoreEl = document.getElementById('mobile-perf-score');

  if (dScoreEl) {
    if (!hasSpeedData) {
      dScoreEl.innerHTML = '<span class="badge-needs-key">Speed tests unavailable</span>';
      dScoreEl.className = 'metric-rating';
    } else {
      const dScore = d.performance ?? '--';
      dScoreEl.innerHTML = `${dScore}`;
      dScoreEl.className = 'metric-rating ' + getRatingClass(dScore);
    }
  }
  if (mScoreEl) {
    if (!hasSpeedData) {
      mScoreEl.innerHTML = '<span class="badge-needs-key">Speed tests unavailable</span>';
      mScoreEl.className = 'metric-rating';
    } else {
      const mScore = m.performance ?? '--';
      mScoreEl.innerHTML = `${mScore}`;
      mScoreEl.className = 'metric-rating ' + getRatingClass(mScore);
    }
  }

  // Core Web Vitals & Lab Metrics (Desktop Viewport first, then Mobile Viewport)
  if (!hasSpeedData) {
    const keyBadge = '<span class="badge-needs-key">Speed tests unavailable</span>';
    setElementHtml('cwv-d-lcp', keyBadge);
    setElementHtml('cwv-m-lcp', keyBadge);
    setElementHtml('cwv-d-cls', keyBadge);
    setElementHtml('cwv-m-cls', keyBadge);
    setElementHtml('cwv-d-tbt', keyBadge);
    setElementHtml('cwv-m-tbt', keyBadge);
    setElementHtml('cwv-d-fcp', keyBadge);
    setElementHtml('cwv-m-fcp', keyBadge);
    setElementHtml('cwv-d-si', keyBadge);
    setElementHtml('cwv-m-si', keyBadge);
  } else {
    setElementText('cwv-d-lcp', d.cwv?.lcp || 'N/A');
    setElementText('cwv-m-lcp', m.cwv?.lcp || 'N/A');
    setElementText('cwv-d-cls', d.cwv?.cls || 'N/A');
    setElementText('cwv-m-cls', m.cwv?.cls || 'N/A');
    setElementText('cwv-d-tbt', d.cwv?.tbt || 'N/A');
    setElementText('cwv-m-tbt', m.cwv?.tbt || 'N/A');
    setElementText('cwv-d-fcp', d.cwv?.fcp || 'N/A');
    setElementText('cwv-m-fcp', m.cwv?.fcp || 'N/A');
    setElementText('cwv-d-si', d.cwv?.si || 'N/A');
    setElementText('cwv-m-si', m.cwv?.si || 'N/A');
  }

  // Real-user field data block
  const cruxContainer = document.getElementById('crux-field-container');
  if (cruxContainer) {
    const fd = speed.fieldData;
    if (fd && fd.hasFieldData) {
      cruxContainer.innerHTML = `
        <table class="win-table" style="margin-top: 4px;">
          <thead>
            <tr>
              <th style="width: 45%;">Field Metric</th>
              <th style="width: 30%;">75th Percentile</th>
              <th style="width: 25%;">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>INP (Interaction to Next Paint)</strong></td>
              <td>${escapeHtml(fd.inp)}</td>
              <td><span class="metric-rating rating-good">Real-User</span></td>
            </tr>
            <tr>
              <td><strong>LCP (Largest Contentful Paint)</strong></td>
              <td>${escapeHtml(fd.lcp)}</td>
              <td><span class="metric-rating rating-good">Real-User</span></td>
            </tr>
            <tr>
              <td><strong>CLS (Cumulative Layout Shift)</strong></td>
              <td>${escapeHtml(fd.cls)}</td>
              <td><span class="metric-rating rating-good">Real-User</span></td>
            </tr>
            <tr>
              <td><strong>FCP (First Contentful Paint)</strong></td>
              <td>${escapeHtml(fd.fcp)}</td>
              <td><span class="metric-rating rating-good">Real-User</span></td>
            </tr>
            <tr>
              <td><strong>Overall Category</strong></td>
              <td colspan="2"><strong>${escapeHtml(fd.overallCategory)}</strong></td>
            </tr>
          </tbody>
        </table>
      `;
    } else {
      cruxContainer.innerHTML = `
        <p style="margin: 3px 0 0 0; font-size: 11px; color: #555555;">
          <em>${escapeHtml(fd?.message || 'Not enough real-user data for this site')}</em>
        </p>
      `;
    }
  }

  const noteEl = document.getElementById('speed-provider-note');
  if (noteEl) {
    if (speed.isStale) {
      noteEl.textContent = `* Showing cached speed test data (last tested ${speed.staleAgo || 'recently'}).`;
    } else if (!hasSpeedData) {
      noteEl.textContent = `* ${speed.note || 'Speed tests temporarily unavailable. Showing measured metrics only.'}`;
    } else {
      noteEl.textContent = 'Source: Speed tests and lab data (Desktop Viewport first, Mobile second)';
    }
  }
}

function renderProbesTab(data) {
  const probesContainer = document.getElementById('probes-table-body');
  if (!probesContainer) return;

  probesContainer.innerHTML = '';
  const probes = data.probes?.probes || [];

  if (data.probes?.failed || probes.length === 0) {
    probesContainer.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 18px; color: #555555;">
          <em>${escapeHtml(data.probes?.message || 'Country probe measurements temporarily unavailable. Latency penalty was not applied.')}</em>
        </td>
      </tr>
    `;
    return;
  }

  probes.forEach((p) => {
    const tr = document.createElement('tr');
    const isFast = p.latencyMs < 600;
    const isMedium = p.latencyMs >= 600 && p.latencyMs < 1500;
    const badgeClass = isFast ? 'rating-good' : isMedium ? 'rating-warning' : 'rating-poor';

    tr.innerHTML = `
      <td>${p.flag} <strong>${p.countryName} (${p.countryCode})</strong></td>
      <td>${escapeHtml(p.region)}</td>
      <td>${escapeHtml(p.city)}</td>
      <td><strong>${p.latencyMs} ms</strong></td>
      <td><span class="metric-rating ${p.success ? 'rating-good' : 'rating-poor'}">${p.status}</span></td>
      <td><span class="metric-rating ${badgeClass}">${isFast ? 'Fast' : isMedium ? 'Moderate' : 'Slow'}</span></td>
    `;
    probesContainer.appendChild(tr);
  });
}

function renderOnPageTab(data) {
  const on = data.onPage || {};

  setElementText('seo-title-text', on.title || '(No <title> found)');
  setElementText('seo-title-len', `${on.titleLength} characters (Optimal: 30-60)`);
  setElementText('seo-title-status', on.titleLength >= 30 && on.titleLength <= 65 ? '✓ Pass' : '⚠ Suboptimal');

  setElementText('seo-desc-text', on.description || '(No meta description found)');
  setElementText('seo-desc-len', `${on.descriptionLength} characters (Optimal: 120-160)`);
  setElementText('seo-desc-status', on.descriptionLength >= 100 && on.descriptionLength <= 165 ? '✓ Pass' : '⚠ Suboptimal');

  const h1Count = on.h1s ? on.h1s.length : 0;
  setElementText('seo-h1-count', `${h1Count} H1 detected`);
  setElementText('seo-h1-status', h1Count === 1 ? '✓ Pass (Single H1)' : '⚠ Issue (Expected 1 H1)');
  const h1ListEl = document.getElementById('seo-h1-list');
  if (h1ListEl) {
    h1ListEl.innerHTML = '';
    (on.h1s || []).forEach((h) => {
      const li = document.createElement('li');
      li.textContent = h;
      h1ListEl.appendChild(li);
    });
  }

  setElementText('seo-canonical', on.canonical || 'Not specified');
  setElementText('seo-viewport', on.viewport || 'Not specified');
  setElementText('seo-lang', on.lang || 'Not declared');

  setElementText('seo-img-total', on.images?.total || 0);
  setElementText('seo-img-missing', on.images?.missingAltCount || 0);

  const sd = on.structuredData || {};
  setElementText('seo-schema-count', `${sd.count || 0} JSON-LD block(s)`);
  setElementText('seo-schema-types', (sd.types && sd.types.length > 0) ? sd.types.join(', ') : 'None detected');
}

function renderHeadersTab(data) {
  const h = data.headers || {};
  const sec = h.securityHeaders || {};
  const c = data.crawl || {};

  setElementText('crawl-robots', c.robots?.found ? `✓ Found (${c.robots.url})` : '✗ 404 Not Found');
  setElementText('crawl-sitemap', c.sitemap?.found ? `✓ Detected (${c.sitemap.url})` : '✗ Missing / Not found');
  setElementText('crawl-https', c.isHttps ? '✓ HTTPS Active' : '✗ Unencrypted HTTP');

  setElementText('hdr-compression', h.compression || 'None');
  setElementText('hdr-cache', h.cacheControl || 'None');

  setElementText('hdr-hsts', sec.hsts ? '✓ Enabled' : '✗ Missing');
  setElementText('hdr-csp', sec.csp ? '✓ Present' : '✗ Missing');
  setElementText('hdr-x-content', sec.xContentTypeOptions ? '✓ nosniff' : '✗ Missing');
  setElementText('hdr-x-frame', sec.xFrameOptions ? `✓ ${sec.xFrameOptions}` : '✗ Missing');
  setElementText('hdr-referrer', sec.referrerPolicy ? `✓ ${sec.referrerPolicy}` : '✗ Not configured');
}

function setupExportActions(data) {
  const copyBtn = document.getElementById('btn-copy-report');
  if (copyBtn) {
    copyBtn.onclick = () => {
      const text = generateTextSummary(data);
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied to Clipboard!';
        setTimeout(() => { copyBtn.textContent = 'Copy Report Text'; }, 2000);
      });
    };
  }

  const printBtn = document.getElementById('btn-print-report');
  if (printBtn) {
    printBtn.onclick = () => { window.print(); };
  }

  const jsonEl = document.getElementById('raw-json-output');
  if (jsonEl) {
    jsonEl.textContent = JSON.stringify(data, null, 2);
  }
}

function generateTextSummary(data) {
  const d = getDomainName(data.url);
  const rating = data.systemRating?.score || 0;
  const fixes = data.fixThisFirst || [];
  const speed = data.speed || {};
  const field = speed.fieldData || {};
  const providerLabel = speed.hasSpeedData
    ? 'Source: Speed tests and lab data'
    : 'Partial rating (measured metrics only)';

  const fieldText = field.hasFieldData
    ? `  - INP: ${field.inp}\n  - LCP: ${field.lcp}\n  - CLS: ${field.cls}\n  - FCP: ${field.fcp}\n  - Overall Experience: ${field.overallCategory}`
    : `  ${field.message || 'Not enough real-user data for this site'}`;

  return `========================================================
SEOSONAR 98 - AUDIT REPORT: ${d}
========================================================
Target: ${data.url}
Final URL: ${data.network?.finalUrl || data.url}
Timestamp: ${data.timestamp}
System Rating: ${rating} / 100 (${providerLabel})

-- PERFORMANCE & SPEED (Desktop first, Mobile second) --
Desktop (PC) Performance: ${speed.desktop?.performance ?? 'N/A'}/100
Mobile Performance:       ${speed.mobile?.performance ?? 'N/A'}/100
Rating Component (Avg):   ${data.systemRating?.breakdown?.performance?.score ?? 'N/A'}/100

Desktop Core Web Vitals (Lab):
  - LCP: ${speed.desktop?.cwv?.lcp || 'N/A'}
  - CLS: ${speed.desktop?.cwv?.cls || 'N/A'}
  - TBT: ${speed.desktop?.cwv?.tbt || 'N/A'}
  - FCP: ${speed.desktop?.cwv?.fcp || 'N/A'}
  - SI:  ${speed.desktop?.cwv?.si || 'N/A'}

Mobile Core Web Vitals (Lab):
  - LCP: ${speed.mobile?.cwv?.lcp || 'N/A'}
  - CLS: ${speed.mobile?.cwv?.cls || 'N/A'}
  - TBT: ${speed.mobile?.cwv?.tbt || 'N/A'}
  - FCP: ${speed.mobile?.cwv?.fcp || 'N/A'}
  - SI:  ${speed.mobile?.cwv?.si || 'N/A'}

-- REAL-USER DATA --
${fieldText}

-- GLOBAL PROBES (LATENCY) --
${(data.probes?.probes || []).map((p) => `  [${p.countryCode}] ${p.countryName}: ${p.latencyMs} ms (HTTP ${p.status})`).join('\n')}

-- TOP 5 FIX THIS FIRST --
${fixes.map((f, i) => `${i + 1}. [${f.impact}] ${f.title}\n   Fix: ${f.fix}`).join('\n')}

-- ON-PAGE SEO --
Title: "${data.onPage?.title || 'None'}" (${data.onPage?.titleLength || 0} chars)
Meta Description: "${data.onPage?.description || 'None'}" (${data.onPage?.descriptionLength || 0} chars)
Headings: ${data.onPage?.h1s?.length || 0} H1 found
Images Missing Alt: ${data.onPage?.images?.missingAltCount || 0} of ${data.onPage?.images?.total || 0}
Schema Types: ${data.onPage?.structuredData?.types?.join(', ') || 'None'}

-- SECURITY & HEADERS --
HTTPS: ${data.crawl?.isHttps ? 'Yes' : 'No'}
HSTS: ${data.headers?.securityHeaders?.hsts ? 'Active' : 'Missing'}
CSP: ${data.headers?.securityHeaders?.csp ? 'Active' : 'Missing'}
========================================================
Generated by SeoSonar 98 | Made by Rayane Zirha · RZ™ Creative
`;
}

/**
 * Local History ("My Documents") Management
 * Opens entry directly in the Win98 Modal Dialog
 */
function saveToHistory(report) {
  try {
    const key = 'seosonar_history';
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    const domain = getDomainName(report.url);
    const filtered = existing.filter((item) => getDomainName(item.url) !== domain);

    const record = {
      url: report.url,
      domain,
      score: report.systemRating?.score || 0,
      desktopPerf: report.speed?.desktop?.performance ?? '--',
      mobilePerf: report.speed?.mobile?.performance ?? '--',
      timestamp: new Date().toLocaleDateString() + ' ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      data: report,
    };

    filtered.unshift(record);
    localStorage.setItem(key, JSON.stringify(filtered.slice(0, 15)));
    renderHistorySection();
  } catch (err) {
    console.warn('LocalStorage unavailable:', err);
  }
}

export function renderHistorySection() {
  const tbody = document.getElementById('history-table-body');
  if (!tbody) return;

  const key = 'seosonar_history';
  const history = JSON.parse(localStorage.getItem(key) || '[]');

  tbody.innerHTML = '';
  if (history.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No previous scan records located in local storage.</td></tr>';
    return;
  }

  history.forEach((item) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${escapeHtml(item.domain)}</strong></td>
      <td>${item.timestamp}</td>
      <td><span class="metric-rating ${getRatingClass(item.score)}">${item.score}/100</span></td>
      <td><span class="metric-rating ${getRatingClass(item.desktopPerf)}">${item.desktopPerf}</span></td>
      <td><span class="metric-rating ${getRatingClass(item.mobilePerf)}">${item.mobilePerf}</span></td>
      <td><button type="button" class="win-btn btn-view-hist" style="min-width: 50px; padding: 2px 6px;">View</button></td>
    `;
    const viewBtn = tr.querySelector('.btn-view-hist');
    viewBtn.onclick = () => {
      renderReport(item.data);
      openModal('modal-report', viewBtn);
    };
    tbody.appendChild(tr);
  });
}

/**
 * COMPARE MODE - Modal Popup Presentation
 * - Two separately validated URL inputs
 * - Runs in parallel through existing /api/scan endpoint with bypass_rl=1
 * - Partial failure shows warning dialog while still presenting the successful target
 * - Side-by-side table with winners highlighted per row
 * - Opens inside #modal-compare-results popup!
 */
export async function runCompare(rawUrlA, rawUrlB, triggerBtn = null) {
  const validA = validateUrl(rawUrlA);
  const validB = validateUrl(rawUrlB);

  if (!validA.ok) {
    showErrorDialog('Invalid URL A', validA.error);
    return;
  }
  if (!validB.ok) {
    showErrorDialog('Invalid URL B', validB.error);
    return;
  }

  const compStatus = document.getElementById('compare-status-text');
  if (compStatus) {
    compStatus.style.display = 'block';
    compStatus.textContent = 'Executing parallel scans for both websites...';
  }

  const fetchScan = async (url) => {
    try {
      const res = await fetch(`/api/scan?url=${encodeURIComponent(url)}&weight=1&bypass_rl=1`, {
        headers: { Accept: 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        return { ok: false, url, error: data.error || `HTTP ${res.status}` };
      }
      return { ok: true, url, data };
    } catch (e) {
      return { ok: false, url, error: e.message };
    }
  };

  const [resA, resB] = await Promise.all([
    fetchScan(validA.url),
    fetchScan(validB.url),
  ]);

  if (compStatus) compStatus.style.display = 'none';

  if (!resA.ok && !resB.ok) {
    showErrorDialog('Comparison Failed', `Both URLs failed inspection.\nSite A: ${resA.error}\nSite B: ${resB.error}`);
    return;
  }

  if (!resA.ok) {
    showErrorDialog('Site A Scan Warning', `Unable to audit Site A (${validA.url}): ${resA.error}. Displaying results for Site B.`);
  } else if (!resB.ok) {
    showErrorDialog('Site B Scan Warning', `Unable to audit Site B (${validB.url}): ${resB.error}. Displaying results for Site A.`);
  }

  // Render comparison table
  renderCompareTable(resA, resB);

  // Open the Compare Results Modal Popup!
  openModal('modal-compare-results', triggerBtn || document.getElementById('btn-submit-compare'));
}

function validateUrl(input) {
  if (!input || !input.trim()) {
    return { ok: false, error: 'URL field cannot be empty.' };
  }
  let str = input.trim();
  if (!/^https?:\/\//i.test(str)) {
    str = 'https://' + str;
  }
  try {
    const u = new URL(str);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, error: 'Protocol must be HTTP or HTTPS.' };
    }
    return { ok: true, url: u.href };
  } catch {
    return { ok: false, error: 'Invalid URL format.' };
  }
}

function renderCompareTable(resA, resB) {
  const container = document.getElementById('compare-table-wrapper');
  if (!container) return;

  const dataA = resA.ok ? resA.data : null;
  const dataB = resB.ok ? resB.data : null;

  const domA = getDomainName(resA.url);
  const domB = getDomainName(resB.url);

  const getMetric = (data, path) => {
    if (!data) return null;
    const parts = path.split('.');
    let cur = data;
    for (const p of parts) {
      if (cur === null || cur === undefined) return null;
      cur = cur[p];
    }
    return cur;
  };

  const getProbeLatency = (data, code) => {
    if (!data || !data.probes || !data.probes.probes) return null;
    const match = data.probes.probes.find((p) => p.countryCode === code);
    return match ? match.latencyMs : null;
  };

  const formatRow = (label, valA, valB, higherIsBetter, unit = '', isLabMetric = false) => {
    const keyBadge = '<span class="badge-needs-key">Speed tests unavailable</span>';
    let dispA;
    if (valA !== null && valA !== undefined) {
      dispA = `${valA}${unit}`;
    } else if (isLabMetric && (!dataA || !dataA.speed?.hasSpeedData)) {
      dispA = keyBadge;
    } else {
      dispA = '<span style="color:#cc0000;">[Failed]</span>';
    }

    let dispB;
    if (valB !== null && valB !== undefined) {
      dispB = `${valB}${unit}`;
    } else if (isLabMetric && (!dataB || !dataB.speed?.hasSpeedData)) {
      dispB = keyBadge;
    } else {
      dispB = '<span style="color:#cc0000;">[Failed]</span>';
    }

    let winA = false;
    let winB = false;

    if (valA !== null && valB !== null && typeof valA === 'number' && typeof valB === 'number') {
      if (higherIsBetter) {
        if (valA > valB) winA = true;
        else if (valB > valA) winB = true;
      } else {
        if (valA < valB) winA = true;
        else if (valB < valA) winB = true;
      }
    }

    return `
      <tr>
        <td><strong>${escapeHtml(label)}</strong></td>
        <td>${dispA} ${winA ? '<span class="winner-badge">WINNER</span>' : ''}</td>
        <td>${dispB} ${winB ? '<span class="winner-badge">WINNER</span>' : ''}</td>
      </tr>
    `;
  };

  const scoreA = dataA ? dataA.systemRating?.score : null;
  const scoreB = dataB ? dataB.systemRating?.score : null;

  const dPerfA = getMetric(dataA, 'speed.desktop.performance');
  const dPerfB = getMetric(dataB, 'speed.desktop.performance');

  const mPerfA = getMetric(dataA, 'speed.mobile.performance');
  const mPerfB = getMetric(dataB, 'speed.mobile.performance');

  const seoA = getMetric(dataA, 'speed.mobile.seo') ?? getMetric(dataA, 'speed.desktop.seo') ?? dataA?.systemRating?.breakdown?.seo?.score;
  const seoB = getMetric(dataB, 'speed.mobile.seo') ?? getMetric(dataB, 'speed.desktop.seo') ?? dataB?.systemRating?.breakdown?.seo?.score;

  const a11yA = getMetric(dataA, 'speed.mobile.accessibility') ?? getMetric(dataA, 'speed.desktop.accessibility');
  const a11yB = getMetric(dataB, 'speed.mobile.accessibility') ?? getMetric(dataB, 'speed.desktop.accessibility');

  const parseNum = (str) => {
    if (!str) return null;
    const n = parseFloat(String(str).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : n;
  };

  const lcpA = parseNum(getMetric(dataA, 'speed.desktop.cwv.lcp'));
  const lcpB = parseNum(getMetric(dataB, 'speed.desktop.cwv.lcp'));

  const clsA = parseNum(getMetric(dataA, 'speed.desktop.cwv.cls'));
  const clsB = parseNum(getMetric(dataB, 'speed.desktop.cwv.cls'));

  const tbtA = parseNum(getMetric(dataA, 'speed.desktop.cwv.tbt'));
  const tbtB = parseNum(getMetric(dataB, 'speed.desktop.cwv.tbt'));

  const fcpA = parseNum(getMetric(dataA, 'speed.desktop.cwv.fcp'));
  const fcpB = parseNum(getMetric(dataB, 'speed.desktop.cwv.fcp'));

  const siA = parseNum(getMetric(dataA, 'speed.desktop.cwv.si'));
  const siB = parseNum(getMetric(dataB, 'speed.desktop.cwv.si'));

  const usA = getProbeLatency(dataA, 'US');
  const usB = getProbeLatency(dataB, 'US');
  const deA = getProbeLatency(dataA, 'DE');
  const deB = getProbeLatency(dataB, 'DE');
  const brA = getProbeLatency(dataA, 'BR');
  const brB = getProbeLatency(dataB, 'BR');
  const jpA = getProbeLatency(dataA, 'JP');
  const jpB = getProbeLatency(dataB, 'JP');
  const maA = getProbeLatency(dataA, 'MA');
  const maB = getProbeLatency(dataB, 'MA');

  const ratingLabel = (dataA?.systemRating?.isPartial || dataB?.systemRating?.isPartial)
    ? 'System Rating (0-100, Partial)'
    : 'System Rating (0-100)';

  container.innerHTML = `
    <table class="win-table">
      <thead>
        <tr>
          <th style="width: 35%;">Metric Dimension</th>
          <th style="width: 32.5%;">${escapeHtml(domA)}</th>
          <th style="width: 32.5%;">${escapeHtml(domB)}</th>
        </tr>
      </thead>
      <tbody>
        ${formatRow(ratingLabel, scoreA, scoreB, true, ' / 100')}
        ${formatRow('Desktop (PC) Performance', dPerfA, dPerfB, true, ' / 100', true)}
        ${formatRow('Mobile Performance', mPerfA, mPerfB, true, ' / 100', true)}
        ${formatRow('SEO Score', seoA, seoB, true, ' / 100')}
        ${formatRow('Accessibility Score', a11yA, a11yB, true, ' / 100', true)}
        ${formatRow('Desktop LCP (Largest Contentful Paint)', lcpA, lcpB, false, ' s', true)}
        ${formatRow('Desktop CLS (Cumulative Layout Shift)', clsA, clsB, false, '', true)}
        ${formatRow('Desktop TBT (Total Blocking Time)', tbtA, tbtB, false, ' ms', true)}
        ${formatRow('Desktop FCP (First Contentful Paint)', fcpA, fcpB, false, ' s', true)}
        ${formatRow('Desktop SI (Speed Index)', siA, siB, false, ' s', true)}
        ${formatRow('🇺🇸 United States Latency (Probe)', usA, usB, false, ' ms')}
        ${formatRow('🇩🇪 Germany Latency (Probe)', deA, deB, false, ' ms')}
        ${formatRow('🇧🇷 Brazil Latency (Probe)', brA, brB, false, ' ms')}
        ${formatRow('🇯🇵 Japan Latency (Probe)', jpA, jpB, false, ' ms')}
        ${formatRow('🇲🇦 Morocco Latency (Probe)', maA, maB, false, ' ms')}
      </tbody>
    </table>
  `;
}

function setElementHtml(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html !== null && html !== undefined ? html : '--';
}

function setElementText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text !== null && text !== undefined ? text : '--';
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Immediate module execution (Safe whether document is loading or loaded)
function initModule() {
  const clearHistBtn = document.getElementById('btn-clear-history');
  if (clearHistBtn) {
    clearHistBtn.onclick = () => {
      localStorage.removeItem('seosonar_history');
      renderHistorySection();
    };
  }
  renderHistorySection();
  initTabs();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initModule);
} else {
  initModule();
}
