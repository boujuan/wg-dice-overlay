/* Copia las librerías de node_modules a overlay/vendor/ para que el renderer
 * las cargue como módulos ES locales, sin empaquetador ni CDN. */
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';

const files = [
  ['node_modules/three/build/three.module.js', 'overlay/vendor/three.module.js'],
  ['node_modules/three/build/three.core.js', 'overlay/vendor/three.core.js'],
  ['node_modules/cannon-es/dist/cannon-es.js', 'overlay/vendor/cannon-es.js']
];

for (const [src, dst] of files) {
  mkdirSync(dirname(join(root, dst)), { recursive: true });
  copyFileSync(join(root, src), join(root, dst));
  console.log('vendor ok:', dst);
}
