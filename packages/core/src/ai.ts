/**
 * Contrato con la capa de IA.
 *
 * La regla del producto es que Gemini nunca produce probabilidades: recibe los
 * números ya calculados por el motor y devuelve texto, contexto cualitativo y
 * —como mucho— un veto. Este esquema hace cumplir esa regla: no hay ningún
 * campo donde pueda colar una probabilidad.
 */

import { z } from 'zod';

/** Un dato de apoyo mostrado bajo el razonamiento (el `facts` del diseño). */
export const analysisFactSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().min(1).max(40),
});

export const selectionAnalysisSchema = z.object({
  /** Debe coincidir con el id de leg que se le pasó, para poder emparejar. */
  legId: z.string().min(1),
  /** Explicación en español. Acotada para que quepa en la tarjeta del diseño. */
  reasoning: z.string().min(20).max(600),
  facts: z.array(analysisFactSchema).min(1).max(4),
  /**
   * Confianza cualitativa del contexto, 0-100. NO es una probabilidad: mide
   * cuánta información de apoyo encontró, no cuánto va a pasar.
   */
  contextConfidence: z.number().int().min(0).max(100),
  /** Veto por contexto: lesión de última hora, rotación confirmada, etc. */
  veto: z.boolean().default(false),
  vetoReason: z.string().max(300).nullable().default(null),
});

export const parlayAnalysisSchema = z.object({
  summary: z.string().min(20).max(400),
  selections: z.array(selectionAnalysisSchema).min(1).max(8),
});

export type AnalysisFact = z.infer<typeof analysisFactSchema>;
export type SelectionAnalysis = z.infer<typeof selectionAnalysisSchema>;
export type ParlayAnalysis = z.infer<typeof parlayAnalysisSchema>;

/**
 * Esquema en el dialecto que espera `responseSchema` de Gemini.
 *
 * Se declara a mano en vez de derivarlo de zod: Gemini acepta un subconjunto de
 * JSON Schema (sin `$ref`, sin uniones, sin `additionalProperties`) y las
 * conversiones automáticas generan construcciones que rechaza. Mantenerlo
 * explícito y revalidar con zod al recibir es más fiable que confiar en una
 * conversión.
 */
export const GEMINI_PARLAY_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    selections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          legId: { type: 'string' },
          reasoning: { type: 'string' },
          facts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['label', 'value'],
            },
          },
          contextConfidence: { type: 'integer' },
          veto: { type: 'boolean' },
          vetoReason: { type: 'string', nullable: true },
        },
        required: ['legId', 'reasoning', 'facts', 'contextConfidence', 'veto'],
      },
    },
  },
  required: ['summary', 'selections'],
} as const;
