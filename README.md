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

## Y después mide si acertó

Un modelo que nadie audita es una opinión con decimales. Por eso cada apuesta
registrada guarda la probabilidad y el EV que el motor calculó **en ese
momento**, y al terminar el partido se liquida contra el marcador real.

La métrica que manda no es el beneficio, es el **CLV**: cuánto mejor fue tu
precio que el de cierre del mercado.

```
Villarreal-Levante · "Más de 2.5 goles"

  cogiste          1.46
  cierre           1.54     ← el mercado acabó pagando más
  CLV             -5.2%     ← pagaste de más, aunque la apuesta ganara
```

Esa apuesta ganó y aun así el CLV es negativo, y eso es exactamente lo útil:
con veinte resultados el beneficio es casi todo varianza, mientras que coger
sistemáticamente mejor precio que el de cierre sí predice beneficio a largo
plazo. La Edge Function `settle-bets` marca el último precio de cada casa antes
del saque —hay que capturarlo entonces, porque después ya no existe en ninguna
parte— y liquida con las mismas reglas del motor que usa la app.

Las reglas tienen sus casos raros, y están en `tracking.test.ts`: una leg
perdida tumba el parlay aunque queden partidos por jugar, una leg anulada sale
de la combinada en vez de contar como ganada (y la cuota baja), y un 0-0 es un
marcador, no un partido sin resolver.

---

## Y al modelo, también

La mezcla `p = w·modelo + (1−w)·mercado` arrancó con `w = 0.35`, que era una
conjetura razonable y nada más. La Fase 4 la sustituye por un dato: la Edge
Function `backtest` reproduce el motor sobre **1.477 partidos ya jugados** de las
cuatro ligas (sept. 2025 – sept. 2026) y elige el `w` que mejor los predice.

Las reglas del backtest son las que lo hacen creíble:

- **Nada del futuro.** Cada partido se predice con un Dixon-Coles reajustado sólo
  con lo jugado *antes de ese día* (`backtest.test.ts` lo comprueba colando
  goleadas posteriores y verificando que la predicción no se mueve).
- **Las cuotas del momento de decidir.** football-data.co.uk publica gratis las
  cuotas de 7-9 casas recogidas uno a tres días antes de cada partido, y las de
  cierre. Con las previas se decide; el cierre sólo se usa para medir el CLV.
- **`w` por log loss, no por ROI.** El ROI de unos cientos de apuestas es casi
  todo varianza, y elegir `w` por él sería ajustar el ruido. La log loss usa
  todos los partidos, se apueste o no.

El resultado no favorece al producto, y se cuenta igual:

```
log loss (más bajo es mejor)      1X2     más/menos 2.5
  modelo solo                    1.017        0.688
  mercado solo                   0.979        0.673
  w óptimo                         0 %  (en las cuatro ligas y los dos mercados)

si se hubieran seguido las selecciones con w = 35% y ventaja ≥ 2%
  996 apuestas · ROI −10,2% ± 11,8% · CLV −0,3% · batió el cierre en 45%
```

La log loss crece de forma monótona desde `w = 0` hasta `w = 1`, y sigue así con
dieciséis combinaciones de vida media y encogimiento validadas fuera de muestra.
Un Dixon-Coles que sólo mira goles no sabe nada que el consenso de siete casas
no sepa ya, y las "ventajas" que encontraba eran su propio error de estimación.
El ROI, por sí solo, no llega a distinguirse de cero —con mil apuestas el ruido
es de ±12 puntos—, pero el CLV negativo lo confirma por otra vía: el mercado se
movía en contra de sus selecciones antes del saque. Las cuotas de Betfair
Exchange y Matchbook se toman netas de comisión; sin ese descuento el exchange
aparecía como la mejor cuota casi siempre y el ROI salía mejor de lo que se
podía cobrar.

## Así que la app es un auditor que busca el mejor precio

`generate-parlays` usa el `w` de la última calibración con muestra suficiente, y
con `w = 0` hay valor sólo cuando una casa paga por encima de lo que el
consenso de todas las demás cree que vale el resultado. Eso pasa pocas veces, y
la pantalla Valor se queda vacía casi siempre: es la respuesta correcta, no un
fallo.

Lo que la app hace a diario es otra cosa:

- **Enseña todas las cuotas.** `model_predictions` guarda cada selección
  cotizada, no sólo las que tienen ventaja, con su mejor precio y el EV frente al
  consenso. Hoy y Partido muestran cuotas y probabilidades de todos los partidos.
- **Audita cualquier parlay.** El EV de un parlay se calcula con la probabilidad
  calibrada de cada leg; la matriz de Dixon-Coles se queda para lo que sí sabe
  hacer, que es medir cuánto se correlacionan dos mercados del mismo partido.
  Antes el auditor tomaba la conjunta directamente de la matriz, así que su EV
  era siempre el del modelo puro, aunque la mezcla dijera otra cosa.
- **Da la cara.** La pantalla **Cómo le va al modelo** (desde Perfil) enseña al
  usuario el último backtest, que se repite cada lunes. Si algún día el modelo
  aporta, el `w` subirá solo y la pantalla lo dirá.

---

## El ajuste encoge hacia la media

Dixon-Coles estima dos parámetros por equipo. En septiembre cada equipo lleva
ocho o nueve partidos, así que hay cuarenta parámetros libres para unas ochenta
observaciones y el ajuste se sobreajusta sin remedio: una goleada temprana
bastaba para que el modelo diera a un equipo **2,9 veces** el ataque medio de la
liga, y de ahí salían probabilidades imposibles (96% de victoria local, 59% de
empate).

Dos cosas lo corrigen, y las dos hacen falta:

1. **Muestra**: se ingiere también la temporada anterior completa. De 84
   partidos por liga a 449.
2. **Encogimiento**: cada fuerza se acerca a 1 en proporción a los partidos
   efectivos que la respaldan —`n / (n + 12)`, con `n` medido en peso por
   recencia, no en conteo—. Es James-Stein: con poca muestra la media de la liga
   predice mejor que el dato propio del equipo.

```
                       antes        después
Barcelona (ataque)      2,89          1,64
Barcelona - Getafe    96-4-1       72-18-10
Hull City - Everton  26-59-15      42-29-29
```

---

## Estructura

```
apps/mobile/          Expo (SDK 57) · Expo Router · pantallas
packages/engine/      Motor de valor: de-vig, Dixon-Coles, EV/Kelly, auditor
packages/core/        Esquemas zod compartidos (el guardián de cada frontera)
packages/ui/          Tokens del diseño, cristal, burbujas
supabase/
  migrations/         Esquema, RLS y cron
  functions/          Ingesta, modelo, capa Gemini, liquidación y avisos
design/               Referencia visual importada
```

`packages/engine` no tiene dependencias: ni de red, ni de Supabase, ni de React.
Es donde "sin errores" se verifica con tests deterministas, y corre igual en la
app y en el backend.

---

## Puesta en marcha

```bash
pnpm install
pnpm test          # 221 tests
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
supabase functions deploy ingest-fixtures ingest-odds fit-model generate-parlays \
  settle-bets send-alerts ingest-history backtest --import-map supabase/functions/deno.json
```

Las ligas viven en un único registro, `supabase/functions/_shared/leagues.ts`,
con el código de cada fuente. Añadir una es una línea, dentro del presupuesto
de abajo.

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
| football-data.org | 10 req/min | 8 por pasada, 3 pasadas/día (calendario y temporada anterior, × 4 ligas) |
| The Odds API | 500 créditos/mes | ~350/mes (2 créditos por liga y pasada; ~85-90 por liga) |
| football-data.co.uk | sin límite publicado | 8 CSV por semana, para el backtesting |
| Gemini Flash | ~1.000-1.500 req/día | ~40/día (un análisis por partido) |

Con tres pasadas diarias por liga, The Odds API sólo daba para dos ligas. Ahora
cada liga se pide una vez al día mientras tenga partidos en la semana, y repite
sólo el día en que juega, que es cuando la cuota se mueve y cuando hace falta un
precio cercano al saque para el CLV. Así caben La Liga, Premier League, Serie A
y Bundesliga; una quinta rozaría el tope.

football-data.org sustituye a API-Football como única fuente de partidos: su
tier gratuito da la temporada en curso completa (jugados y por jugar) en las
12 competiciones que cubre —las cuatro de la app entre ellas—, justo lo
contrario de API-Football, cuyo plan free bloquea la temporada actual y sólo
permite consultar 2022-2024. Al venir calendario e histórico del mismo
proveedor, comparten el mismo espacio de ids sin mapear nombres de equipo
entre fuentes.

`fit-model`, `settle-bets`, `backtest` y `send-alerts` no aparecen en la tabla
porque no gastan nada: los tres primeros sólo leen la base, y el push de Expo es
gratuito.

Cada llamada se registra en `api_usage_log` y un guard corta **antes** de
superar la cuota, para no quedarse sin datos a mitad de periodo. La ingesta de
cuotas además se salta las ligas sin partidos próximos: durante un parón de
selecciones serían tres semanas gastando créditos en eventos que no tendrían
ningún partido al que engancharse.

---

## Estado

Fase 1 completa: monorepo, motor con tests, esquema con RLS, autenticación
(Google y correo), sistema visual con claro/oscuro, y las pantallas Splash,
Auth, Onboarding, Hoy, Partido, Builder y Perfil.

Fase 2 completa: la app lee del backend real —partidos, cuotas, predicciones y
análisis de Gemini—, con la pantalla Valor sobre las selecciones con ventaja y
el razonamiento de la IA en el detalle de partido. Sin partidos en la ventana
—los parones de selecciones duran hasta tres semanas— cae a datos de muestra y
lo dice en pantalla.

Fase 3 completa: registrar un parlay lo guarda en tu cuenta (en una sola
transacción: parlay, legs y movimiento de bankroll), `settle-bets` lo liquida
contra el marcador real y captura la línea de cierre, y la pantalla Apuestas
muestra P/L, acierto, ROI y CLV. El perfil viaja con la cuenta, no con el
dispositivo, y sus interruptores afectan de verdad al auditor.

Fase 4, lo que depende del código: backtesting walk-forward con calibración de
`w` (ver arriba), Serie A y Bundesliga, un emparejador de nombres de equipo
entre proveedores con tests, y la configuración de EAS (`apps/mobile/eas.json`).
Las alertas push respetan ahora las ligas que cada usuario sigue, como promete
el onboarding.

Lo que no depende del código y queda pendiente:

- **Builds y tiendas.** Necesitan tu cuenta de Expo (`eas init`, que da el
  `EAS_PROJECT_ID`), las cuentas de desarrollador de Apple y Google, y un icono
  de 1024×1024 que el repo todavía no tiene.
- **Props de jugador.** Necesitan plan de pago en The Odds API; las pantallas ya
  soportan una lista de mercados dinámica.
- **Push.** Expo Go dejó de entregar push remoto en SDK 53, así que
  `registerPushToken` devuelve `unsupported` hasta el primer development build.
  El registro del token, la tabla y `send-alerts` están hechos.

---

## Aviso

Las probabilidades del modelo son estimaciones, no garantías. Solo para mayores
de 18 años. Juega con responsabilidad.
