#!/usr/bin/env node
// Manual local installation only. Never fetches upstream source or runs package scripts.
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') throw new Error('This reviewed installation requires macOS Keychain.');
const revision = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const dirty = execFileSync('/usr/bin/git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, encoding: 'utf8' }).trim();
if (dirty) throw new Error('Commit the reviewed source before installing.');
const base = join(homedir(), '.local', 'share', 'yomi-reviewed');
const release = join(base, 'releases', revision);
mkdirSync(dirname(release), { recursive: true, mode: 0o700 });
mkdirSync(release, { mode: 0o700 }); // Existing pinned installations are never overwritten.
cpSync(join(repo, 'dist'), join(release, 'dist'), { recursive: true });
for (const name of ['package.json', 'package-lock.json']) cpSync(join(repo, 'reviewed-runtime', name), join(release, name));
for (const name of ['PRIVACY.md', 'LICENSE', 'NOTICE']) cpSync(join(repo, name), join(release, name));
execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: release, stdio: 'inherit' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const entries = {};
function walk(path, prefix = '') {
  for (const name of readdirSync(path).sort()) {
    const file = join(path, name), key = prefix + name, stat = lstatSync(file);
    if (stat.isSymbolicLink()) {
      if (!realpathSync(file).startsWith(release + '/')) throw new Error('External symlink in runtime');
      entries[key] = { link: readlinkSync(file) };
    } else if (stat.isDirectory()) walk(file, key + '/');
    else if (stat.isFile()) entries[key] = { sha256: sha(readFileSync(file)) };
    else throw new Error('Unexpected runtime file type');
  }
}
walk(release);
const manifest = JSON.stringify({ revision, entries }, null, 2) + '\n';
writeFileSync(join(release, 'reviewed-integrity.json'), manifest, { mode: 0o600 });
const template = readFileSync(join(repo, 'scripts', 'reviewed-launcher.template.mjs'), 'utf8');
const launcher = template.replace('__RELEASE_PATH__', JSON.stringify(release)).replace('__MANIFEST_SHA256__', JSON.stringify(sha(manifest)));
const launcherPath = join(base, 'launch.mjs');
writeFileSync(launcherPath, launcher, { mode: 0o600 });
console.log(JSON.stringify({ revision, release, launcherPath, manifestSha256: sha(manifest), files: Object.keys(entries).length }));
