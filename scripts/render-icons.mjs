import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const sizes = [16, 32, 48, 96, 128];
const root = path.dirname(fileURLToPath(import.meta.url));
const svg = await readFile(path.join(root, '../public/icon/icon.svg'));

for (const size of sizes) {
  await sharp(svg, { density: 384 })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(root, `../public/icon/${size}.png`));
}

console.log(`Rendered ${sizes.join(', ')} px icons.`);
