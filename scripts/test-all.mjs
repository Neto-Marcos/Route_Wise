import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const files = (await readdir('tests', { recursive: true }))
  .filter(file => /\.test\.(mjs|ts)$/.test(file))
  .sort().map(file => 'tests/' + file);
if (!files.length) throw new Error('No test files discovered');
console.log('Running all ' + files.length + ' test files (serial: database snapshots must not overlap API fixtures).');
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=tap', ...files], {
  stdio: ['inherit', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', data => output += data);
child.stderr.on('data', data => process.stderr.write(data));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', code => {
  const skipped = output.match(/^# skipped (\d+)$/m);
  const summary = output.split('\n').filter(line => /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) /.test(line)).join('\n');
  if (code !== 0 || !skipped || Number(skipped[1]) > 0) {
    process.stdout.write(output);
    console.error('Full-suite gate FAIL (failures, missing summary, or skipped tests).');
    process.exitCode = code || 1;
  } else {
    console.log(summary);
    console.log('Full-suite gate PASS: zero failures, zero skips.');
  }
});
