/**
 * Comisión de los exchanges sobre la ganancia neta.
 *
 * Sus cuotas no llevan margen, así que sin descontar la comisión aparecen como
 * la mejor del mercado casi siempre. Con `w = 0` eso bastaría para fabricar
 * "valor" que no existe: la ventaja sería exactamente la comisión que el
 * usuario pagaría al cobrar.
 *
 * Se toma la tarifa base alta de cada exchange. Hay usuarios con descuento,
 * pero quedarse corto con la comisión infla el EV, y pasarse sólo lo recorta.
 */

const COMMISSION: Record<string, number> = {
  // The Odds API
  betfair_ex_eu: 0.05,
  betfair_ex_uk: 0.05,
  betfair_ex_au: 0.05,
  matchbook: 0.02,
  smarkets: 0.02,
  // football-data.co.uk (Betfair Exchange)
  BFE: 0.05,
};

export function commissionOf(bookmaker: string): number | undefined {
  return COMMISSION[bookmaker];
}
