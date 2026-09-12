import { describe, expect, it } from 'vitest';
import {
  formatMoney,
  formatOdds,
  formatPercent,
  formatSignedPercent,
  isCurrencyCode,
  profileSettingsSchema,
} from './domain.js';
import { parlayAnalysisSchema } from './ai.js';
import { parseClientEnv, parseServerEnv } from './env.js';

describe('formato de dinero', () => {
  it('formatea pesos colombianos sin decimales', () => {
    expect(formatMoney(1_200_000, 'COP')).toBe('$1.200.000');
  });

  it('formatea dólares con dos decimales', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('US$1,234.50');
  });

  it('antepone el signo en negativos', () => {
    expect(formatMoney(-120_000, 'COP')).toBe('-$120.000');
  });

  it('reconoce las monedas soportadas', () => {
    expect(isCurrencyCode('COP')).toBe(true);
    expect(isCurrencyCode('JPY')).toBe(false);
  });
});

describe('formato de porcentajes y cuotas', () => {
  it('formatea porcentaje con un decimal', () => {
    expect(formatPercent(0.612)).toBe('61.2%');
  });

  it('marca el signo del EV', () => {
    expect(formatSignedPercent(0.052)).toBe('+5.2%');
    expect(formatSignedPercent(-0.042)).toBe('-4.2%');
  });

  it('formatea cuotas con dos decimales', () => {
    expect(formatOdds(1.6)).toBe('1.60');
    expect(formatOdds(2)).toBe('2.00');
  });
});

describe('ajustes del perfil', () => {
  it('aplica los valores por defecto del diseño', () => {
    const settings = profileSettingsSchema.parse({});
    expect(settings).toEqual({
      alerts: true,
      correlationAudit: true,
      stakeLimit: true,
      theme: 'system',
    });
  });

  it('rechaza un tema desconocido', () => {
    expect(profileSettingsSchema.safeParse({ theme: 'sepia' }).success).toBe(false);
  });
});

describe('contrato con la IA', () => {
  const valid = {
    summary: 'Parlay con dos selecciones de ligas distintas y ventaja sostenida por xG.',
    selections: [
      {
        legId: 'leg-1',
        reasoning:
          'El modelo da 54% al local frente al 51% implícito, sostenido por 1.84 xG en casa.',
        facts: [{ label: 'xG local', value: '1.84' }],
        contextConfidence: 78,
        veto: false,
        vetoReason: null,
      },
    ],
  };

  it('acepta una respuesta bien formada', () => {
    expect(parlayAnalysisSchema.parse(valid)).toMatchObject({ summary: valid.summary });
  });

  it('aplica el valor por defecto de veto', () => {
    const { veto, vetoReason, ...withoutVeto } = valid.selections[0]!;
    const parsed = parlayAnalysisSchema.parse({
      ...valid,
      selections: [withoutVeto],
    });
    expect(parsed.selections[0]!.veto).toBe(false);
  });

  it('rechaza un razonamiento vacío', () => {
    expect(
      parlayAnalysisSchema.safeParse({
        ...valid,
        selections: [{ ...valid.selections[0]!, reasoning: 'corto' }],
      }).success,
    ).toBe(false);
  });

  it('rechaza una confianza fuera de rango', () => {
    expect(
      parlayAnalysisSchema.safeParse({
        ...valid,
        selections: [{ ...valid.selections[0]!, contextConfidence: 140 }],
      }).success,
    ).toBe(false);
  });

  it('ignora una probabilidad que la IA intente colar', () => {
    // El contrato no tiene campo de probabilidad: si el modelo lo inventa, zod
    // lo descarta en vez de dejarlo llegar a la base de datos.
    const parsed = parlayAnalysisSchema.parse({
      ...valid,
      selections: [{ ...valid.selections[0]!, probability: 0.99 }],
    });
    expect(parsed.selections[0]).not.toHaveProperty('probability');
  });
});

describe('validación de entorno', () => {
  const serverEnv = {
    SUPABASE_URL: 'https://abc.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'x'.repeat(40),
    FOOTBALL_DATA_API_KEY: 'y'.repeat(32),
    ODDS_API_KEY: 'z'.repeat(32),
    GEMINI_API_KEY: 'g'.repeat(39),
  };

  it('aplica los valores por defecto de Gemini', () => {
    const env = parseServerEnv(serverEnv);
    expect(env.GEMINI_MODEL).toBe('gemini-3.8-flash');
    expect(env.GEMINI_ENABLED).toBe(true);
  });

  it('permite apagar la IA por entorno', () => {
    expect(parseServerEnv({ ...serverEnv, GEMINI_ENABLED: 'false' }).GEMINI_ENABLED).toBe(false);
  });

  it('nombra exactamente lo que falta', () => {
    const { GEMINI_API_KEY, ...incomplete } = serverEnv;
    expect(() => parseServerEnv(incomplete)).toThrow(/GEMINI_API_KEY/);
  });

  it('rechaza una URL de Supabase inválida', () => {
    expect(() => parseServerEnv({ ...serverEnv, SUPABASE_URL: 'no-es-url' })).toThrow();
  });

  it('valida el entorno del cliente', () => {
    const env = parseClientEnv({
      EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'a'.repeat(40),
    });
    expect(env.EXPO_PUBLIC_SUPABASE_URL).toContain('supabase.co');
  });
});
