/* Rewrites the version stamps to a fresh timestamp on every deploy so installed
 * PWAs refresh their cache:
 *   - sw.js        -> const VERSION   (cache key)
 *   - index.html   -> const APP_BUILD (visible Build stamp on the dashboard)
 * Both are kept in sync. Invoked by the pre-commit hook; safe to run manually. */
const fs = require('fs');
const join = require('path').join;

const n = new Date();
const p = (x) => String(x).padStart(2, '0');
const version = `v${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}-${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;

function stamp(file, re, replacement) {
  const path = join(__dirname, '..', file);
  let s;
  try { s = fs.readFileSync(path, 'utf8'); } catch { return; }
  if (re.test(s)) {
    fs.writeFileSync(path, s.replace(re, replacement));
    console.log(`[bump] ${file} -> ${version}`);
  }
}

stamp('sw.js',      /const VERSION\s*=\s*'[^']*';/,   `const VERSION = '${version}';`);
stamp('index.html', /const APP_BUILD\s*=\s*'[^']*';/, `const APP_BUILD = '${version}';`);
