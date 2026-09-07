import esbuild from 'esbuild';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const directoryFlag = args.indexOf('--directory');
if (directoryFlag >= 0 && (!args[directoryFlag + 1] || args[directoryFlag + 1].startsWith('--'))) throw new Error('--directory requires a path');
const directory = resolve(directoryFlag >= 0 ? args[directoryFlag + 1] : process.env.JLCEDA_OTA_DIR || resolve(root, '../mcp-hub/ota'));
await mkdir(directory, { recursive: true });
const rollback = args.indexOf('--rollback');
let manifest;
if (rollback >= 0) {
  const hash = args[rollback + 1];
  if (!/^[a-f0-9]{64}$/.test(hash || '')) throw new Error('--rollback requires a published SHA-256');
  const code = await readFile(join(directory, `${hash}.js`));
  if (createHash('sha256').update(code).digest('hex') !== hash) throw new Error('Corrupt rollback artifact');
  manifest = { abi: 1, sha256: hash, bytes: code.length };
} else {
  const output = await esbuild.build({ absWorkingDir: root, entryPoints: ['src/runtime/task-module.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'jlcTaskModule', target: 'es2020' });
  const code = output.outputFiles[0].contents;
  if (code.length > 8000000) throw new Error('OTA artifact exceeds limit');
  const hash = createHash('sha256').update(code).digest('hex');
  await writeFile(join(directory, `${hash}.js`), code);
  manifest = { abi: 1, sha256: hash, bytes: code.length };
}
// Bundle first, manifest last: readers see either complete release, never partial code.
const temp = join(directory, `manifest-${randomUUID()}.tmp`);
await writeFile(temp, JSON.stringify(manifest, null, 2));
await rename(temp, join(directory, 'manifest.json'));
console.log(JSON.stringify({ directory, ...manifest }));
