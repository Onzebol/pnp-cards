import { bleedRects, type BleedBand } from './bleed';
import { cardSize, rotatedImage, type Size } from './cardSize';
import { coverCrop, CROP_DPI, cropRect, type PxRect } from './crop';
import { cutLines, type CutLines } from './cutLines';
import type { Dpi } from './dpi';
import { headerPlacement, type HeaderPlacement } from './header';
import { isMirrored, layoutPage, resolveGrid, type Placement } from './layout';
import { cardRotations, slotRotation } from './rotation';
import { rulerPlacement, type RulerPlacement } from './ruler';
import {
  combineRotations,
  slotBox,
  slotCropMarks,
  slotLocalSize,
  type Rotation,
  type Template,
} from './template';
import { mmToPt } from './units';
import type { LayoutSettings } from './settings';

export interface CardSpec {
  widthPx: number;
  heightPx: number;
  dpi: Dpi | null;
  blank: boolean;
  copies: number;
  /** La carta no lleva reverso (con los reversos activados). */
  noBack?: boolean;
  /** Giro elegido para la carta (antihorario); sin él, decide el giro automático si está activado. */
  rotation?: Rotation;
}

/** Imagen del reverso común: solo hace falta su tamaño, para recortarla a cada hueco. */
export interface BackSpec {
  widthPx: number;
  heightPx: number;
}

export interface PlannedItem {
  /** Índice de la carta en la lista recibida. */
  card: number;
  placement: Placement;
  /** Parte de la imagen que se ve (en píxeles), o null si se ve entera. */
  crop: PxRect | null;
  /**
   * Giro de la carta dentro de su hueco (`placement`): el de la carta (elegido o automático), el
   * del hueco de la plantilla o el del reverso. Ausente, la carta va derecha.
   */
  rotation?: Rotation;
}

export interface PlannedPage {
  /** Número de página, desde 1. */
  number: number;
  /** Hoja a la que pertenece (contando solo las páginas de cartas), desde 1. */
  sheet: number;
  /**
   * Cartas o reversos. En una página de reversos, cada elemento es el reverso de la carta
   * `card` y su recorte es el de la imagen del reverso.
   */
  side: 'front' | 'back';
  size: Size;
  items: PlannedItem[];
  /** Bandas del margen de corte, con la carta y el lado que rellena cada una. */
  bleed: BleedBand[];
  cutLines: CutLines | null;
  /** Cabecera con el nombre y el número de hoja; solo en páginas de cartas, si cabe. */
  header: HeaderPlacement | null;
  /** Regla de comprobación; solo en la primera página de cartas (o en todas), si cabe. */
  ruler: RulerPlacement | null;
}

export interface DocumentPlan {
  pages: PlannedPage[];
  /** Cartas del documento (sin contar los reversos). */
  total: number;
  /** Páginas de cartas (sin contar las de reversos). */
  sheets: number;
  /** Índices de las cartas cuyo recorte no cabía en la imagen y se ha ajustado. */
  clampedCards: number[];
}

export type PlanErrorCode = 'empty' | 'blank-without-size' | 'no-template' | 'no-back';

export class PlanError extends Error {
  constructor(readonly code: PlanErrorCode) {
    super(code);
    this.name = 'PlanError';
  }
}

/**
 * Tamaño en puntos del hueco de cada carta, ya girada. Una imagen en blanco toma el de la carta
 * anterior (o el de la siguiente si va la primera), salvo que se fuercen ancho y alto.
 */
function cardSizes(
  settings: LayoutSettings,
  cards: CardSpec[],
  crops: (PxRect | null)[],
  rotations: Rotation[],
): Size[] {
  const own = cards.map((c, i) => {
    if (c.blank) return null;
    const crop = crops[i];
    // Una imagen recortada pasa a medir lo que el recorte, a 300 ppp (como en PDFCartas).
    const visible = crop
      ? { widthPx: crop.width, heightPx: crop.height, dpi: { x: CROP_DPI, y: CROP_DPI } }
      : c;
    return cardSize(rotatedImage(visible, rotations[i]), settings);
  });
  const forcedBoth = settings.forceWidth && settings.forceHeight;
  return own.map((size, i) => {
    if (size) return size;
    if (forcedBoth) return cardSize({ widthPx: 1, heightPx: 1, dpi: null }, settings);
    const previous = own.slice(0, i).findLast((s) => s !== null);
    const next = own.slice(i + 1).find((s) => s !== null);
    const neighbour = previous ?? next;
    if (!neighbour) throw new PlanError('blank-without-size');
    return neighbour;
  });
}

/** Separación y largo de las marcas de corte de los huecos de una plantilla (pt). */
const MARK_GAP = 1;
const MARK_LENGTH = 12;

/** Al reflejar la hoja en horizontal, un giro a la izquierda pasa a ser a la derecha. */
const MIRRORED_ROTATION: Record<Rotation, Rotation> = { 0: 0, 90: 270, 180: 180, 270: 90 };
/** Al reflejarla en vertical (volteo por el borde corto), además queda cabeza abajo. */
const FLIPPED_ROTATION: Record<Rotation, Rotation> = { 0: 180, 90: 90, 180: 0, 270: 270 };

/**
 * Página de reversos de una página de cartas: cada reverso en el hueco de su carta reflejado
 * como queda al dar la vuelta a la hoja, y recortado para llenarlo. Las cartas en blanco y las
 * marcadas sin reverso dejan su hueco vacío.
 */
function backPage(
  settings: LayoutSettings,
  front: PlannedPage,
  cards: CardSpec[],
  back: BackSpec,
): PlannedPage {
  const { width: W, height: H } = front.size;
  const long = settings.backs.flip === 'long';
  const items = front.items
    .filter((item) => !cards[item.card].blank && !cards[item.card].noBack)
    .map(({ card, placement: box, rotation }): PlannedItem => {
      const flipped = (long ? MIRRORED_ROTATION : FLIPPED_ROTATION)[rotation ?? 0];
      const local = slotLocalSize(box, flipped);
      return {
        card,
        placement: long
          ? { ...box, x: W - box.x - box.width }
          : { ...box, y: H - box.y - box.height },
        crop: coverCrop(back, local.width / local.height),
        // Sin plantilla, un reverso derecho se queda sin giro, como las cartas.
        rotation: rotation === undefined && flipped === 0 ? undefined : flipped,
      };
    });
  return {
    number: front.number + 1,
    sheet: front.sheet,
    side: 'back',
    size: front.size,
    items,
    bleed: bleedRects(
      items.map((i) => i.placement),
      settings,
      items.map((_, i) => i),
    ),
    cutLines: null,
    header: null,
    ruler: null,
  };
}

/**
 * Desplaza todo lo dibujado en una página (cartas, margen de corte y líneas de corte) `dx` y
 * `dy` puntos. Sirve para el ajuste de la impresora en las páginas de reversos.
 */
export function translatePage(page: PlannedPage, dx: number, dy: number): PlannedPage {
  if (dx === 0 && dy === 0) return page;
  return {
    ...page,
    items: page.items.map((item) => ({
      ...item,
      placement: { ...item.placement, x: item.placement.x + dx, y: item.placement.y + dy },
    })),
    bleed: page.bleed.map((b) => ({
      ...b,
      rect: { ...b.rect, x: b.rect.x + dx, y: b.rect.y + dy },
    })),
    header: page.header && {
      ...page.header,
      start: { x: page.header.start.x + dx, y: page.header.start.y + dy },
      end: { x: page.header.end.x + dx, y: page.header.end.y + dy },
    },
    ruler: page.ruler && {
      ...page.ruler,
      x: page.ruler.x + dx,
      y: page.ruler.y + dy,
      label: { ...page.ruler.label, x: page.ruler.label.x + dx, y: page.ruler.label.y + dy },
    },
    cutLines: page.cutLines && {
      ...page.cutLines,
      segments: page.cutLines.segments.map((s) => ({
        x1: s.x1 + dx,
        y1: s.y1 + dy,
        x2: s.x2 + dx,
        y2: s.y2 + dy,
      })),
    },
  };
}

/**
 * Intercala detrás de cada página de cartas su página de reversos, si están activados, con el
 * desplazamiento de la impresora (el mismo en todas las páginas de reversos).
 */
function withBacks(
  settings: LayoutSettings,
  fronts: PlannedPage[],
  cards: CardSpec[],
  back: BackSpec | null,
): PlannedPage[] {
  if (!settings.backs.enabled) return fronts;
  if (!back) throw new PlanError('no-back');
  const dx = mmToPt(settings.backOffsetMm.x);
  const dy = mmToPt(settings.backOffsetMm.y);
  return fronts.flatMap((page, i) => {
    const front = { ...page, number: 2 * i + 1 };
    return [front, translatePage(backPage(settings, front, cards, back), dx, dy)];
  });
}

/**
 * Cabecera de las páginas de cartas, si está activada y cabe. Se calcula con la página llena
 * (todos los huecos, con la carta de referencia) para que quede en el mismo sitio en todas las
 * páginas, también en la última aunque tenga menos cartas.
 */
/** Rectángulos del margen de corte para buscar sitio: aquí la carta que los rellena no importa. */
function bleedRectsForFit(settings: LayoutSettings, frame: Placement[]) {
  return bleedRects(
    frame,
    settings,
    frame.map(() => null),
  ).map((b) => b.rect);
}

function pageHeader(settings: LayoutSettings, page: Size, frame: Placement[]) {
  if (!settings.header) return null;
  return headerPlacement(page, frame, bleedRectsForFit(settings, frame));
}

/**
 * Cabecera y regla de comprobación de las páginas de cartas, calculadas con la página llena. La
 * regla evita el lado de la cabecera, y `rulerOn` dice qué páginas la llevan.
 */
function pageExtras(settings: LayoutSettings, page: Size, frame: Placement[]) {
  const header = pageHeader(settings, page, frame);
  const ruler = settings.ruler.enabled
    ? rulerPlacement(page, frame, bleedRectsForFit(settings, frame), header)
    : null;
  const rulerOn = (number: number) => (settings.ruler.allPages || number === 1 ? ruler : null);
  return { header, rulerOn };
}

/**
 * Con plantilla, cada carta va a su hueco (estirada a su tamaño y con su giro), en orden. El giro
 * de la carta (elegido o automático, según la orientación del hueco) se suma al del hueco. De
 * derecha a izquierda, los huecos se reflejan en horizontal.
 */
function planTemplate(
  settings: LayoutSettings,
  template: Template,
  sequence: number[],
  cards: CardSpec[],
  crops: (PxRect | null)[],
): PlannedPage[] {
  const { page } = resolveGrid(settings);
  const perPage = Math.max(1, template.slots.length);
  const lines = settings.cutLines;
  const gap = MARK_GAP + (settings.bleed.enabled ? mmToPt(settings.bleed.mm) : 0);
  const { header, rulerOn } = pageExtras(
    settings,
    page,
    template.slots.map((slot) => slotBox(slot, page.height)),
  );
  const pages: PlannedPage[] = [];
  for (let start = 0; start < sequence.length; start += perPage) {
    const pageCards = sequence.slice(start, start + perPage);
    const mirrored = isMirrored(settings);
    const items = pageCards.map((card, i) => {
      const box = slotBox(template.slots[i], page.height);
      const slot = template.slots[i].rotation;
      const rotation = combineRotations(
        slot,
        slotRotation(settings, cards[card], crops[card], slotLocalSize(box, slot)),
      );
      return {
        card,
        placement: mirrored ? { ...box, x: page.width - box.x - box.width } : box,
        crop: crops[card],
        rotation: mirrored ? MIRRORED_ROTATION[rotation] : rotation,
      };
    });
    const boxes = items.map((i) => i.placement);
    pages.push({
      number: pages.length + 1,
      sheet: pages.length + 1,
      side: 'front',
      size: page,
      items,
      bleed: bleedRects(
        boxes,
        settings,
        items.map((item, i) => (cards[item.card].blank ? null : i)),
      ),
      header,
      ruler: rulerOn(pages.length + 1),
      cutLines: lines.enabled
        ? {
            lineWidth: mmToPt(lines.widthHundredthsMm / 100),
            segments: boxes.flatMap((b) => slotCropMarks(b, gap, MARK_LENGTH)),
          }
        : null,
    });
  }
  return pages;
}

/**
 * Plan completo del PDF: qué carta va en cada hueco de cada página, con sus cortes y, si están
 * activados, las páginas de reversos (con la imagen `back`).
 */
export function planDocument(
  settings: LayoutSettings,
  cards: CardSpec[],
  back: BackSpec | null = null,
): DocumentPlan {
  const sequence = cards.flatMap((c, i) => Array.from({ length: Math.max(0, c.copies) }, () => i));
  if (sequence.length === 0) throw new PlanError('empty');

  const clampedCards: number[] = [];
  const crops = cards.map((c, i) => {
    if (!settings.crop.enabled || c.blank) return null;
    const { clamped, ...rect } = cropRect(c, settings.crop);
    if (clamped) clampedCards.push(i);
    return rect;
  });
  if (settings.mode === 'template') {
    const template = settings.template;
    if (!template || template.slots.length === 0) throw new PlanError('no-template');
    const fronts = planTemplate(settings, template, sequence, cards, crops);
    return {
      pages: withBacks(settings, fronts, cards, back),
      total: sequence.length,
      sheets: fronts.length,
      clampedCards,
    };
  }

  const rotations = cardRotations(settings, cards, crops);
  const sizes = cardSizes(settings, cards, crops, rotations);
  const { perPage } = resolveGrid(settings);
  const reference = sizes[sequence[0]];
  const { header, rulerOn } = pageExtras(
    settings,
    layoutPage(settings, [], reference).page,
    layoutPage(settings, Array<Size>(perPage).fill(reference), reference).placements,
  );

  const pages: PlannedPage[] = [];
  for (let start = 0; start < sequence.length; start += perPage) {
    const number = pages.length + 1;
    const pageCards = sequence.slice(start, start + perPage);
    const pageSizes = pageCards.map((i) => sizes[i]);
    const { page, placements } = layoutPage(settings, pageSizes, reference);
    const items: PlannedItem[] = pageCards.map((card, i) => ({
      card,
      placement: placements[i],
      crop: crops[card],
      // Sin giro, la carta va derecha (y su reverso también, como hasta ahora).
      ...(rotations[card] === 0 ? {} : { rotation: rotations[card] }),
    }));
    pages.push({
      number,
      sheet: number,
      side: 'front',
      size: page,
      items,
      bleed: bleedRects(
        placements,
        settings,
        items.map((item, i) => (cards[item.card].blank ? null : i)),
      ),
      cutLines: cutLines(settings, pageSizes[0], reference),
      header,
      ruler: rulerOn(number),
    });
  }

  return {
    pages: withBacks(settings, pages, cards, back),
    total: sequence.length,
    sheets: pages.length,
    clampedCards,
  };
}
