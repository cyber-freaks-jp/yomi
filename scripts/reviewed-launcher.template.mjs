// Installed from a reviewed commit. No npm/npx, git pull, downloads or auto-update.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, readlinkSync, mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
const release = __RELEASE_PATH__;
const expectedManifest = __MANIFEST_SHA256__;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifestBytes = readFileSync(join(release, 'reviewed-integrity.json'));
if (sha(manifestBytes) !== expectedManifest) throw new Error('Yomi manifest changed. Manual review is required.');
const manifest = JSON.parse(manifestBytes);
const seen = new Set();
function verify(path, prefix = '') {
  for (const name of readdirSync(path).sort()) {
    const key = prefix + name;
    if (key === 'reviewed-integrity.json') continue;
    const file = join(path, name), stat = lstatSync(file);
    if (stat.isDirectory()) { verify(file, key + '/'); continue; }
    const expected = manifest.entries[key];
    if (!expected) throw new Error(`Unreviewed runtime file: ${key}`);
    if (stat.isSymbolicLink()) {
      if (expected.link !== readlinkSync(file)) throw new Error(`Changed symlink: ${key}`);
    } else if (!stat.isFile() || expected.sha256 !== sha(readFileSync(file))) {
      throw new Error(`Yomi integrity check failed: ${key}`);
    }
    seen.add(key);
  }
}
verify(release);
if (seen.size !== Object.keys(manifest.entries).length) throw new Error('Reviewed runtime file is missing.');
if (process.argv.includes('--verify-only')) {
  console.log(JSON.stringify({ verified: true, revision: manifest.revision, files: seen.size }));
} else {
  const smoke = process.argv.includes('--smoke');
  const env = { HOME: homedir(), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: process.env.LANG || 'en_US.UTF-8',
    YOMI_DATA_DIR: smoke ? mkdtempSync(join(tmpdir(), 'yomi-reviewed-smoke-')) : join(homedir(), 'Library', 'Application Support', 'yomi-reviewed'),
    YOMI_NO_UPDATE_CHECK: '1',
  };
  if (smoke) env.YOMI_NO_KEYCHAIN = '1';
  // Forward no cloud tokens, NODE_OPTIONS, registry settings or upstream configuration.
  const child = spawn(process.execPath, [join(release, 'dist', 'mcp', 'server.js')], { cwd: release, env, stdio: 'inherit' });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('Yomi runtime could not start'); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code ?? 1; });
}
