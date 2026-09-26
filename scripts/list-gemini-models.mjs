#!/usr/bin/env node
/**
 * Lista los modelos de Gemini disponibles para tu clave.
 *
 * Google mantiene varios Flash estables a la vez y los renombra con
 * frecuencia, así que el ID correcto se consulta, no se recuerda. Usa la salida
 * de aquí para rellenar GEMINI_MODEL en el entorno.
 *
 *   node scripts/list-gemini-models.mjs
 */

const apiKey = process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.error(
    'Falta GEMINI_API_KEY.\n' +
      'Consíguela en https://aistudio.google.com/apikey y expórtala:\n' +
      '  export GEMINI_API_KEY=...   (bash)\n' +
      '  $env:GEMINI_API_KEY="..."   (PowerShell)',
  );
  process.exit(1);
}

const response = await fetch(
  'https://generativelanguage.googleapis.com/v1beta/models?pageSize=200',
  { headers: { 'x-goog-api-key': apiKey } },
);

if (!response.ok) {
  console.error(`La API respondió ${response.status}: ${await response.text()}`);
  process.exit(1);
}

const { models = [] } = await response.json();

// Sólo los que sirven para lo que hace la app: generar contenido.
const usable = models
  .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
  .map((m) => ({
    id: String(m.name).replace(/^models\//, ''),
    entrada: m.inputTokenLimit,
    salida: m.outputTokenLimit,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const flash = usable.filter((m) => m.id.includes('flash'));

console.log(`\n${usable.length} modelos disponibles para generateContent.\n`);

console.log('Flash y Flash-Lite (los del tier gratuito de AI Studio):');
console.table(flash);

console.log('\nSugerencia para el entorno:');
// El Flash estable más alto que no sea lite ni preview.
const preferred =
  flash
    .filter((m) => !m.id.includes('lite') && !m.id.includes('preview') && !m.id.includes('image'))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0]?.id ?? 'gemini-3.8-flash';
const light =
  flash
    .filter((m) => m.id.includes('lite') && !m.id.includes('preview') && !m.id.includes('image'))
    .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }))[0]?.id ??
  'gemini-3.5-flash-lite';

console.log(`  GEMINI_MODEL=${preferred}`);
console.log(`  GEMINI_MODEL_LIGHT=${light}\n`);
