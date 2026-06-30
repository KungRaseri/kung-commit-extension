/**
 * Pre-packaging script: computes the full version by replacing the patch
 * segment of the base semver from package.json with the total git commit
 * count, then writes it back so vsce (or any other packager) picks it up.
 *
 *   Base version:  0.2.0          (from package.json)
 *   Commit count:  11
 *   Full version:  0.2.11         (written to package.json)
 *
 * The original package.json is backed up to package.json.backup so it can be
 * restored by scripts/restore-version.js after packaging.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PKG_PATH = path.resolve(__dirname, '..', 'package.json');
const BACKUP_PATH = path.resolve(__dirname, '..', 'package.json.backup');

// ── Read current package.json ────────────────────────────────────────────────
const original = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const baseVersion = original.version;

// ── Count total commits ─────────────────────────────────────────────────────
let totalCommits;
try {
  totalCommits = execSync('git rev-list --count HEAD', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'], // suppress stderr when not in a git repo
  }).trim();
} catch {
  totalCommits = '0';
}

// Strip the patch segment from the base version (e.g., "0.2.0" → "0.2")
const baseVersionWithoutPatch = baseVersion.replace(/\.\d+$/, '');
const newVersion = `${baseVersionWithoutPatch}.${totalCommits}`;

// ── Guard: skip if backup already exists (prevents overwriting on re-run) ───
if (fs.existsSync(BACKUP_PATH)) {
  console.warn(
    `Backup already exists at ${BACKUP_PATH} — a previous package run may have been interrupted. ` +
    `Skipping backup to preserve original data.`
  );
} else {
  fs.writeFileSync(BACKUP_PATH, JSON.stringify(original, null, 2) + '\n');
  console.log(`Original package.json backed up to ${BACKUP_PATH}`);
}

// ── Write updated version ───────────────────────────────────────────────────
const updated = { ...original, version: newVersion };
fs.writeFileSync(PKG_PATH, JSON.stringify(updated, null, 2) + '\n');

console.log(`Version set: ${baseVersion} → ${newVersion}`);
