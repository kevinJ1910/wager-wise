# WagerWise — Plan de implementación

## Contexto

WagerWise es una app móvil de **análisis** de apuestas de fútbol (no casa de apuestas, no se cursan apuestas): ingiere los partidos y cuotas del día, estima probabilidades propias con un modelo estadístico, detecta valor (EV positivo), construye y **audita** parlays, y explica cada selección con un agente de IA.

El diseño ya existe y está importado desde Claude Design (proyecto `747d6c02-e19b-4183-b47e-7c1c924ac511`). La referencia completa está en [design/parlay-reference.dc.html](design/parlay-reference.dc.html) — 9 pantallas, tokens de color claro/oscuro, tipografía y animaciones. Ese archivo es la fuente de verdad visual.

El diferenciador del producto, según el propio diseño, es el **auditor**: la pantalla Builder revisa correlación, varianza, EV y límite de stake antes de que el usuario registre nada. Eso es lo que "sin errores" significa aquí, y es la parte que hay que construir bien.

Decisiones ya tomadas por el usuario: APIs en tier gratuito, backend solo Supabase, ejecución por fases empezando con un esqueleto end-to-end funcional.

---

## 1. Lo que el diseño ya define (no inventar)

### Tokens exactos

| Token | Claro | Oscuro |
|---|---|---|
| `bg` / `bg2` | `#F0EEE9` / `#E6E2D9` | `#171715` / `#232321` |
| `ink` / `ink2` / `ink3` | `#1F1E1D` / 62% / 42% | `#F4F1EC` / 62% / 40% |
| `glass` / `glass2` | `rgba(255,255,255,.58)` / `.38` | `rgba(255,255,255,.07)` / `.045` |
| `stroke` / `hair` | `rgba(31,30,29,.10)` / `.08` | `rgba(255,255,255,.13)` / `.09` |
| `accent` / `accent2` | `#C15F3C` / `#DA7756` | `#DA7756` / `#E89272` |
| `good` / `bad` / `warn` | `#2F6B4F` / `#A83F36` / `#8A6A1E` | `#6FBF92` / `#E5796C` / `#D8B25A` |
| `shadow` | `rgba(31,30,29,.10)` | `rgba(0,0,0,.45)` |
| burbujas `b1`/`b2`/`b3` | coral `.55` / azul `.42` / verde `.38` | coral `.42` / azul `.38` / verde `.30` |

### Tipografía

**Hanken Grotesk** (300–800) para UI y **Newsreader** (300–600) para display y cifras hero. Ambas son **OFL en Google Fonts**, así que se empaquetan en el binario sin problema de licencia. Esto ya resuelve el punto de "tipografía igual a la de Claude": las fuentes reales de Claude (Styrene, Tiempos Text, Galaxie Copernicus) son comerciales de Commercial Type / Village y no se pueden redistribuir en una app; el diseño ya eligió los sustitutos OFL correctos.

### Geometría y movimiento

Radios 24–30px en tarjetas, 999 en píldoras, 18 en inputs, 27 en botones (altura 54), 33 en la tab bar (altura 66). Blur 18–30px con `saturate(150–180%)`. Tres burbujas de fondo con `radial-gradient` + blur 34–40px animadas en bucle (17s / 21s / 25s, `ease-in-out`). Entrada de tarjetas: `rise` — opacidad + `translateY(10px)` en 350ms. Los targets táctiles ya respetan 44px mínimo.

### Pantallas (9 + tab bar)

1. **Splash** — logo, "Crear cuenta" / "Ya tengo cuenta", aviso 18+.
2. **Auth** — login/registro con toggle, Google, email+contraseña con validación inline, checkbox 18+ en registro.
3. **Onboarding (3 pasos)** — bankroll + moneda, ligas seguidas, perfil de riesgo (Conservador 1/8 · Balanceado 1/4 · Agresivo 1/2 Kelly).
4. **Hoy** — chips de liga, hero "Parlay del día" con EV y cuota combinada, tarjetas de partido con píldora EV, cuotas 1/X/2 y barra de probabilidad del modelo.
5. **Partido** — probabilidades local/empate/visita con cuota, barras de forma y métricas, lista de mercados con prob. del modelo, chip EV y **razonamiento IA expandible** con datos de soporte.
6. **Builder** — cuota total, prob. implícita vs. prob. modelo, **auditor**, legs con marca de correlación, slider de stake Kelly, registrar.
7. **Valor** — filtros (Todos / EV > 5% / Confianza alta), tarjetas de alerta con EV, barra de confianza y "Añadir".
8. **Apuestas** — P/L hero con sparkline, acierto/ROI/nº apuestas, historial ganada/perdida/abierta.
9. **Perfil** — avatar, perfil de riesgo y Kelly, bankroll, límite semanal, exposición, moneda, toggles (alertas, auditor de correlación, límite de stake, modo oscuro), repetir onboarding, cerrar sesión, disclaimer 18+.

Tab bar: Hoy · Parlay (badge = nº de legs) · Valor · Apuestas · Perfil.

> `ios-frame.jsx` y `support.js` son andamiaje del canvas de Claude Design (marco de dispositivo iOS 26 y el runtime `dc-runtime` que implementa `sc-if`/`sc-for`/`DCLogic`). No viajan a la app. Solo confirman el target: 402×874 pt, estética iOS 26 liquid glass.

---

## 2. Stack

| Capa | Elección | Por qué |
|---|---|---|
| Móvil | **Expo SDK 55** (RN 0.83, React 19.2), Expo Router v7, TypeScript estricto | `expo-blur` es **estable en Android desde SDK 55** (RenderNode API) — es lo que hace viable el glassmorphism multiplataforma. New Architecture por defecto. |
| Estilos | NativeWind v4 con variables CSS + tokens tipados | Los tokens del diseño mapean 1:1 a variables; tema claro/oscuro sin duplicar componentes. |
| Animación | `react-native-reanimated` (burbujas, `rise`), `expo-linear-gradient` | Burbujas en el hilo de UI, sin jank. |
| Estado servidor | TanStack Query | Caché, revalidación, offline. |
| Estado local | Zustand + MMKV | Builder, tema, preferencias. |
| Backend | **Supabase**: Postgres + Auth + RLS + Edge Functions (Deno/Hono) + `pg_cron` | Una sola plataforma, un despliegue, costo casi cero. |
| IA | **Gemini** (Google AI Studio) vía `@google/genai` | Ver §5. Tier gratuito real para Flash. |
| Monorepo | pnpm workspaces + Turborepo | Compartir el motor y los tipos entre app y funciones. |

```
wager-wise/
├─ apps/mobile/          Expo, Expo Router, pantallas
├─ packages/engine/      TS puro: de-vig, Dixon-Coles, EV/Kelly, correlación, auditor
├─ packages/core/        esquemas zod + tipos generados de Supabase
├─ packages/ui/          primitivas glass, tokens, tipografía
├─ supabase/
│  ├─ migrations/        esquema + RLS
│  └─ functions/         ingest-fixtures, ingest-odds, fit-model, generate-parlays, ai-analyze
└─ design/               referencia importada del canvas
```

`packages/engine` es **TypeScript puro sin dependencias de red ni de Supabase**. Eso es deliberado: es la pieza donde "sin errores" se verifica con tests unitarios deterministas, y corre igual en la app y en el backend.

---

## 3. Datos externos y presupuesto de cuota (tier gratuito)

| Fuente | Uso | Límite |
|---|---|---|
| **API-Football** (api-sports.io) | Fixtures, resultados históricos, estadísticas, forma, H2H, lesiones, alineaciones | 100 req/día |
| **The Odds API** | Cuotas de varias casas, para consenso y de-vig | 500 créditos/mes (crédito = mercados × regiones) |

Presupuesto real diario que cabe en gratis:

- **Fixtures + stats (API-Football):** 6 ligas × 1 req = 6/día. Lesiones y alineaciones de los partidos del día: ~15/día. Refresco semanal del histórico para el modelo: 6 ligas × 4 páginas = 24, una vez por semana. Total holgado bajo 100/día.
- **Cuotas (The Odds API):** 2 mercados (`h2h`, `totals`) × 1 región (`eu`) = 2 créditos por llamada. 3 snapshots al día × 2 ligas = 12 créditos/día ≈ 360/mes. Cabe en 500 con margen para reintentos.

Todo se cachea en Postgres; la app **nunca** llama a las APIs externas directamente — solo lee Supabase. Las claves viven en secrets de Edge Functions. Una tabla `api_usage_log` cuenta cada llamada y un guard corta antes de superar la cuota.

### Tres problemas reales del tier gratuito, y qué hago con ellos

1. **Props de jugador no están disponibles.** El mockup muestra "Isco 1+ tiro a puerta" e "Isak 1+ gol" de forma prominente, pero las props de jugador en fútbol requieren plan de pago en The Odds API y la cobertura por casa es irregular. **Fase 1 ship con mercados de partido** (1X2, Over/Under, BTTS, doble oportunidad, hándicap asiático), que sí están cubiertos al 100%. Las props quedan en Fase 4 detrás de un flag, activables el día que se pase a plan pago. Las pantallas se diseñan para que la lista de mercados sea dinámica, así que no hay que rehacer nada.
2. **Tipos de cambio hardcodeados.** El mockup lleva `rate: 1/4000` para USD, etc. En producción el bankroll se **almacena en una sola moneda** (la que el usuario eligió en onboarding) y la conversión es solo de presentación, con un snapshot diario de tasas (`open.er-api.com`, gratis) cacheado en Postgres. Nunca se recalcula el histórico al cambiar de moneda.
3. **El modelo necesita histórico.** Dixon-Coles requiere ~1–2 temporadas de resultados por liga. Es una carga inicial (24 req) más un refresco semanal, no un costo diario.

---

## 4. El motor de valor (`packages/engine`) — el corazón

Este es el orden exacto de cálculo. Cada paso es una función pura y testeable.

**1. Quitar el margen de la casa (de-vig).** Las cuotas publicadas suman más de 100% en probabilidad implícita. Método multiplicativo por defecto, Shin como alternativa. Se aplica por casa y por mercado.

**2. Probabilidad de mercado (consenso).** Media ponderada de las probabilidades sin vig de todas las casas disponibles, dando más peso a las de margen bajo. Es el mejor estimador único de la probabilidad real.

**3. Probabilidad del modelo (Dixon-Coles).** Poisson bivariado con fuerza de ataque y defensa por equipo, ventaja de local, y el término τ de corrección para marcadores bajos (0-0, 1-0, 0-1, 1-1), con decaimiento exponencial por recencia. Produce una **matriz de marcadores** (0–8 goles por lado) de la que se derivan todos los mercados: 1X2, Over/Under cualquier línea, BTTS, doble oportunidad, hándicap.

**4. Mezcla.** `p_final = w·p_modelo + (1−w)·p_mercado`, con `w ≈ 0.35` inicial. Calibrar `w` contra el histórico, no elegirlo a ojo. El mercado es difícil de batir; el modelo aporta en los márgenes.

**5. Por selección:** `edge = p_final − p_implícita`, `EV = p_final × (cuota − 1) − (1 − p_final)`, fracción de Kelly, banda de confianza a partir del tamaño de muestra.

**6. Correlación — aquí es donde mejoramos el mockup.** El diseño calcula `total = Π cuotas` y `modelP = Π p`, y **avisa** cuando hay dos legs del mismo partido. Multiplicar probabilidades solo es válido bajo independencia, y dos mercados del mismo partido nunca son independientes — el propio mockup lo dice ("Ambos marcan" correlaciona 0.71 con "Más de 2.5 goles"; "Atalanta gana + over 2.5" correlaciona +0.58).

La app no se queda en el aviso: **calcula la probabilidad conjunta real** sumando las celdas de la matriz de marcadores donde ambas condiciones se cumplen. `P(gana local ∩ over 2.5)` es una suma exacta sobre la matriz, no un producto. Resultado: el usuario ve el EV correcto, no un EV inflado con una advertencia al lado. Para legs de partidos distintos la independencia sí es razonable y el producto se mantiene (que es exactamente lo que el diseño afirma).

**7. Construcción de parlays.** Búsqueda sobre combinaciones de 2–5 legs maximizando EV ajustado por riesgo, con restricciones: edge mínimo, cuota máxima por leg, y las conjuntas correctas del paso 6. Salida en tres niveles, como sugiere el perfil de riesgo del onboarding: segura (~1.5–2.5x), equilibrada (~3–6x), agresiva (~8x+).

**8. El auditor.** Las cuatro comprobaciones del diseño, ahora con números reales detrás:

| Check | Regla |
|---|---|
| Correlación | Legs del mismo partido → probabilidad conjunta exacta y EV recalculado (no solo aviso) |
| Varianza | >4 legs → probabilidad de acierto y sugerencia de dividir |
| EV | `EV < 0` → bandera roja, con el número |
| Stake | Por encima del Kelly fraccionado del perfil → aviso con el máximo sugerido |

Y `applyFix`, que ya está en el diseño: quitar la leg correlacionada o las de EV negativo.

**9. Backtesting.** Guardar líneas de cierre y resultados, reproducir el motor sobre el histórico y reportar ROI, **CLV** (closing line value) y **Brier score**. Sin esto no hay forma honesta de decir que el modelo funciona; con esto, `w` y los umbrales se calibran con datos en vez de con intuición.

---

## 5. Capa de IA

**Regla de diseño: la IA nunca inventa probabilidades.** Los números salen del motor (§4), que es determinista y auditable. Gemini hace tres cosas que el motor no puede:

1. **Explicar** cada selección en español, con los datos de soporte (el campo `reason` + `facts` que el diseño ya modela).
2. **Aportar contexto cualitativo** que no está en los números: lesiones, rotaciones, motivación, clima, cambios tácticos — vía *grounding with Google Search*.
3. **Vetar** una selección cuando el contexto lo justifica (se lesionó el delantero titular después del último snapshot de cuotas).

Configuración:

- SDK **`@google/genai`** (el unificado actual, no el viejo `@google/generative-ai`), apuntando a Google AI Studio con `GEMINI_API_KEY`.
- Modelo por defecto **`gemini-3.8-flash`** — el Flash estable más reciente, y **el tier gratuito de AI Studio cubre Flash y Flash-Lite** (los Pro dejaron de ser gratuitos en abril de 2026). Para tareas de volumen y bajo criterio (normalizar nombres de equipos, clasificar titulares), **`gemini-3.5-flash-lite`**.
- El ID de modelo va en **variable de entorno**, no hardcodeado, y el repo trae un script `list-models` que consulta la API con tu clave. Google renombra los Flash con frecuencia (3.5, 3.6, 3.7, 3.8 conviven como estables); esto evita que un rename rompa el pipeline.
- **Salida estructurada** con `responseMimeType: "application/json"` + `responseSchema`, y **revalidación con zod** al recibirla. El `responseSchema` sin el `responseMimeType` se ignora silenciosamente, así que van siempre juntos. Si zod no valida, se descarta y se reintenta — nunca llega texto libre a la base de datos.
- **Límites del tier gratuito**: del orden de 5–15 RPM y ~1.000–1.500 peticiones/día según modelo. La generación nocturna analiza ~20–40 partidos, así que cabe de sobra, pero el worker va con control de concurrencia y *backoff* exponencial ante 429 para no chocar con el límite por minuto.
- En el tier gratuito **Google puede usar los datos para mejorar sus productos** (en el de pago, no). Como solo enviamos datos deportivos públicos y números del motor —nunca datos personales del usuario, ni su bankroll, ni su email— es aceptable. Esa frontera se respeta en el código: el prompt se construye desde las tablas de referencia, no desde `profiles`.

Hay un **kill switch**: si la capa de IA falla o se desactiva, la app sigue funcionando con los números del motor y sin las explicaciones. La IA es aditiva, no una dependencia dura.

---

## 6. Base de datos (Supabase)

Referencia: `leagues`, `teams`, `fixtures`, `bookmakers`, `markets`, `odds_snapshots` (serie temporal, para movimiento de línea y CLV), `team_ratings` (salida de Dixon-Coles), `model_predictions`, `fx_rates`.

Recomendaciones: `parlay_recommendations`, `parlay_legs`, `value_alerts`, `ai_analyses`.

Del usuario: `profiles` (bankroll, moneda, perfil de riesgo, ligas, ajustes), `user_parlays`, `user_parlay_legs`, `bankroll_transactions`, `notification_tokens`.

Operación: `api_usage_log`, `ingestion_runs`.

**RLS en todas.** Tablas del usuario restringidas a `auth.uid()`; tablas de referencia y recomendaciones en solo lectura para autenticados. Las Edge Functions escriben con service role. Tests pgTAP que verifican que un usuario no puede leer las filas de otro — eso se prueba, no se asume.

Cron (`pg_cron` → Edge Functions):

| Hora | Tarea |
|---|---|
| 04:00 | Sincronizar ligas/equipos/resultados, reajustar Dixon-Coles, tasas FX |
| 06:00 / 12:00 / 18:00 | Fixtures próximas 48h + snapshot de cuotas |
| 07:00 | Generar parlays del día + análisis IA (Batch) + push |
| Cada 30 min, 3h antes del saque | Refresco de cuotas (movimiento de línea, CLV) |

---

## 7. Autenticación

Supabase Auth con **Google** y **email + contraseña**, exactamente como el diseño los presenta. Google con `react-native-google-signin` (flujo nativo, requiere development build — no funciona en Expo Go). Validación inline de email y mínimo 8 caracteres, que el diseño ya especifica con sus estados de error. Checkbox 18+ obligatorio en registro, persistido en `profiles`. Trigger en Postgres que crea el `profiles` al registrarse. Recuperación de contraseña por deep link.

---

## 8. Sistema visual en React Native

- **`packages/ui`** expone los tokens de §1 como un tema tipado, con `light` y `dark` completos. Ningún color se define solo en un tema.
- **`<GlassCard>`** — `expo-blur` `BlurView` (estable en ambas plataformas en SDK 55) + borde `stroke` + sombra. Fallback a superficie semi-opaca cuando `AccessibilityInfo.isReduceTransparencyEnabled()` está activo.
- **`<Bubbles>`** — tres orbes con `expo-linear-gradient` radial y Reanimated en bucle a 17/21/25s. Se congelan si `isReduceMotionEnabled()`. Se renderizan una vez a nivel de layout, no por pantalla.
- Tema `light | dark | system`, persistido en MMKV, controlable desde el toggle de Perfil que el diseño ya incluye.
- Fuentes vía `expo-font` (Hanken Grotesk + Newsreader), precargadas en el splash.

`expo-glass-effect` / `GlassView` (iOS 26) se deja como mejora progresiva detrás de `isLiquidGlassAvailable()`, **no** como base: tuvo una regresión conocida en SDK 55. La base es `expo-blur`, que funciona en iOS y Android.

---

## 9. Fases

**Fase 1 — Esqueleto end-to-end (lo acordado para empezar).**
Monorepo y tooling · proyecto Supabase con esquema y RLS · auth Google + email funcionando · ingesta real de fixtures y cuotas de 2 ligas · Dixon-Coles ajustado sobre histórico real · motor con de-vig, EV, Kelly y conjuntas correctas, con tests · pantallas Splash, Auth, Onboarding, Hoy y Builder con el sistema glass completo y claro/oscuro · **un parlay real, calculado con datos reales, en pantalla.**

**Fase 2 —** Pantalla Partido con mercados y razonamiento IA · Valor con alertas · capa Gemini con salida estructurada y grounding.

**Fase 3 —** Apuestas (tracker, P/L, ROI, CLV) · Perfil completo · notificaciones push.

**Fase 4 —** Backtesting con calibración de `w` · props de jugador (requiere plan pago) · más ligas · builds EAS y envío a tiendas.

---

## 10. Calidad — qué significa "sin errores" aquí

- TypeScript estricto, ESLint + Prettier, sin `any` en los bordes.
- **zod en cada frontera**: respuestas de APIs externas, variables de entorno, salidas del LLM. Una API de terceros que cambia un campo falla ruidosamente en la ingesta, no silenciosamente en una recomendación.
- **Vitest sobre `packages/engine` con cobertura alta**, incluyendo casos conocidos: de-vig contra cuotas de referencia, matriz de Dixon-Coles que suma 1, conjuntas del mismo partido comparadas contra simulación Monte Carlo, Kelly nunca por encima del cap del perfil.
- **pgTAP** para RLS.
- E2E (Maestro) del flujo auth → hoy → builder.
- Sentry, y `ingestion_runs` para saber cuándo una fuente falló.
- Guard de cuota que apaga la ingesta antes de agotar el tier gratuito.

---

## 11. Legal y tiendas

La app **analiza**, no acepta apuestas ni las cursa — eso la mantiene fuera de la categoría de juego real de Apple (guideline 5.3) y de la política de gambling de Google Play. Para no cruzar esa línea: sin deep links de afiliado a casas de apuestas en el lanzamiento. Puerta de edad 18+ en registro, clasificación de edad correcta en ambas tiendas, disclaimer visible de que las probabilidades son estimaciones y no garantías (el diseño ya lo incluye en Perfil y en Splash), enlaces de juego responsable, y los límites auto-impuestos que el diseño modela (límite semanal, tope de stake).

---

## 12. Verificación

1. `pnpm test` — motor en verde, incluida la comparación Monte Carlo de las conjuntas.
2. `supabase test db` — RLS: un usuario no ve los parlays de otro.
3. Invocar `ingest-fixtures` e `ingest-odds` y confirmar filas reales en `fixtures` y `odds_snapshots`, con `api_usage_log` dentro de cuota.
4. `pnpm --filter mobile start` con development build: registro con Google y con email, onboarding, y el Parlay del día renderizado con datos reales.
5. Contraste de tema: cada pantalla en claro y oscuro, y con "reducir transparencia" y "reducir movimiento" activos.
6. Contrastar un parlay de 2 legs del mismo partido contra el cálculo manual sobre la matriz — el auditor debe mostrar la conjunta correcta, no el producto.

---

## Decisiones abiertas

- **Moneda base.** El mockup asume COP con bankroll de 1.2M. Confirmar si COP es la moneda por defecto del producto.
- **Ligas de Fase 1.** El presupuesto de cuotas gratuito alcanza cómodamente para 2 ligas con 3 snapshots diarios. Propongo La Liga y Premier, que son las que el mockup usa.
