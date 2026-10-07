# SeoSonar 98

> Free retro Windows 98-styled SEO checker, pinged from around the world.  
> Created by **Rayane Zirha (Zirha Rayane)** &mdash; [rayane.top](https://rayane.top)

[![Live Demo](https://img.shields.io/badge/Live%20Demo-seosonar.rayane.top-000080?style=flat-square&logo=cloudflare&logoColor=white)](https://seosonar.rayane.top)
[![Author](https://img.shields.io/badge/Author-Rayane%20Zirha%20(Zirha%20Rayane)-008080?style=flat-square)](https://rayane.top)
[![Platform](https://img.shields.io/badge/Platform-Cloudflare%20Workers%20%2B%20Assets-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Tech Stack](https://img.shields.io/badge/Stack-Vanilla%20HTML%20%2B%20CSS%20%2B%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](https://developer.mozilla.org)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

---

## Overview

**SeoSonar 98** is a zero-framework, edge-accelerated website diagnostic tool pairing authentic Windows 98 desktop ergonomics with modern technical SEO and network auditing.

Built by **Rayane Zirha (Zirha Rayane)**, SeoSonar inspects real-world website performance, Core Web Vitals lab data, technical crawl configurations, and global HTTP response latency across 5 continents in parallel.

### Live Deployments & Author Links
- **Production URL:** [https://seosonar.rayane.top](https://seosonar.rayane.top)
- **Author Portfolio:** [https://rayane.top](https://rayane.top)
- **GitHub Profile:** [https://github.com/zirharayane](https://github.com/zirharayane)
- **Companion Project (PortHole 98):** [https://porthole.rayane.top](https://porthole.rayane.top)

---

## Core Capabilities

### 1. Dual Viewport Core Web Vitals
- Evaluates Desktop PC (1920x1080) and Mobile (360x640) rendering side-by-side.
- Measures Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), Total Blocking Time (TBT), First Contentful Paint (FCP), and Speed Index (SI).
- Displays real-user field data from Chrome UX Report (CrUX) when domain volume qualifies.

### 2. 5-Continent Global Latency Probes
Issues concurrent real-time HTTP probes from distributed edge endpoints:
- **North America:** United States (`us-east.seosonar.net`)
- **Europe:** Germany (`eu-central.seosonar.net`)
- **South America:** Brazil (`sa-east.seosonar.net`)
- **Asia-Pacific:** Japan (`ap-northeast.seosonar.net`)
- **Africa:** Morocco (`af-north.seosonar.net`)

### 3. Technical On-Page SEO Inspection
- **Title Tag:** Character length check (optimal: 30–60 characters).
- **Meta Description:** Character length check (optimal: 120–160 characters).
- **H1 Hierarchy:** Enforces single primary heading standard.
- **Canonical URL:** Validates canonical link target against resolved URL.
- **Mobile Viewport:** Checks for proper responsive tag configuration.
- **Structured Data:** Detects and parses JSON-LD schemas (`Organization`, `WebSite`, `Article`, `Product`, `FAQPage`).
- **Images:** Computes total image count and flags missing `alt` attributes.

### 4. Directives & HTTP Security Headers
- Discovers and validates `robots.txt` and XML sitemap availability.
- Evaluates HTTPS enforcement and redirect count.
- Analyzes security response headers: `Strict-Transport-Security` (HSTS), `Content-Security-Policy` (CSP), `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`.
- Detects modern HTTP compression encoding (`br`, `gzip`, `zstd`).

### 5. Side-by-Side Comparison Engine
- Runs concurrent audits on two target URLs.
- Highlights winners for each category (System Rating, Core Web Vitals, payload size, and continental probe latency).

### 6. Local Audit History & Plain-Text Export
- Stores recent audit records privately in browser `localStorage`.
- Formats complete diagnostic results as plain-text ASCII reports or printer-ready audit logs.

---

## System Rating Formula

The 0–100 composite System Rating is computed using a transparent weighted formula:

| Dimension | Weight | Description |
| :--- | :--- | :--- |
| **Performance** | 35% | Weighted average of Desktop and Mobile Core Web Vitals lab scores |
| **On-Page SEO** | 35% | Technical compliance across title, description, H1, canonical, and schemas |
| **Accessibility** | 15% | Basic a11y checks including image alt tags and lang attribute |
| **Best Practices** | 15% | HTTPS enforcement, compression, and security response headers |

*Note: Up to 15 penalty points are deducted if global probes encounter response times exceeding 1,500 ms or return non-200 HTTP statuses.*

---

## Technical Architecture

```
SeoSonar/
├── public/                 # Static frontend assets (Cloudflare Workers Assets)
│   ├── assets/             # Pixel-art icons and WebP illustrations
│   ├── css/win98.css       # Authentic Windows 98 design system
│   ├── js/app.js           # Main UI controller, audio effects, defrag animation
│   ├── js/results.js       # Report engine, comparison suite, local history
│   ├── index.html          # Semantic HTML5, WebP Open Graph, JSON-LD Schema
│   ├── 404.html            # Windows BSOD 404 error page
│   ├── robots.txt          # Root crawl directives
│   └── sitemap.xml         # XML sitemap index
├── src/
│   └── worker.js           # Cloudflare Worker API router (/api/scan)
├── scripts/
│   └── set-url.mjs         # Production URL synchronizer
├── wrangler.jsonc          # Cloudflare Worker + Assets + KV configuration
└── package.json            # Scripts & project metadata
```

### Zero-Framework Architecture
- **Frontend:** Pure HTML5, Vanilla CSS, and native ES Modules. Zero runtime build tools, zero dependencies, and 0 KB client framework payload.
- **Backend:** Cloudflare Workers running on V8 isolates at the edge.
- **Caching & Tiered Storage:** Cloudflare KV (`SEOSONAR_KV`):
  - 20-minute scan response cache.
  - Per-IP rate limiting (15 scans/hour).
  - 7-day stale fallback cache for external API outages.
- **SSRF Defense Firewall:** Hostname resolution through DNS-over-HTTPS with immediate rejection of loopback (`127.0.0.0/8`), private (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.0.0/16`), and cloud metadata IP ranges.

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm or pnpm
- Cloudflare Wrangler CLI (`npm i -g wrangler`)

### 1. Installation
```bash
git clone https://github.com/zirharayane/SeoSonar.git
cd SeoSonar
npm install
```

### 2. Configure Local Environment
Create a `.dev.vars` file in the project root:
```ini
PAGESPEED_API_KEY="your_google_pagespeed_api_key"
```

### 3. Local Development
```bash
npm run dev
```
Navigate to `http://localhost:8788` to view the local server with simulated Cloudflare KV.

---

## Deployment

Deploy directly to Cloudflare Workers using Wrangler:

```bash
# 1. Log in to Cloudflare
npx wrangler login

# 2. Bind production KV namespace (if not already provisioned)
npx wrangler kv namespace create SEOSONAR_KV

# 3. Add PageSpeed secret key
npx wrangler secret put PAGESPEED_API_KEY --name seosonar

# 4. Deploy assets and worker
npm run deploy
```

---

## Author & Attribution

- **Creator:** Rayane Zirha (Zirha Rayane)
- **Website:** [https://rayane.top](https://rayane.top)
- **GitHub:** [@zirharayane](https://github.com/zirharayane)
- **Brand:** RZ™ Creative

SeoSonar is open-source software licensed under the [MIT License](LICENSE).
