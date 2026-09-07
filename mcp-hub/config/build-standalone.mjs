import esbuild from 'esbuild';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import commonConfig from './esbuild.common.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, '../build/standalone');
await esbuild.build({ ...commonConfig, entryPoints: ['./src/server/standalone.ts'], outdir: resolve(output, 'out') });
await mkdir(resolve(output, 'scripts'), { recursive: true });
await cp(resolve(root, 'scripts/service.mjs'), resolve(output, 'scripts/service.mjs'));
await cp(resolve(root, '../LICENSE'), resolve(output, 'LICENSE'));
await cp(resolve(root, '../docs/agent-execution.md'), resolve(output, 'README.md'));
await writeFile(resolve(output, 'package.json'), JSON.stringify({
  name: 'jlceda-mcp-standalone', private: true, engines: { node: '>=22' },
  scripts: { start: 'node scripts/service.mjs start', status: 'node scripts/service.mjs status', stop: 'node scripts/service.mjs stop' },
}, null, 2));
console.log(`Standalone distribution: ${output}`);
