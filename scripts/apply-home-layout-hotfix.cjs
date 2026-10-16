// Applies only presentation changes to the existing published Next.js artifact.
// The production source for release 1a5701b is unavailable; preserve its backend.
const fs = require('node:fs');
const path = require('node:path');
const version = 'home-layout-20261015';
const css = `
/* ${version}: bounded spacing inside a full-width access column */
.home { grid-template-columns: minmax(0, 1.08fr) minmax(0, .92fr) !important; }
.home > .home-copy { min-width: 0; padding: 46px clamp(24px, 5vw, 96px) 38px; gap: 32px; }
.home > .access-panel { width: auto !important; max-width: none !important; min-width: 0; padding: clamp(28px, 4vw, 64px) !important; gap: 0 !important; }
.home > .access-panel > * { width: 100%; max-width: 560px; margin-inline: auto !important; }
.home .access-card { grid-template-columns: 58px minmax(0, 1fr) 22px; margin-bottom: 12px; }
.home .access-card > span:nth-child(2) { min-width: 0; }
.home .access-head { margin-bottom: 12px; }
@media (max-width: 900px) {
  .home { display: block !important; }
  .home > .home-copy { min-height: 0 !important; padding: 28px 24px !important; }
  .home-copy h1 { font-size: clamp(34px, 6vw, 54px); line-height: 1.06; }
  .home-copy > small { display: none; }
  .home > .access-panel { min-height: 0; padding: 28px 24px 40px !important; }
}
@media (max-width: 600px) {
  .home > .home-copy { padding: 24px 20px !important; }
  .home-copy h1 { font-size: clamp(32px, 9vw, 42px) !important; line-height: 1.08; }
  .home > .access-panel { padding: 24px 16px 36px !important; border-radius: 24px 24px 0 0; }
  .home .access-card { grid-template-columns: 44px minmax(0, 1fr) 18px; gap: 12px; }
  .home .access-icon { width: 44px; height: 44px; }
  .home .access-head h2 { font-size: clamp(24px, 7vw, 30px); }
}
`;

function apply(root = process.cwd()) {
  const dist = path.join(root, process.env.NEXT_DIST_DIR || '.next');
  const htmlFile = path.join(dist, 'server/app/index.html');
  const html = fs.readFileSync(htmlFile, 'utf8');
  if (html.includes(version + '.css')) return { changed: false, version };
  const files = [...html.matchAll(/href="\/_next\/static\/css\/([^"?]+\.css)(?:\?[^"\s]*)?"/g)];
  if (!files.length) throw new Error('No root CSS found; refusing to change the published artifact.');
  const original = files[files.length - 1][1];
  if (path.basename(original) !== original) throw new Error('Unexpected CSS path');
  const modified = original.replace(/\.css$/, '.' + version + '.css');
  const cssDir = path.join(dist, 'static/css');
  fs.writeFileSync(path.join(cssDir, modified), fs.readFileSync(path.join(cssDir, original), 'utf8') + css);
  const backupDir = path.join(dist, 'ui-hotfix-backups', version);
  fs.mkdirSync(backupDir, { recursive: true });
  // Update the HTML and its RSC representation together, including bootstrap data.
  // Never overwrite content-addressed assets or remove older assets from caches.
  for (const name of ['index.rsc', 'index.html']) {
    const file = path.join(dist, 'server/app', name);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    const backup = path.join(backupDir, name);
    if (!fs.existsSync(backup)) fs.writeFileSync(backup, content);
    fs.writeFileSync(file + '.hotfix-tmp', content.replaceAll(original, modified));
    fs.renameSync(file + '.hotfix-tmp', file);
  }
  return { changed: true, version, css: modified };
}

module.exports = { apply, css, version };
if (require.main === module) console.log(JSON.stringify(apply()));
