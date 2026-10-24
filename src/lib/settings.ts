import { normalizeTemplate, type Template } from './template';

export type LayoutMode = 'vertical9' | 'horizontal8' | 'manual' | 'template';
export type PaperSize = 'A4' | 'A3' | 'custom';
export type Placement = 'separated' | 'together';
export type CutLineStyle = 'normal' | 'full' | 'cross';
/** Por dónde se da la vuelta al papel al imprimir a doble cara. */
export type BackFlip = 'long' | 'short';
/** Cómo se rellena el margen de corte: color plano o a partir de la propia carta. */
export type BleedFill = 'color' | 'stretch' | 'mirror';

export interface CropSettings {
  enabled: boolean;
  /** Tamaño del recorte en mm; se convierte a píxeles a 300 ppp. */
  widthMm: number;
  heightMm: number;
  centered: boolean;
  /** Posición en píxeles cuando no está centrado. */
  x: number;
  y: number;
}

export interface LayoutSettings {
  mode: LayoutMode;
  /** Solo en modo manual. */
  paper: PaperSize;
  landscape: boolean;
  columns: number;
  rows: number;
  customPageMm: { width: number; height: number };

  placement: Placement;
  /** Margen de la página en mm (solo con cartas separadas). */
  marginMm: number;
  rightToLeft: boolean;
  /**
   * Páginas de reversos detrás de cada página de cartas, en espejo. La imagen del reverso va con
   * las cartas, no aquí.
   */
  backs: { enabled: boolean; flip: BackFlip };
  /**
   * Ajuste de la impresora: cuánto se desplaza todo lo dibujado en las páginas de reversos, en
   * mm, a la derecha (x) y hacia arriba (y) de la página tal como sale de la impresora. Es de
   * la impresora, no del proyecto: al abrir un proyecto o restablecer los ajustes se conserva.
   */
  backOffsetMm: { x: number; y: number };
  /** Nombre del proyecto y número de página en el hueco libre de cada página de cartas. */
  header: boolean;
  /**
   * Regla de comprobación: barra de 50 mm en el margen de la primera página de cartas (o de
   * todas), para ver con una regla si la impresora escala la página.
   */
  ruler: { enabled: boolean; allPages: boolean };
  /**
   * Ahorro de tinta: cartas y reversos en escala de grises y aclarados, para pruebas de juego.
   * No afecta a las líneas de corte ni al margen de corte.
   */
  inkSaver: boolean;

  forceWidth: boolean;
  forceHeight: boolean;
  cardWidthMm: number;
  cardHeightMm: number;
  /**
   * Girar las cartas horizontales: una carta sin giro propio cuya orientación no es la de la
   * distribución (el tamaño forzado, el hueco de la plantilla o la mayoría de las cartas) se gira
   * un cuarto de vuelta para que quepa en su hueco.
   */
  autoRotate: boolean;

  crop: CropSettings;

  cutLines: {
    enabled: boolean;
    style: CutLineStyle;
    color: string;
    /** Grosor en centésimas de mm. */
    widthHundredthsMm: number;
  };
  bleed: {
    enabled: boolean;
    mm: number;
    /** Color plano de las bandas: el modo «color» y las cartas en blanco. */
    color: string;
    /** Relleno: color plano, repetir el borde de la carta o copiarlo en espejo. */
    fill: BleedFill;
  };
  /** Plantilla en uso en el modo «template» (una copia, para que viaje con el proyecto). */
  template: Template | null;
}

/** Valores por defecto de PDFCartas (My Project/Settings.settings). */
export const DEFAULT_SETTINGS: LayoutSettings = {
  mode: 'vertical9',
  paper: 'A4',
  landscape: false,
  columns: 3,
  rows: 3,
  customPageMm: { width: 210, height: 297 },
  placement: 'separated',
  marginMm: 8,
  rightToLeft: false,
  backs: { enabled: false, flip: 'long' },
  backOffsetMm: { x: 0, y: 0 },
  header: false,
  ruler: { enabled: false, allPages: false },
  inkSaver: false,
  forceWidth: false,
  forceHeight: false,
  cardWidthMm: 0,
  cardHeightMm: 0,
  autoRotate: false,
  crop: { enabled: false, widthMm: 0, heightMm: 0, centered: true, x: 0, y: 0 },
  cutLines: { enabled: false, style: 'normal', color: '#000000', widthHundredthsMm: 4 },
  bleed: { enabled: false, mm: 2, color: '#ffffff', fill: 'color' },
  template: null,
};

/**
 * Cuánto se aclaran las cartas con el ahorro de tinta: una capa blanca con esta opacidad sobre la
 * carta ya en escala de grises (el blanco se queda blanco y el negro pasa a este gris). Lo usan el
 * PDF y la vista previa.
 */
export const INK_SAVER_LIGHTEN = 0.5;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };

/** Completa una configuración guardada (quizá de una versión anterior) con los valores por defecto. */
export function mergeSettings(saved: DeepPartial<LayoutSettings> | undefined): LayoutSettings {
  const d = DEFAULT_SETTINGS;
  // `duplex` (doble cara manual, de PDFCartas) ya no existe: los reversos se generan solos.
  const rest: DeepPartial<LayoutSettings> & { duplex?: unknown } = { ...saved };
  delete rest.duplex;
  return {
    ...d,
    ...rest,
    backs: { ...d.backs, ...saved?.backs },
    backOffsetMm: { ...d.backOffsetMm, ...saved?.backOffsetMm },
    ruler: { ...d.ruler, ...saved?.ruler },
    customPageMm: { ...d.customPageMm, ...saved?.customPageMm },
    crop: { ...d.crop, ...saved?.crop },
    cutLines: { ...d.cutLines, ...saved?.cutLines },
    bleed: { ...d.bleed, ...saved?.bleed },
    template: saved?.template
      ? normalizeTemplate(saved.template as unknown as Record<string, unknown>, saved.template.id)
      : null,
  };
}
