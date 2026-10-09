/**
 * SeoSonar - Core Application & Modal Window Management
 * Handles scan execution, accessible modals, sound effects, and compare dispatch.
 */

let soundEnabled = true;
let audioCtx = null;
let defragInterval = null;
let resultsEngine = null;

// Accessibility: Track active modal and last focused element for focus return
let activeModal = null;
let previousActiveElement = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function playWin98Sound(type = 'chord') {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (type === 'chord' || type === 'error') {
      const now = ctx.currentTime;
      const freqs = [261.63, 329.63, 392.00, 523.25];
      freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.65 + idx * 0.05);

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1400, now);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.7);
      });
    }
  } catch (err) {
    console.warn('Audio playback not supported:', err);
  }
}

/**
 * Accessible Modal Dialog Manager
 * - Traps Tab focus inside the dialog
 * - Closes on Escape
 * - Returns focus to triggering button on close
 */
export function openModal(modalId, triggerElement = null) {
  const modalEl = document.getElementById(modalId);
  if (!modalEl) return;

  previousActiveElement = triggerElement || document.activeElement;
  activeModal = modalEl;

  modalEl.classList.add('active');

  // Move focus to first focusable element inside modal (e.g. first tab or close button)
  const focusables = getFocusableElements(modalEl);
  if (focusables.length > 0) {
    focusables[0].focus();
  }
}

export function closeModal(modalId) {
  const modalEl = document.getElementById(modalId);
  if (!modalEl) return;

  modalEl.classList.remove('active');
  if (activeModal === modalEl) activeModal = null;

  // Restore focus to original trigger element (e.g. Scan button)
  if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
    previousActiveElement.focus();
    previousActiveElement = null;
  }
}

function getFocusableElements(container) {
  const selector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(selector)).filter((el) => {
    return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
  });
}

// Global Modal Keyboard Event Handling (Escape & Focus Trap)
document.addEventListener('keydown', (e) => {
  if (!activeModal) return;

  // Escape closes current modal
  if (e.key === 'Escape') {
    e.preventDefault();
    closeModal(activeModal.id);
    return;
  }

  // Focus trap on Tab
  if (e.key === 'Tab') {
    const focusables = getFocusableElements(activeModal);
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }
});

export function showErrorDialog(title, message) {
  const errWin = document.getElementById('win-error');
  if (!errWin) {
    alert(`${title}: ${message}`);
    return;
  }

  document.getElementById('error-title').textContent = title || 'Error';
  document.getElementById('error-message').textContent = message || 'An unexpected error occurred.';

  playWin98Sound('error');
  openModal('win-error');
}

export function initDefragGrid() {
  const grid = document.getElementById('defrag-grid');
  if (!grid || grid.children.length > 0) return;

  for (let i = 0; i < 84; i++) {
    const cluster = document.createElement('div');
    cluster.className = 'cluster';
    cluster.id = `cluster-${i}`;
    grid.appendChild(cluster);
  }
}

export function startDefragAnimation() {
  initDefragGrid();
  const clusters = document.querySelectorAll('.cluster');
  clusters.forEach((c) => {
    c.className = 'cluster';
  });

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let currentIdx = 0;

  const statusSteps = [
    'Connecting to distributed probe network (US, DE, BR, JP, MA)...',
    'Executing Desktop speed tests and lab data audit...',
    'Executing Mobile speed tests and lab data audit...',
    'Inspecting HTML headings, canonical tags, and Open Graph...',
    'Auditing HTTP compression and Strict-Transport-Security...',
    'Defragmenting SEO index and compiling System Rating...',
  ];
  let stepIdx = 0;
  const statusEl = document.getElementById('defrag-status-text');

  if (defragInterval) clearInterval(defragInterval);

  if (prefersReducedMotion) {
    if (statusEl) statusEl.textContent = 'Analyzing website performance and SEO metrics...';
    return;
  }

  defragInterval = setInterval(() => {
    if (clusters.length === 0) return;

    const prev = clusters[currentIdx];
    if (prev) {
      prev.classList.remove('active');
      const rand = Math.random();
      if (rand > 0.85) {
        prev.classList.add('bad');
      } else if (rand > 0.25) {
        prev.classList.add('optimized');
      } else {
        prev.classList.add('allocated');
      }
    }

    currentIdx = (currentIdx + 1) % clusters.length;
    const cur = clusters[currentIdx];
    if (cur) cur.classList.add('active');

    if (currentIdx % 14 === 0) {
      stepIdx = (stepIdx + 1) % statusSteps.length;
      if (statusEl) statusEl.textContent = statusSteps[stepIdx];
    }
  }, 75);
}

export function stopDefragAnimation() {
  if (defragInterval) {
    clearInterval(defragInterval);
    defragInterval = null;
  }
}

export async function loadResultsEngine() {
  if (!resultsEngine) {
    resultsEngine = await import('./results.js?v=2.3.1');
  }
  return resultsEngine;
}

export function normalizeUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export async function executeScan(url, triggerBtn = null) {
  const targetUrl = normalizeUrl(url);
  if (!targetUrl) return;

  const defragSec = document.getElementById('defrag-section');
  if (defragSec) {
    defragSec.style.display = 'block';
    defragSec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  startDefragAnimation();

  try {
    const [engine, response] = await Promise.all([
      loadResultsEngine(),
      fetch(`/api/scan?url=${encodeURIComponent(targetUrl)}&bypass_rl=1`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      }),
    ]);

    const data = await response.json();
    stopDefragAnimation();
    if (defragSec) defragSec.style.display = 'none';

    if (!response.ok || data.error) {
      if (response.status === 429 || data.code === 'QUOTA_EXCEEDED') {
        showErrorDialog('Daily Quota Exceeded', 'The daily speed test quota has been reached. Please try again later.');
      } else if (response.status === 400 || response.status === 403 || data.code === 'KEY_INVALID') {
        showErrorDialog('Service Notice', 'Speed test service is currently unavailable. Please try again later.');
      } else {
        showErrorDialog('Scan Failed', data.error || 'Unable to scan target website.');
      }
      return;
    }

    // Render report and open accessible modal popup
    engine.renderReport(data);
    openModal('modal-report', triggerBtn || document.getElementById('btn-submit-scan'));

    // Enable "Reopen last report" button under URL input
    const reopenScan = document.getElementById('reopen-container');
    if (reopenScan) reopenScan.style.display = 'block';
  } catch (err) {
    stopDefragAnimation();
    if (defragSec) defragSec.style.display = 'none';
    showErrorDialog('Connection Error', `Failed to communicate with scanner service: ${err.message}`);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Win98 Start Menu toggle & accessibility
  const startBtn = document.getElementById('footer-start-btn');
  const startMenu = document.getElementById('start-menu');
  if (startBtn && startMenu) {
    startBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isExpanded = startMenu.classList.toggle('active');
      startBtn.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      if (!startMenu.contains(e.target) && e.target !== startBtn) {
        startMenu.classList.remove('active');
        startBtn.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && startMenu.classList.contains('active')) {
        startMenu.classList.remove('active');
        startBtn.setAttribute('aria-expanded', 'false');
        startBtn.focus();
      }
    });

    startMenu.querySelectorAll('.start-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        startMenu.classList.remove('active');
        startBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // Clock in footer
  const clockEl = document.getElementById('footer-clock');
  function updateClock() {
    if (clockEl) {
      const now = new Date();
      clockEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  updateClock();
  setInterval(updateClock, 1000);

  // Scan form submit
  const scanForm = document.getElementById('scanner-form');
  const scanInput = document.getElementById('scan-url-input');
  if (scanForm && scanInput) {
    scanForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const url = scanInput.value.trim();
      if (!url) return;
      executeScan(url, document.getElementById('btn-submit-scan'));
    });
  }

  // Compare form submit (Attached immediately on page load!)
  const compareForm = document.getElementById('compare-form');
  if (compareForm) {
    compareForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const urlA = document.getElementById('compare-url-a')?.value.trim();
      const urlB = document.getElementById('compare-url-b')?.value.trim();
      const compBtn = document.getElementById('btn-submit-compare');

      const engine = await loadResultsEngine();
      engine.runCompare(urlA, urlB, compBtn);
    });
  }

  // Reopen Last Report button (Single button under URL input)
  const reopenScan = document.getElementById('btn-reopen-scan');
  const handleReopen = async (btn) => {
    const engine = await loadResultsEngine();
    if (engine.hasLastReport && engine.hasLastReport()) {
      openModal('modal-report', btn);
    } else {
      showErrorDialog('No Report Available', 'No previous audit report is currently available to display.');
    }
  };
  if (reopenScan) reopenScan.addEventListener('click', () => handleReopen(reopenScan));

  // Modal Close buttons
  document.querySelectorAll('[data-action="close-report"]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal('modal-report'));
  });

  document.querySelectorAll('[data-action="close-compare"]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal('modal-compare-results'));
  });

  document.querySelectorAll('[data-action="close-error"]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal('win-error'));
  });
});
