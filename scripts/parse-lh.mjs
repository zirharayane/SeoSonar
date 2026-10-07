import fs from 'fs';

const files = fs.readdirSync('.').filter(f => f.endsWith('.report.html'));
if (files.length === 0) {
  console.log('No report files found.');
  process.exit(1);
}

const latest = files[files.length - 1];
console.log('Reading report:', latest);
const content = fs.readFileSync(latest, 'utf8');

const match = content.match(/window\.__LIGHTHOUSE_JSON__\s*=\s*(\{[\s\S]*?\});/);
if (match) {
  const data = JSON.parse(match[1]);
  console.log('\n==========================================');
  console.log('       OFFICIAL LIGHTHOUSE AUDIT SCORES');
  console.log('==========================================');
  for (const [k, v] of Object.entries(data.categories)) {
    console.log(`  ${v.title.padEnd(20)}: ${Math.round(v.score * 100)} / 100`);
  }
  console.log('==========================================\n');
  if (data.audits) {
    const lcp = data.audits['largest-contentful-paint'];
    const cls = data.audits['cumulative-layout-shift'];
    const tbt = data.audits['total-blocking-time'];
    const fcp = data.audits['first-contentful-paint'];
    console.log('CORE WEB VITALS:');
    console.log(`  LCP: ${lcp?.displayValue}`);
    console.log(`  CLS: ${cls?.displayValue}`);
    console.log(`  TBT: ${tbt?.displayValue}`);
    console.log(`  FCP: ${fcp?.displayValue}`);
  }
} else {
  console.log('Could not locate JSON in report.');
}
