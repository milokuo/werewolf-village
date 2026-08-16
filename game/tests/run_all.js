/* 全部測試 */
const files = ['test_resources.js', 'test_roles.js', 'test_roles2.js', 'test_smoke.js', 'test_ai.js', 'test_server.js'];
const { execFileSync } = require('child_process');
const path = require('path');
let failed = 0;
for (const f of files) {
  const p = path.join(__dirname, f);
  try {
    require('fs').accessSync(p);
  } catch { continue; }
  try {
    const out = execFileSync(process.execPath, [p], { encoding: 'utf8', timeout: 300000 });
    process.stdout.write('[PASS] ' + f + '  ' + out.trim().split('\n').pop() + '\n');
  } catch (e) {
    failed++;
    process.stdout.write('[FAIL] ' + f + '\n' + (e.stdout || '') + (e.stderr || e.message) + '\n');
  }
}
process.exit(failed ? 1 : 0);
