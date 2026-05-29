import { readFileSync } from 'node:fs';

const reportPath = process.argv[2] ?? 'test-results/playwright-results.json';
const slowTestLimit = Number(process.env.PLAYWRIGHT_TIMING_LIMIT ?? 20);

let report;
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.warn(`No Playwright JSON timing report found at ${reportPath}: ${detail}`);
  process.exit(0);
}

const records = [];

function collectSuite(suite, parents = []) {
  const nextParents = suite.title ? [...parents, suite.title] : parents;

  for (const child of suite.suites ?? []) {
    collectSuite(child, nextParents);
  }

  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        records.push({
          file: spec.file ?? nextParents[0] ?? 'unknown',
          title: [...nextParents, spec.title].filter(Boolean).join(' › '),
          durationMs: result.duration ?? 0,
          status: result.status ?? 'unknown'
        });
      }
    }
  }
}

for (const suite of report.suites ?? []) {
  collectSuite(suite);
}

const specTotals = new Map();
for (const record of records) {
  const previous = specTotals.get(record.file) ?? { count: 0, durationMs: 0 };
  previous.count += 1;
  previous.durationMs += record.durationMs;
  specTotals.set(record.file, previous);
}

const formatSeconds = (durationMs) => `${(durationMs / 1000).toFixed(1)}s`;
const stats = report.stats ?? {};

console.log('Playwright timing summary');
console.log(`Total: ${formatSeconds(stats.duration ?? records.reduce((sum, record) => sum + record.durationMs, 0))}`);
console.log(`Expected: ${stats.expected ?? 'n/a'}  Unexpected: ${stats.unexpected ?? 'n/a'}  Flaky: ${stats.flaky ?? 'n/a'}`);

console.log('\nSlowest spec files');
for (const [file, total] of [...specTotals.entries()].sort((a, b) => b[1].durationMs - a[1].durationMs)) {
  console.log(`${formatSeconds(total.durationMs).padStart(7)}  ${String(total.count).padStart(3)} tests  ${file}`);
}

console.log(`\nSlowest ${slowTestLimit} tests`);
for (const record of records
  .slice()
  .sort((a, b) => b.durationMs - a.durationMs)
  .slice(0, slowTestLimit)) {
  console.log(`${formatSeconds(record.durationMs).padStart(7)}  ${record.status.padEnd(8)}  ${record.title}`);
}
