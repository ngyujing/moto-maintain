/* Rewrites the VERSION constant in sw.js to a fresh timestamp.
 * Invoked by the pre-commit hook so every deploy gets a unique service-worker
 * version and installed PWAs refresh their cache. Safe to run manually too. */
const fs = require('fs');
const path = require('path').join(__dirname, '..', 'sw.js');

let s;
try { s = fs.readFileSync(path, 'utf8'); } catch { process.exit(0); }

const n = new Date();
const p = (x) => String(x).padStart(2, '0');
const version = `v${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;

const re = /const VERSION\s*=\s*'[^']*';/;
if (re.test(s)) {
  s = s.replace(re, `const VERSION = '${version}';`);
  fs.writeFileSync(path, s);
  console.log('[bump] sw.js VERSION ->', version);
}
