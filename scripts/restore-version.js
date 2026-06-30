/**
 * Post-packaging script: restores the original package.json from the backup
 * created by scripts/set-version.js. This ensures the source tree is left
 * in its original state after packaging.
 */

const fs = require('fs');
const path = require('path');

const PKG_PATH = path.resolve(__dirname, '..', 'package.json');
const BACKUP_PATH = path.resolve(__dirname, '..', 'package.json.backup');

if (!fs.existsSync(BACKUP_PATH)) {
  console.warn(`No backup found at ${BACKUP_PATH} — nothing to restore.`);
  process.exit(0);
}

// Restore original
fs.copyFileSync(BACKUP_PATH, PKG_PATH);
fs.unlinkSync(BACKUP_PATH);

const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
console.log(`Version restored to: ${pkg.version}`);
