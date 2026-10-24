import type { Segment } from './cutLines';
import { layoutPage, resolveGrid, type Placement } from './layout';
import type { LayoutSettings } from './settings';
import { mmToPt, ptToMm } from './units';

export type Rotation = 0 | 90 | 180 | 270;
export const ROTATIONS: Rotation[] = [0, 90, 180, 270];

/** Suma de dos giros antihorarios (el del hueco y el de la carta, por ejemplo). */
export function combineRotations(a: Rotation, b: Rotation): Rotation {
  return ((a + b) % 360) as Rotation;
}

/** Hueco de una plantilla, en mm desde la esquina superior izquierda de la página. */
export interface TemplateSlot {
  id: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** Giro de la carta dentro del hueco, en sentido antihorario (como en PDFCartas). */
  rotation: Rotation;
}

export interface Template {
  id: string;
  name: string;
  pageMm: { width: number; height: number };
  /** En orden de relleno: la primera carta va al primer hueco. */
  slots: TemplateSlot[];
}

export const TEMPLATE_EXTENSION = '.pnptemplate';
const FORMAT = 'pnp-cards-template';
const VERSION = 1;

/** Rectángulo del hueco en puntos PDF (origen abajo a la izquierda). */
export function slotBox(slot: TemplateSlot, pageHeightPt: number): Placement {
  const width = mmToPt(slot.widthMm);
  const height = mmToPt(slot.heightMm);
  return { x: mmToPt(slot.xMm), y: pageHeightPt - mmToPt(slot.yMm) - height, width, height };
}

/** Tamaño de la carta antes de girarla para que llene el hueco. */
export function slotLocalSize(box: Placement, rotation: Rotation) {
  return rotation === 90 || rotation === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height };
}

/**
 * Matriz PDF [a b c d e f] que lleva la carta (de 0,0 a su tamaño sin girar) a su hueco, girada
 * en sentido antihorario.
 */
export function slotMatrix(box: Placement, rotation: Rotation): number[] {
  const { x, y, width: w, height: h } = box;
  switch (rotation) {
    case 90:
      return [0, 1, -1, 0, x + w, y];
    case 180:
      return [-1, 0, 0, -1, x + w, y + h];
    case 270:
      return [0, -1, 1, 0, x, y + h];
    default:
      return [1, 0, 0, 1, x, y];
  }
}

/** Producto de matrices afines [a b c d e f]: primero n y luego m. */
export function multiplyMatrix(m: number[], n: number[]): number[] {
  const [a, b, c, d, e, f] = m;
  const [a2, b2, c2, d2, e2, f2] = n;
  return [
    a * a2 + c * b2,
    b * a2 + d * b2,
    a * c2 + c * d2,
    b * c2 + d * d2,
    a * e2 + c * f2 + e,
    b * e2 + d * f2 + f,
  ];
}

/**
 * Matriz SVG (Y hacia abajo) que lleva la carta, dibujada de 0,0 a su tamaño, a su hueco: la misma
 * colocación que en el PDF, para la vista previa.
 */
export function slotSvgMatrix(box: Placement, rotation: Rotation, pageHeightPt: number): number[] {
  const local = slotLocalSize(box, rotation);
  const flipLocal = [1, 0, 0, -1, 0, local.height];
  const flipPage = [1, 0, 0, -1, 0, pageHeightPt];
  return multiplyMatrix(flipPage, multiplyMatrix(slotMatrix(box, rotation), flipLocal));
}

/** Marcas de corte de un hueco: dos por esquina, por fuera, separadas `gap` y de largo `length`. */
export function slotCropMarks(box: Placement, gap: number, length: number): Segment[] {
  const { x, y, width: w, height: h } = box;
  const marks: Segment[] = [];
  for (const [cx, sx] of [
    [x, -1],
    [x + w, 1],
  ]) {
    for (const [cy, sy] of [
      [y, -1],
      [y + h, 1],
    ]) {
      marks.push({ x1: cx + sx * gap, y1: cy, x2: cx + sx * (gap + length), y2: cy });
      marks.push({ x1: cx, y1: cy + sy * gap, x2: cx, y2: cy + sy * (gap + length) });
    }
  }
  return marks;
}

/** Tamaño de página en mm de la distribución actual (A4 y A3 con sus medidas exactas). */
function pageSizeMm(settings: LayoutSettings) {
  const portrait =
    settings.mode === 'manual' && settings.paper === 'custom'
      ? settings.customPageMm
      : settings.mode === 'manual' && settings.paper === 'A3'
        ? { width: 297, height: 420 }
        : { width: 210, height: 297 };
  const landscape =
    settings.mode === 'horizontal8' || (settings.mode === 'manual' && settings.landscape);
  return landscape ? { width: portrait.height, height: portrait.width } : { ...portrait };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Plantilla con los huecos de la distribución actual, para retocarla. */
export function templateFromLayout(
  settings: LayoutSettings,
  card: { widthMm: number; heightMm: number },
  name: string,
): Template {
  // Desde el modo plantilla se parte de la distribución por defecto.
  const base: LayoutSettings = {
    ...settings,
    mode: settings.mode === 'template' ? 'vertical9' : settings.mode,
  };
  const grid = resolveGrid(base);
  const size = { width: mmToPt(card.widthMm), height: mmToPt(card.heightMm) };
  const { placements } = layoutPage(
    base,
    Array.from({ length: grid.perPage }, () => size),
  );
  return {
    id: crypto.randomUUID(),
    name,
    pageMm: pageSizeMm(base),
    slots: placements.map((p) => ({
      id: crypto.randomUUID(),
      xMm: round(ptToMm(p.x)),
      yMm: round(ptToMm(grid.page.height - p.y - p.height)),
      widthMm: card.widthMm,
      heightMm: card.heightMm,
      rotation: 0,
    })),
  };
}

export function serializeTemplate(t: Template): string {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      name: t.name,
      pageMm: t.pageMm,
      slots: t.slots.map(({ xMm, yMm, widthMm, heightMm, rotation }) => ({
        xMm,
        yMm,
        widthMm,
        heightMm,
        rotation,
      })),
    },
    null,
    2,
  );
}

const positive = (v: unknown, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const finite = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Lee una plantilla (.pnptemplate, o la guardada en un proyecto) y corrige valores no válidos. */
export function normalizeTemplate(
  raw: Record<string, unknown>,
  id: string = crypto.randomUUID(),
): Template {
  const page = (raw.pageMm ?? {}) as Record<string, unknown>;
  const slots = Array.isArray(raw.slots) ? (raw.slots as Record<string, unknown>[]) : [];
  return {
    id,
    name: typeof raw.name === 'string' ? raw.name : '',
    pageMm: { width: positive(page.width, 210), height: positive(page.height, 297) },
    slots: slots.map((s) => ({
      id: crypto.randomUUID(),
      xMm: finite(s.xMm),
      yMm: finite(s.yMm),
      widthMm: positive(s.widthMm, 1),
      heightMm: positive(s.heightMm, 1),
      rotation: ROTATIONS.includes(s.rotation as Rotation) ? (s.rotation as Rotation) : 0,
    })),
  };
}

export function parseTemplateFile(text: string): Template {
  const json = JSON.parse(text) as Record<string, unknown>;
  if (
    !json ||
    json.format !== FORMAT ||
    typeof json.version !== 'number' ||
    json.version > VERSION
  ) {
    throw new Error('invalid-template');
  }
  return normalizeTemplate(json);
}
