import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const studio = resolve(core, '..');
const client = join(studio, '02-CLIENT-PROJECTS', 'classic-bag-belt');
const company = join(studio, '00-COMPANY', 'brand-assets');
const output = join(core, 'apps', 'mobile', 'public', 'brand');
const androidMark = join(core, 'apps', 'mobile', 'android', 'app', 'src', 'main', 'res', 'drawable-nodpi', 'classicbag_mark.png');
const config = JSON.parse(await readFile(join(client, 'brand-config', 'store.json'), 'utf8'));
if (config.slug !== 'classic-bag-belt' || config.appId !== 'ir.majora.classicbag') throw new Error('Unexpected client configuration');
await mkdir(join(output, 'fonts'), { recursive: true });
await copyFile(join(client, 'original-assets', 'ClassicBag-mark.png'), join(output, 'store-logo.png'));
await copyFile(join(client, 'design-system', 'store-logo-gold.png'), join(output, 'store-logo-gold.png'));
await mkdir(dirname(androidMark), { recursive: true });
await copyFile(join(client, 'original-assets', 'ClassicBag-mark.png'), androidMark);
await copyFile(join(company, 'IMG_1137.PNG'), join(output, 'majora-logo.png'));
for (const weight of ['Regular', 'Medium', 'SemiBold', 'ExtraBold']) {
  await copyFile(join(client, 'design-system', 'fonts', `Estedad-${weight}.woff2`), join(output, 'fonts', `Estedad-${weight}.woff2`));
}
await writeFile(join(output, 'config.json'), JSON.stringify(config, null, 2), 'utf8');
console.log(`Brand prepared: ${config.name}`);
