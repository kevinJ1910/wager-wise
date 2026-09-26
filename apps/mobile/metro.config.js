// Metro en un monorepo pnpm.
//
// Tres ajustes necesarios:
//  - `watchFolders` incluye la raíz del workspace, o Metro no ve packages/*.
//  - `nodeModulesPaths` añade el node_modules de la raíz.
//  - un resolver que mapea `./x.js` a `./x.ts` (ver abajo).
//
// Lo que NO hay que hacer aquí es poner `disableHierarchicalLookup: true`: con
// pnpm, las dependencias transitivas (invariant, etc.) viven dentro del store
// .pnpm y sólo se resuelven subiendo por el árbol de directorios.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

/**
 * Los paquetes de `packages/*` usan especificadores con extensión `.js` en sus
 * imports internos, que es lo correcto en ESM y lo que necesitan tanto el
 * compilado a `dist/` como las Edge Functions de Deno.
 *
 * Metro consume esos paquetes como fuente TypeScript y no hace la equivalencia
 * `.js` → `.ts` que sí hacen Node y TypeScript. Este resolver la añade:
 * intenta primero la ruta literal (para ficheros `.js` de verdad) y sólo si
 * falla prueba sin extensión.
 */
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const isRelativeJs = /^\.{1,2}\//.test(moduleName) && moduleName.endsWith('.js');

  if (isRelativeJs) {
    try {
      return context.resolveRequest(context, moduleName, platform);
    } catch {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
