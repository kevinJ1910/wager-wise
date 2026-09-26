#!/usr/bin/env node
/**
 * Hace que `dist/` sea consumible desde Deno.
 *
 * TypeScript emite `foo.js` y `foo.d.ts` por separado. Node y los bundlers
 * emparejan los dos por convención, pero Deno no: al importar `foo.js` lee un
 * JavaScript sin tipos, y cualquier `export type` desaparece.
 *
 * Deno sí respeta la directiva `@ts-self-types` en la cabecera de un fichero
 * JS, que apunta a su declaración. Este script la añade tras compilar, así que
 * las Edge Functions pueden importar el motor igual que lo hace la app.
 *
 *   node scripts/add-deno-types.mjs packages/engine/dist packages/core/dist
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DIRECTIVE = '@ts-self-types';

const targets = process.argv.slice(2);

if (targets.length === 0) {
  console.error('Uso: node scripts/add-deno-types.mjs <dir> [<dir>...]');
  process.exit(1);
}

let patched = 0;

for (const target of targets) {
  if (!existsSync(target)) {
    console.error(`No existe ${target}. ¿Has ejecutado el build?`);
    process.exit(1);
  }
  patched += await patchDirectory(target);
}

console.log(`${DIRECTIVE} añadido a ${patched} ficheros.`);

async function patchDirectory(dir) {
  let count = 0;

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      count += await patchDirectory(full);
      continue;
    }

    if (!entry.name.endsWith('.js')) continue;

    const declaration = `./${entry.name.replace(/\.js$/, '.d.ts')}`;
    if (!existsSync(path.join(dir, declaration))) continue;

    const source = await readFile(full, 'utf8');
    // Idempotente: volver a ejecutar el build no debe apilar directivas.
    if (source.includes(DIRECTIVE)) continue;

    await writeFile(full, `// ${DIRECTIVE}="${declaration}"\n${source}`, 'utf8');
    count += 1;
  }

  return count;
}
