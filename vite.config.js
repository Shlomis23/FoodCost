import { defineConfig } from 'vite';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { serviceWorkerSource } from './scripts/service-worker.js';
function offlineBundle() {
  return { name: 'kerem-offline', async closeBundle() {
    const walk = async folder => (await Promise.all((await readdir(folder, { withFileTypes: true })).map(async e => e.isDirectory() ? walk(path.join(folder,e.name)) : path.join(folder,e.name)))).flat();
    const files = (await walk('dist')).filter(f => !f.endsWith('sw.js'));
    const hash = createHash('sha256');
    hash.update(serviceWorkerSource([], ''));
    for (const f of files) hash.update(await readFile(f));
    const urls = files.map(f => './'+path.relative('dist',f).replaceAll('\\','/'));
    await writeFile('dist/sw.js', serviceWorkerSource(urls, hash.digest('hex').slice(0,16)));
  }};
}
export default defineConfig({ base: '/FoodCost/', plugins: [offlineBundle()], build: { target: 'es2022' }, test: { include: ['tests/**/*.test.js'] } });
