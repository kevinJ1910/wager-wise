# WagerWise

App móvil de **análisis** de apuestas de fútbol. No acepta ni cursa apuestas:
ingiere partidos y cuotas, estima probabilidades propias, detecta valor y
**audita** parlays antes de que registres nada.

El plan completo está en [PLAN.md](PLAN.md). El diseño de referencia, importado
de Claude Design, en [design/parlay-reference.dc.html](design/parlay-reference.dc.html).

---

## Qué hace distinto

Multiplicar cuotas sólo es válido si las selecciones son independientes, y dos
selecciones del mismo partido nunca lo son. La mayoría de las apps multiplican
igualmente y, como mucho, avisan.

WagerWise calcula la **probabilidad conjunta exacta**: como toda selección es un
predicado sobre el marcador final, basta sumar las celdas de la matriz de
marcadores de Dixon-Coles donde todas se cumplen. No hay que estimar ninguna
correlación, y el EV que ves es el real.

```
Parlay: "Más de 2.5 goles" (55.4%) + "Ambos marcan" (56.3%), mismo partido

  multiplicando        31.2%   ← lo que muestran casi todos
  conjunta real        45.0%   ← lo que muestra WagerWise
                               correlación +0.56

(Betis-Girona de los datos de muestra: λ 1.78, μ 1.12)
```

Son 14 puntos de diferencia sobre la probabilidad de acierto. En este caso la
correlación es positiva y el parlay vale **más** de lo que parece; con "gana el
local" + "menos de 2.5 goles" la correlación es negativa y vale menos. En ambas
direcciones, multiplicar da el número equivocado.

`packages/engine/src/markets.test.ts` verifica el cálculo contra una simulación
Monte Carlo de 400.000 marcadores.

---

## Estructura

```
apps/mobile/          Expo (SDK 57) · Expo Router · pantallas
packages/engine/      Motor de valor: de-vig, Dixon-Coles, EV/Kelly, auditor
packages/core/        Esquemas zod compartidos (el guardián de cada frontera)
packages/ui/          Tokens del diseño, cristal, burbujas
supabase/
  migrations/         Esquema, RLS y cron
  functions/          Ingesta, modelo y capa Gemini
design/               Referencia visual importada
```

`packages/engine` no tiene dependencias: ni de red, ni de Supabase, ni de React.
Es donde "sin errores" se verifica con tests deterministas, y corre igual en la
app y en el backend.

---

## Puesta en marcha

```bash
pnpm install
pnpm test          # 119 tests
pnpm typecheck
```

Para la app:

```bash
cp apps/mobile/.env.example apps/mobile/.env   # rellena los valores
pnpm mobile
```

Sin claves configuradas la app arranca con **datos de muestra** y lo dice en
pantalla. Los cálculos son reales; los partidos, no.

### Backend

```bash
supabase link --project-ref TU_REF
supabase db push
cp .env.example .env                            # rellena los valores
supabase secrets set --env-file .env
supabase functions deploy ingest-fixtures ingest-odds fit-model generate-parlays
```

Las Edge Functions se comprueban con Deno (el motor compilado lleva directivas
`@ts-self-types` para que Deno encuentre sus tipos):

```bash
cd supabase/functions && deno check --config deno.json */index.ts
```

El cron (`supabase/migrations/*_cron.sql`) necesita dos secretos en Vault antes
de aplicarse; están documentados en la cabecera del propio fichero.

### Gemini

El ID de modelo vive en el entorno, no en el código: Google mantiene varios
Flash estables a la vez y los renombra a menudo. Confirma cuáles sirve tu clave:

```bash
node scripts/list-gemini-models.mjs
```

La regla de la capa de IA es que **nunca produce probabilidades**. Recibe los
números ya calculados por el motor y devuelve explicación, contexto y —como
mucho— un veto. El esquema de respuesta no tiene ningún campo numérico donde
pueda colar una, y todo lo que devuelve se revalida con zod antes de tocar la
base de datos. Con `GEMINI_ENABLED=false` la app sigue funcionando sin
explicaciones.

---

## Presupuesto de las APIs gratuitas

| Proveedor | Límite | Uso previsto |
|---|---|---|
| API-Football | 100 req/día | ~21/día (calendario, stats, lesiones) |
| The Odds API | 500 créditos/mes | ~360/mes (2 mercados × 1 región × 3 pasadas × 2 ligas) |
| Gemini Flash | ~1.000-1.500 req/día | ~40/día (un análisis por partido) |

Cada llamada se registra en `api_usage_log` y un guard corta **antes** de
superar la cuota, para no quedarse sin datos a mitad de periodo.

---

## Estado

Fase 1 completa: monorepo, motor con tests, esquema con RLS, autenticación
(Google y correo), sistema visual con claro/oscuro, y las pantallas Splash,
Auth, Onboarding, Hoy, Partido, Builder y Perfil.

Pendiente, por fase: alertas de valor y análisis IA en pantalla (2), tracker de
bankroll con ROI y CLV (3), backtesting y props de jugador (4). Las props
necesitan plan de pago en The Odds API; las pantallas ya soportan una lista de
mercados dinámica, así que activarlas no exige rehacer nada.

---

## Aviso

Las probabilidades del modelo son estimaciones, no garantías. Solo para mayores
de 18 años. Juega con responsabilidad.
