/**
 * Cliente de la API de Gemini (Google AI Studio).
 *
 * Se habla con la REST API directamente en vez de empaquetar el SDK: la
 * llamada es un único POST, y en una Edge Function cada dependencia se paga en
 * tiempo de arranque en frío.
 *
 * Dos reglas que el resto del código da por sentadas:
 *
 *  1. Gemini NUNCA produce probabilidades. Recibe los números ya calculados por
 *     el motor y devuelve texto, contexto y —como mucho— un veto. El esquema de
 *     respuesta no tiene ningún campo numérico donde pueda colar una.
 *  2. Nada que salga de aquí llega a la base de datos sin pasar por zod. El
 *     `responseSchema` de Gemini orienta al modelo, pero no es una garantía.
 */

import {
  GEMINI_PARLAY_RESPONSE_SCHEMA,
  parlayAnalysisSchema,
  type ParlayAnalysis,
} from '../../../packages/core/dist/ai.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Máximo de reintentos ante 429/5xx. */
  maxRetries?: number;
  /** Activa el grounding con Google Search para lesiones y alineaciones. */
  useSearchGrounding?: boolean;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/** Una leg tal como la ve el modelo: sólo lo necesario para explicarla. */
export interface LegBrief {
  legId: string;
  match: string;
  league: string;
  kickoff: string;
  market: string;
  odds: number;
  /** Ya calculada por el motor. Se da como dato, no se pide. */
  modelProbabilityPct: string;
  edgePct: string;
  expectedValuePct: string;
}

export interface ParlayBrief {
  legs: LegBrief[];
  combinedOdds: string;
  trueProbabilityPct: string;
  expectedValuePct: string;
  /** Avisos ya detectados por el auditor, para que la IA no los contradiga. */
  auditNotes: string[];
}

const SYSTEM_INSTRUCTION = `Eres el analista de WagerWise, una app de análisis de apuestas de fútbol.

Recibes un parlay cuyas probabilidades y EV YA están calculados por un motor
estadístico (Dixon-Coles + consenso de mercado sin margen). Tu trabajo NO es
calcular probabilidades: es explicarlas y añadir el contexto que los números no
capturan.

Para cada leg debes:
- Escribir un razonamiento en español de España neutro, 2-3 frases, concreto y
  sin adornos. Cita los números que te damos; no inventes otros.
- Dar entre 1 y 4 datos de apoyo cortos (etiqueta + valor), del estilo
  "xG local: 1.84" o "Bajas: 2 defensas".
- Indicar tu confianza en el CONTEXTO (0-100). No es una probabilidad de que
  ocurra: mide cuánta información de apoyo verificable has encontrado.
- Vetar la selección sólo si encuentras un hecho que invalida el análisis
  (lesión confirmada del jugador clave, rotación anunciada, partido aplazado).
  Un veto sin hecho concreto detrás es un error.

Reglas duras:
- Nunca contradigas los avisos del auditor que te pasamos.
- Nunca afirmes que una apuesta es segura ni garantices un resultado.
- Nunca inventes estadísticas. Si no tienes un dato, no lo cites.
- Escribe siempre en español.`;

/**
 * Pide el análisis de un parlay y devuelve la respuesta ya validada.
 *
 * Lanza `GeminiError` si el modelo no devuelve algo que valide tras los
 * reintentos: es preferible quedarse sin explicación que guardar texto basura
 * junto a un análisis financiero.
 */
export async function analyzeParlay(
  brief: ParlayBrief,
  options: GeminiOptions,
): Promise<ParlayAnalysis> {
  const { apiKey, model, maxRetries = 3, useSearchGrounding = false } = options;

  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: buildPrompt(brief) }] }],
    generationConfig: {
      temperature: 0.4,
      // responseSchema se ignora en silencio sin este mimeType: van siempre juntos.
      responseMimeType: 'application/json',
      responseSchema: GEMINI_PARLAY_RESPONSE_SCHEMA,
    },
  };

  // El grounding y la salida estructurada no se pueden combinar: con
  // herramientas activas, Gemini rechaza responseSchema. Si hiciera falta
  // contexto de búsqueda, sería una llamada previa aparte.
  if (useSearchGrounding) {
    delete (body.generationConfig as Record<string, unknown>).responseSchema;
    delete (body.generationConfig as Record<string, unknown>).responseMimeType;
    body.tools = [{ google_search: {} }];
  }

  let lastError: GeminiError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      // Backoff exponencial: el tier gratuito limita por minuto (5-15 RPM) y
      // reintentar de inmediato sólo consume cuota.
      await sleep(Math.min(2 ** attempt * 500, 8000));
    }

    try {
      const response = await fetch(
        `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const detail = await response.text();
        const retryable = response.status === 429 || response.status >= 500;
        lastError = new GeminiError(
          `Gemini respondió ${response.status}: ${detail.slice(0, 300)}`,
          response.status,
          retryable,
        );
        if (!retryable) throw lastError;
        continue;
      }

      const payload = (await response.json()) as GeminiResponse;
      const text = extractText(payload);

      if (!text) {
        lastError = new GeminiError('Gemini devolvió una respuesta vacía.', 200, true);
        continue;
      }

      const parsed = parlayAnalysisSchema.safeParse(safeJsonParse(text));
      if (!parsed.success) {
        // Reintentamos: suele ser un JSON truncado o un campo fuera de rango.
        lastError = new GeminiError(
          `La respuesta no cumple el contrato: ${parsed.error.issues
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('; ')
            .slice(0, 300)}`,
          200,
          true,
        );
        continue;
      }

      return parsed.data;
    } catch (error) {
      if (error instanceof GeminiError && !error.retryable) throw error;
      lastError =
        error instanceof GeminiError
          ? error
          : new GeminiError(`Fallo de red hablando con Gemini: ${String(error)}`, undefined, true);
    }
  }

  throw lastError ?? new GeminiError('No se pudo obtener análisis de Gemini.');
}

function buildPrompt(brief: ParlayBrief): string {
  const legs = brief.legs
    .map(
      (leg, index) =>
        `${index + 1}. [legId: ${leg.legId}]\n` +
        `   Partido: ${leg.match} (${leg.league}, ${leg.kickoff})\n` +
        `   Mercado: ${leg.market}\n` +
        `   Cuota: ${leg.odds}\n` +
        `   Probabilidad del modelo: ${leg.modelProbabilityPct}\n` +
        `   Ventaja: ${leg.edgePct} · EV: ${leg.expectedValuePct}`,
    )
    .join('\n\n');

  const notes =
    brief.auditNotes.length > 0
      ? `\n\nAvisos del auditor (no los contradigas):\n${brief.auditNotes
          .map((n) => `- ${n}`)
          .join('\n')}`
      : '';

  return (
    `Parlay a analizar.\n\n` +
    `Cuota combinada: ${brief.combinedOdds}\n` +
    `Probabilidad conjunta (ya ajustada por correlación): ${brief.trueProbabilityPct}\n` +
    `EV del parlay: ${brief.expectedValuePct}\n\n` +
    `Legs:\n\n${legs}${notes}\n\n` +
    `Devuelve un objeto JSON con "summary" y "selections". ` +
    `Cada entrada de "selections" debe llevar el mismo "legId" que te hemos dado.`
  );
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

function extractText(payload: GeminiResponse): string | null {
  const candidate = payload.candidates?.[0];
  if (!candidate) return null;

  // Un corte por longitud deja JSON inválido; mejor tratarlo como fallo y
  // reintentar que intentar reparar la cadena.
  if (candidate.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
    return null;
  }

  const parts = candidate.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? '').join('').trim();
  return text.length > 0 ? text : null;
}

/** Gemini a veces envuelve el JSON en un bloque de código pese al mimeType. */
function safeJsonParse(text: string): unknown {
  const cleaned = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
