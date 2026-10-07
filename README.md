<div align="center">

```
  ____                 ____                              ___   ___  
 / ___|  ___  ___     / ___|  ___  _ __   __ _ _ __     / _ \ ( _ ) 
 \___ \ / _ \/ _ \    \___ \ / _ \| '_ \ / _` | '__|   | (_) |/ _ \ 
  ___) |  __/ (_) |    ___) | (_) | | | | (_| | |       \__, | (_) |
 |____/ \___|\___/____|____/ \___/|_| |_|\__,_|_|         /_/ \___/ 
                |_____|                                              
```

# 🌐 SeoSonar 98

### *Free retro Windows 98-styled SEO checker, pinged from around the world.*

[![Live Demo](https://img.shields.io/badge/Live%20Demo-seosonar.rayane.top-000080?style=for-the-badge&logo=cloudflare&logoColor=white)](https://seosonar.rayane.top)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers%20%2B%20Assets-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Pure Vanilla](https://img.shields.io/badge/Stack-Vanilla%20HTML%20%2B%20CSS%20%2B%20JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org)
[![Lighthouse 100](https://img.shields.io/badge/Lighthouse-100%2F100%20Audit-00C48C?style=for-the-badge&logo=lighthouse&logoColor=white)](https://seosonar.rayane.top)

<br/>

[**Explore Live Website »**](https://seosonar.rayane.top)

</div>

---

## 🕹️ About SeoSonar 98

**SeoSonar 98** brings authentic Microsoft Windows 98 desktop nostalgia to modern web diagnostics. It is an ultra-fast, zero-framework website auditor designed for technical SEOs, webmasters, and developers who value transparency, brutalist aesthetics, and raw edge speed.

Enter any target URL and watch real-time disk-defragmentation progress blocks light up as parallel audits scan server headers, on-page technical factors, Core Web Vitals lab data, and latency across 5 continents.

---

## 🌟 Key Features

### 🖥️ Authentic Win98 Experience
- **Pixel-Snapped Retro Desktop:** Classic teal desktop (`#008080`), authentic 3D beveled windows, functional title-bar minimize/close controls, and sound toggles.
- **Taskbar & Start Menu:** Live system tray clock, active task switching, and direct author links.
- **Defrag-Style Scan Animation:** Real-time visual disk-defrag animation with dynamic audit progress updates.
- **Accessible Window Popups:** Centered tabbed report popup with full keyboard navigation (Tab lock, Esc to close, Arrow keys for tabs).
- **"My Documents" Local History:** Stores recent audits in `localStorage` for one-click re-inspection.

### 📊 Transparent 4-Factor System Rating (0–100)
A balanced diagnostic score computed with mathematical transparency:
- ⚡ **Performance (35%):** Average of Desktop PC and Mobile Core Web Vitals.
- 🎯 **On-Page Technical SEO (35%):** Title (30-60 chars), meta description (120-160 chars), single H1 tag, canonical validity, mobile viewport, lang attribute, schema.org detection.
- ♿ **Accessibility (15%):** Color contrast ratios, image `alt` attributes, aria labels, and form label associations.
- 🛡️ **Web Best Practices (15%):** HTTPS enforcement, modern compression (Brotli/Gzip), HSTS, CSP, and X-Content-Type security headers.
- 🌍 **Country Probe Latency Penalty:** Deductions (up to 15 points) if remote probes exceed 1500 ms or return unreachable statuses.

### 🌐 5-Continent Global Latency Probes
Real-time distributed HTTP latency measurements across 5 strategic global nodes:
- 🇺🇸 **North America:** United States (US)
- 🇩🇪 **Europe:** Germany (DE)
- 🇧🇷 **South America:** Brazil (BR)
- 🇯🇵 **Asia-Pacific:** Japan (JP)
- 🇲🇦 **Africa:** Morocco (MA)

### 🥊 Compare Mode
Enter two competing URLs side by side to compare performance scores, Core Web Vitals metrics, and regional response times with instant winner highlights.

### 🖨️ Retro Export & Print
- **One-Click Plain Text Copy:** Monospaced ASCII summary formatted for terminal sharing.
- **Dedicated Print Stylesheet:** `@media print` layout styled like a dot-matrix / retro continuous paper audit log.

---

## 🏗️ Architecture & Stack

```
SeoSonar/
├── public/                 # Static Assets (Served directly via Cloudflare Assets)
│   ├── css/win98.css       # Pruned authentic Windows 98 stylesheet
│   ├── js/app.js           # Main UI, modals, sound effects, defrag animation
│   ├── js/results.js       # Report engine, compare mode & history manager
│   ├── index.html          # Semantic HTML5 with JSON-LD FAQ/WebSite schemas
│   ├── 404.html            # Retro Blue Screen of Death (BSOD) 404 page
│   ├── robots.txt          # Root crawl directives
│   └── sitemap.xml         # XML Sitemap index
├── src/
│   └── worker.js           # Cloudflare Worker API router (/api/scan)
├── scripts/
│   ├── set-url.mjs         # Single-source canonical URL manager
│   └── process-icons.py    # Pixel-art icon processor
├── wrangler.jsonc          # Cloudflare Worker + Assets + KV configuration
└── package.json            # Scripts & dependencies
```

- **Frontend:** Plain HTML5, Vanilla CSS, Vanilla ES Modules. **Zero client-side dependencies / 0 KB framework overhead.**
- **Backend:** Cloudflare Workers with Static Assets (`src/worker.js`).
- **Caching & Rate Limiting:** Cloudflare KV (`SEOSONAR_KV`):
  - Per-IP rate limiting (15 scans/hr).
  - 20-minute whole-report and strategy-level caching.
  - 7-day stale backup fallback.
  - Global daily usage counter with graceful degradations (Desktop-only at 90%, partial rating at 100%).
- **Security:** Strict SSRF protection (DNS-over-HTTPS resolution, loopback/private/metadata IP blocking, redirect limits, 2MB payload caps).

---

## 🚀 Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/zirharayane/SeoSonar.git
cd SeoSonar
npm install
```

### 2. Local Development
Create `.dev.vars` in the repository root:
```bash
PAGESPEED_API_KEY="your_api_key_here"
```

Start the local server with simulated KV and static assets:
```bash
npm run dev
```
Open `http://localhost:8788/` in your browser.

---

## ☁️ Cloudflare Deployment

### 1. Deploy via Wrangler CLI

```bash
# 1. Authenticate with Cloudflare
npx wrangler login

# 2. Create your production KV namespace
npx wrangler kv namespace create SEOSONAR_KV

# 3. Add your secret key
npx wrangler secret put PAGESPEED_API_KEY --name seosonar

# 4. Deploy
npm run deploy
```

### 2. Configure Custom Domain

```bash
# Update canonical tags, sitemap, and headers:
npm run set-url -- https://seosonar.rayane.top
npm run deploy
```

---

## 📄 License & Credits

Built with ❤️ by **[Rayane Zirha](https://rayane.top)** (RZ™ Creative).

- Inspired by classic **Microsoft Windows 98**.
- Dedicated to technical SEOs who appreciate retro software and blistering web performance.
