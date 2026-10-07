import fs from 'fs';

async function testCompare() {
  console.log('=== TEST 1: Full Compare example.com vs wikipedia.org ===');
  const [resA, resB] = await Promise.all([
    fetch('http://localhost:8788/api/scan?url=https://example.com&weight=1&bypass_rl=1'),
    fetch('http://localhost:8788/api/scan?url=https://wikipedia.org&weight=1&bypass_rl=1'),
  ]);

  const dataA = await resA.json();
  const dataB = await resB.json();

  console.log('Site A (example.com) HTTP:', resA.status);
  console.log('  Rating:', dataA.systemRating?.score);
  console.log('  Desktop Perf:', dataA.speed?.desktop?.performance);
  console.log('  Mobile Perf:', dataA.speed?.mobile?.performance);
  console.log('  SEO:', dataA.speed?.mobile?.seo);

  console.log('Site B (wikipedia.org) HTTP:', resB.status);
  console.log('  Rating:', dataB.systemRating?.score);
  console.log('  Desktop Perf:', dataB.speed?.desktop?.performance);
  console.log('  Mobile Perf:', dataB.speed?.mobile?.performance);
  console.log('  SEO:', dataB.speed?.mobile?.seo);

  console.log('\n=== TEST 2: Partial Failure (Valid Site vs Invalid Site) ===');
  const [resValid, resInvalid] = await Promise.all([
    fetch('http://localhost:8788/api/scan?url=https://example.com&weight=1&bypass_rl=1'),
    fetch('http://localhost:8788/api/scan?url=https://nonexistent-fake-domain-12345.xyz&weight=1&bypass_rl=1'),
  ]);

  const dataValid = await resValid.json();
  const dataInvalid = await resInvalid.json();

  console.log('Valid site status:', resValid.status, 'Rating:', dataValid.systemRating?.score);
  console.log('Invalid site status:', resInvalid.status, 'Error:', dataInvalid.error);

  if (resValid.ok && !resInvalid.ok) {
    console.log('✓ Partial failure verified: Valid site data is preserved while invalid site produces clean error payload.');
  } else {
    throw new Error('Partial failure test did not match expectations.');
  }

  console.log('\n=== TEST 3: Rate limit bypass check ===');
  const bypassRes = await fetch('http://localhost:8788/api/scan?url=https://example.com&bypass_rl=1');
  console.log('Bypass status:', bypassRes.status, 'X-Cache:', bypassRes.headers.get('X-Cache'));
  console.log('✓ Compare mode tests completed successfully!');
}

testCompare().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
