import type { PxRect } from './crop';
import type { Placement } from './layout';
import type { BleedFill, LayoutSettings } from './settings';
import { multiplyMatrix, type Rotation } from './template';
import { mmToPt } from './units';

export type Rect = Placement;

/** Bordes de la carta que rellenan una banda, vistos desde la página. */
export type BleedEdge = 'left' | 'right' | 'bottom' | 'top';
/** Los cuatro bordes y las cuatro esquinas. */
export type BleedSide = BleedEdge | `${'bottom' | 'top'}-${'left' | 'right'}`;

/**
 * Una banda del margen de corte: su rectángulo y de dónde sale su relleno. Con el modo «color»
 * (y con las cartas en blanco) `card` es null y se pintan de color plano; con «stretch» y
 * «mirror» cada banda lleva la carta que la llena y el lado suyo que la rellena.
 */
export interface BleedBand {
  /** Rectángulo de la banda en puntos PDF (origen abajo a la izquierda). */
  rect: Placement;
  /** Carta que llena la banda (índice del hueco en la página); null: color plano. */
  card: number | null;
  /** Lado o esquina de la carta sobre el que queda la banda. */
  side: BleedSide;
}

/** El borde vertical y el horizontal de un lado, o null si el lado no toca ese eje. */
function sidesOf(side: BleedSide): {
  x: 'left' | 'right' | null;
  y: 'bottom' | 'top' | null;
} {
  const parts = side.split('-');
  return {
    x: parts.includes('left') ? 'left' : parts.includes('right') ? 'right' : null,
    y: parts.includes('bottom') ? 'bottom' : parts.includes('top') ? 'top' : null,
  };
}

/**
 * Lado de la imagen sin girar que rellena una banda del lado de página dado: con la carta girada,
 * el borde de la imagen queda en otro lado del hueco.
 */
const LOCAL_SIDE: Record<Rotation, Record<BleedEdge, BleedEdge>> = {
  0: { left: 'left', right: 'right', bottom: 'bottom', top: 'top' },
  // Un cuarto de vuelta antihorario: el borde izquierdo de la imagen queda abajo en la página.
  90: { left: 'top', right: 'bottom', bottom: 'left', top: 'right' },
  180: { left: 'right', right: 'left', bottom: 'top', top: 'bottom' },
  // Tres cuartos: el borde izquierdo de la imagen queda arriba en la página.
  270: { left: 'bottom', right: 'top', bottom: 'right', top: 'left' },
};

export function bleedLocalSide(side: BleedSide, rotation: Rotation): BleedSide {
  const local = LOCAL_SIDE[rotation];
  const mapped = side.split('-').map((edge) => local[edge as BleedEdge]);
  const x = mapped.find((e) => e === 'left' || e === 'right');
  const y = mapped.find((e) => e === 'bottom' || e === 'top');
  return (x && y ? `${y}-${x}` : mapped[0]) as BleedSide;
}

/**
 * La banda en el marco de la imagen sin girar: el lado se traduce con `bleedLocalSide` y, con la
 * carta girada un cuarto de vuelta, el ancho y el alto de la banda se intercambian (el borde
 * corre por un lado en la página y por el otro en la imagen; las esquinas, cuadradas, no
 * cambian). De la banda devuelta solo se usan su lado y el ancho y el alto del rectángulo.
 */
export function bleedLocalBand(band: BleedBand, rotation: Rotation): BleedBand {
  const swap = rotation === 90 || rotation === 270;
  const { rect } = band;
  return {
    ...band,
    side: bleedLocalSide(band.side, rotation),
    rect: swap ? { ...rect, width: rect.height, height: rect.width } : rect,
  };
}

/** Modo efectivo de las bandas con carta: «color» no llega nunca aquí (esas van de color plano). */
export function bleedImageFill(fill: BleedFill): 'stretch' | 'mirror' {
  return fill === 'stretch' ? 'stretch' : 'mirror';
}

/** El ancho de las bandas, en puntos. */
function bleedSize(settings: LayoutSettings) {
  return mmToPt(settings.bleed.mm);
}

/**
 * Rectángulos del margen de corte (sangrado): cuatro bandas alrededor de cada carta (más las
 * cuatro esquinas, con relleno de imagen, que necesitan la esquina de la carta cada una). Se
 * dibujan antes que las imágenes, para que queden debajo. `sources` da, para cada hueco, la
 * carta que lo rellena (o null si va en color plano: modo «color» o carta en blanco).
 */
export function bleedRects(
  placements: Placement[],
  settings: LayoutSettings,
  sources?: (number | null)[],
): BleedBand[] {
  if (!settings.bleed.enabled) return [];
  const z = bleedSize(settings);
  const filled = settings.bleed.fill !== 'color';
  return placements.flatMap((placement, i) => {
    const source = sources?.[i];
    const card = filled ? (source === undefined ? i : source) : null;
    const { x, y, width: w, height: h } = placement;
    if (card === null) {
      return [
        { rect: { x: x - z, y: y - z, width: z, height: h + 2 * z }, card: null, side: 'left' },
        { rect: { x: x + w, y: y - z, width: z, height: h + 2 * z }, card: null, side: 'right' },
        { rect: { x, y: y - z, width: w, height: z }, card: null, side: 'bottom' },
        { rect: { x, y: y + h, width: w, height: z }, card: null, side: 'top' },
      ] as BleedBand[];
    }
    // Con relleno de imagen, los bordes no invaden las esquinas: cada una va aparte, con su
    // propia esquina de la carta.
    return [
      { rect: { x: x - z, y, width: z, height: h }, card, side: 'left' },
      { rect: { x: x + w, y, width: z, height: h }, card, side: 'right' },
      { rect: { x, y: y - z, width: w, height: z }, card, side: 'bottom' },
      { rect: { x, y: y + h, width: w, height: z }, card, side: 'top' },
      { rect: { x: x - z, y: y - z, width: z, height: z }, card, side: 'bottom-left' },
      { rect: { x: x + w, y: y - z, width: z, height: z }, card, side: 'bottom-right' },
      { rect: { x: x - z, y: y + h, width: z, height: z }, card, side: 'top-left' },
      { rect: { x: x + w, y: y + h, width: z, height: z }, card, side: 'top-right' },
    ] as BleedBand[];
  });
}

/**
 * Tamaño en puntos de un píxel de la zona visible de la imagen en su hueco: del recorte si lo
 * hay (el borde que se ve es el de la zona recortada, no el de la imagen entera), de la imagen
 * entera si no.
 */
export function bleedPixel(
  local: Placement,
  crop: PxRect | null,
  image: { widthPx: number; heightPx: number },
): { x: number; y: number } {
  return {
    x: local.width / (crop ? crop.width : image.widthPx),
    y: local.height / (crop ? crop.height : image.heightPx),
  };
}

/**
 * Matriz [a b c d e f] que, dentro del recorte de la banda, lleva la imagen de la carta al
 * relleno de la banda: «mirror» la refleja sobre el borde de la caja y «stretch» estira su
 * última fila o columna (de `px` puntos) hasta cubrir la banda, anclada en ese mismo borde.
 * `box` es la caja de la carta en el marco en que se dibuja la imagen (el hueco, o el hueco
 * local si la carta está girada).
 */
export function bleedBandMatrix(
  band: Pick<BleedBand, 'rect' | 'side'>,
  box: Placement,
  mode: 'stretch' | 'mirror',
  px: { x: number; y: number },
): number[] {
  const { x: xa, y: ya } = sidesOf(band.side);
  const anchorX = xa === 'right' ? box.x + box.width : box.x;
  const anchorY = ya === 'top' ? box.y + box.height : box.y;
  // «mirror» es el caso s = 1 del estirado: copia el borde tal cual, hacia fuera.
  const fx = xa ? (mode === 'mirror' ? 1 : band.rect.width / px.x) : null;
  const fy = ya ? (mode === 'mirror' ? 1 : band.rect.height / px.y) : null;
  // Cada eje: reflejo-estirado sobre su ancla (x' = (1 + s)·A − s·x), o identidad.
  const axis = (s: number | null, anchor: number): [number, number] =>
    s === null ? [1, 0] : [-s, (1 + s) * anchor];
  const [ax, ex] = axis(fx, anchorX);
  const [ay, ey] = axis(fy, anchorY);
  return [ax, 0, 0, ay, ex, ey];
}

/**
 * La misma matriz en el espacio de la vista previa (y hacia abajo), dentro del marco local de la
 * caja: la misma colocación que en el PDF, para que no difieran.
 */
export function bleedBandSvgMatrix(
  band: Pick<BleedBand, 'rect' | 'side'>,
  box: Placement,
  mode: 'stretch' | 'mirror',
  px: { x: number; y: number },
): number[] {
  const flip = [1, 0, 0, -1, 0, box.height];
  return multiplyMatrix(flip, multiplyMatrix(bleedBandMatrix(band, box, mode, px), flip));
}
