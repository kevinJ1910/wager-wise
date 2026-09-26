/**
 * Tokens de diseño, transcritos literalmente del canvas de Claude Design
 * (`design/parlay-reference.dc.html`). No inventar valores aquí: si algo debe
 * cambiar, cambia primero en el diseño.
 *
 * Todo color existe en ambos temas. Ninguno se define sólo en uno.
 */

export interface Palette {
  /** Fondo de pantalla. */
  bg: string;
  /** Fondo del lienzo exterior, un punto más oscuro/claro. */
  bg2: string;
  ink: string;
  ink2: string;
  ink3: string;
  /** Superficie de cristal principal. */
  glass: string;
  /** Cristal secundario, para elementos anidados dentro de una tarjeta. */
  glass2: string;
  stroke: string;
  hair: string;
  accent: string;
  accent2: string;
  accentSoft: string;
  good: string;
  goodSoft: string;
  bad: string;
  badSoft: string;
  warn: string;
  warnSoft: string;
  shadow: string;
  /** Las tres burbujas del fondo. */
  bubble1: string;
  bubble2: string;
  bubble3: string;
}

export const lightPalette: Palette = {
  bg: '#F0EEE9',
  bg2: '#E6E2D9',
  ink: '#1F1E1D',
  ink2: 'rgba(31,30,29,0.62)',
  ink3: 'rgba(31,30,29,0.42)',
  glass: 'rgba(255,255,255,0.58)',
  glass2: 'rgba(255,255,255,0.38)',
  stroke: 'rgba(31,30,29,0.10)',
  hair: 'rgba(31,30,29,0.08)',
  accent: '#C15F3C',
  accent2: '#DA7756',
  accentSoft: 'rgba(193,95,60,0.12)',
  good: '#2F6B4F',
  goodSoft: 'rgba(47,107,79,0.13)',
  bad: '#A83F36',
  badSoft: 'rgba(168,63,54,0.12)',
  warn: '#8A6A1E',
  warnSoft: 'rgba(138,106,30,0.14)',
  shadow: 'rgba(31,30,29,0.10)',
  bubble1: 'rgba(218,119,86,0.55)',
  bubble2: 'rgba(120,150,190,0.42)',
  bubble3: 'rgba(160,190,160,0.38)',
};

export const darkPalette: Palette = {
  bg: '#171715',
  bg2: '#232321',
  ink: '#F4F1EC',
  ink2: 'rgba(244,241,236,0.62)',
  ink3: 'rgba(244,241,236,0.40)',
  glass: 'rgba(255,255,255,0.07)',
  glass2: 'rgba(255,255,255,0.045)',
  stroke: 'rgba(255,255,255,0.13)',
  hair: 'rgba(255,255,255,0.09)',
  accent: '#DA7756',
  accent2: '#E89272',
  accentSoft: 'rgba(218,119,86,0.16)',
  good: '#6FBF92',
  goodSoft: 'rgba(111,191,146,0.14)',
  bad: '#E5796C',
  badSoft: 'rgba(229,121,108,0.14)',
  warn: '#D8B25A',
  warnSoft: 'rgba(216,178,90,0.14)',
  shadow: 'rgba(0,0,0,0.45)',
  bubble1: 'rgba(218,119,86,0.42)',
  bubble2: 'rgba(90,130,185,0.38)',
  bubble3: 'rgba(110,160,130,0.30)',
};

/** Degradado del logo y de los acentos sólidos. */
export const BRAND_GRADIENT = ['#E89272', '#C15F3C', '#8E3F27'] as const;

/**
 * Familias tipográficas. Hanken Grotesk y Newsreader son OFL (Google Fonts),
 * así que se pueden empaquetar en el binario. Son los sustitutos que el diseño
 * eligió para Styrene y Tiempos/Copernicus, que son comerciales.
 */
export const fonts = {
  sans: 'HankenGrotesk_400Regular',
  sansMedium: 'HankenGrotesk_500Medium',
  sansSemiBold: 'HankenGrotesk_600SemiBold',
  sansBold: 'HankenGrotesk_700Bold',
  /** Para display, cifras hero y el logotipo. */
  serif: 'Newsreader_400Regular',
  serifMedium: 'Newsreader_500Medium',
} as const;

/** Escala tipográfica tal como aparece en el diseño. */
export const type = {
  /** Etiquetas de sección: 11px, 600, tracking amplio, mayúsculas. */
  overline: { fontFamily: fonts.sansSemiBold, fontSize: 11, letterSpacing: 1.43, lineHeight: 11 },
  /** Títulos de pantalla: Newsreader 30px. */
  display: { fontFamily: fonts.serifMedium, fontSize: 30, lineHeight: 33 },
  displayLarge: { fontFamily: fonts.serifMedium, fontSize: 38, lineHeight: 40 },
  /** Cifra hero del builder: 46px. */
  hero: { fontFamily: fonts.serifMedium, fontSize: 46, lineHeight: 46 },
  heroSmall: { fontFamily: fonts.serifMedium, fontSize: 26, lineHeight: 27 },
  title: { fontFamily: fonts.sansSemiBold, fontSize: 16.5, lineHeight: 21 },
  body: { fontFamily: fonts.sans, fontSize: 14.5, lineHeight: 22 },
  bodySmall: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 19 },
  caption: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16 },
  button: { fontFamily: fonts.sansSemiBold, fontSize: 16, lineHeight: 16 },
  odds: { fontFamily: fonts.sansSemiBold, fontSize: 16, lineHeight: 16 },
  pill: { fontFamily: fonts.sansSemiBold, fontSize: 12, lineHeight: 12 },
  tabLabel: { fontFamily: fonts.sansSemiBold, fontSize: 10, lineHeight: 10 },
} as const;

/** Radios del diseño. */
export const radius = {
  card: 26,
  cardLarge: 30,
  cardSmall: 24,
  input: 18,
  inner: 17,
  chip: 19,
  button: 27,
  tabBar: 33,
  tabItem: 25,
  quickOdds: 15,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 26,
  screenH: 18,
} as const;

/**
 * Altura mínima de cualquier elemento tocable. El diseño ya la respeta en
 * todas las pantallas; mantenerla aquí evita que se pierda al implementar.
 */
export const MIN_TOUCH_TARGET = 44;

/** Intensidades de desenfoque, equivalentes a los `blur()` del diseño. */
export const blur = {
  /** Tarjetas normales: blur(22px). */
  card: 22,
  /** Tarjetas hero: blur(26px) saturate(160%). */
  hero: 26,
  /** Tab bar: blur(30px) saturate(180%). */
  tabBar: 30,
  /** Inputs y chips: blur(14-18px). */
  subtle: 16,
} as const;

/** Sombras. En Android sólo `elevation` tiene efecto. */
export const shadows = {
  card: { shadowOffset: { width: 0, height: 8 }, shadowRadius: 26, shadowOpacity: 1, elevation: 4 },
  hero: { shadowOffset: { width: 0, height: 14 }, shadowRadius: 40, shadowOpacity: 1, elevation: 8 },
  button: { shadowOffset: { width: 0, height: 10 }, shadowRadius: 26, shadowOpacity: 1, elevation: 6 },
} as const;

/** Duración de las animaciones de las burbujas, en ms (17s / 21s / 25s). */
export const BUBBLE_DURATIONS = [17_000, 21_000, 25_000] as const;

/** Entrada de tarjetas: `rise` — 350ms. */
export const RISE_DURATION = 350;

export type ThemeName = 'light' | 'dark';

export interface Theme {
  name: ThemeName;
  colors: Palette;
  type: typeof type;
  radius: typeof radius;
  spacing: typeof spacing;
  blur: typeof blur;
  shadows: typeof shadows;
  fonts: typeof fonts;
  /** `dark` o `light`, para el tinte del BlurView y la barra de estado. */
  scheme: ThemeName;
}

export function buildTheme(name: ThemeName): Theme {
  return {
    name,
    scheme: name,
    colors: name === 'dark' ? darkPalette : lightPalette,
    type,
    radius,
    spacing,
    blur,
    shadows,
    fonts,
  };
}

export const themes = {
  light: buildTheme('light'),
  dark: buildTheme('dark'),
} as const;
