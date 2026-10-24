import {
  PDFDocument,
  StandardFonts,
  appendBezierCurve,
  clip,
  closePath,
  concatTransformationMatrix,
  degrees,
  endPath,
  fill,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setFillingRgbColor,
  setGraphicsState,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from 'pdf-lib';
import { roundedRectPath, type PathCommand } from '../lib/corners';
import { imageDrawRect } from '../lib/crop';
import type { Dpi } from '../lib/dpi';
import type { HeaderPlacement } from '../lib/header';
import { planDocument } from '../lib/plan';
import { RULER_LABEL, rulerCells, type RulerPlacement } from '../lib/ruler';
import { slotLocalSize, slotMatrix, type Rotation } from '../lib/template';
import { INK_SAVER_LIGHTEN, type LayoutSettings } from '../lib/settings';

export interface PdfCard {
  /** null en una imagen en blanco. */
  data: Blob | null;
  format: 'jpeg' | 'png';
  widthPx: number;
  heightPx: number;
  dpi: Dpi | null;
  copies: number;
  /** La carta no lleva reverso (con los reversos activados). */
  noBack?: boolean;
  /** Giro elegido para la carta (antihorario). */
  rotation?: Rotation;
}

/** Imagen del reverso común: se ajusta a cada hueco, así que no importan sus ppp. */
export interface PdfBack {
  data: Blob;
  format: 'jpeg' | 'png';
  widthPx: number;
  heightPx: number;
}

/** Textos de la cabecera (ya traducidos): el nombre y el rótulo del número de hoja. */
export interface HeaderTexts {
  name: string;
  /** Con «{{n}}» y «{{total}}», que se sustituyen en cada página. */
  pageLabel: string;
}

export interface BuildInput {
  settings: LayoutSettings;
  cards: PdfCard[];
  /** Obligatorio con los reversos activados. */
  back?: PdfBack | null;
  title?: string;
  /** Obligatorio con la cabecera activada (`settings.header`). */
  header?: HeaderTexts | null;
}

export type ProgressHandler = (done: number, total: number) => void;

const HEADER_COLOR = rgb(0.48, 0.48, 0.48);

/** Sustituye por «?» los caracteres que la fuente no puede codificar (Helvetica solo tiene WinAnsi). */
function encodable(text: string, font: PDFFont) {
  return [...text.normalize('NFC')]
    .map((ch) => {
      try {
        font.encodeText(ch);
        return ch;
      } catch {
        return '?';
      }
    })
    .join('');
}

/**
 * Cabecera de una página: el nombre desde `start` y el número de hoja terminando en `end`,
 * sobre la misma línea base; en el lateral, girados 90° (y entonces el ancho del texto corre
 * hacia arriba).
 */
function drawHeader(
  page: PDFPage,
  font: PDFFont,
  placement: HeaderPlacement,
  name: string,
  label: string,
) {
  const { size, rotation, start, end } = placement;
  const common = { size, font, color: HEADER_COLOR, rotate: degrees(rotation) };
  page.drawText(name, { ...common, x: start.x, y: start.y });
  const width = font.widthOfTextAtSize(label, size);
  page.drawText(label, {
    ...common,
    x: rotation === 90 ? end.x : end.x - width,
    y: rotation === 90 ? end.y - width : end.y,
  });
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Grosor del contorno de la regla de comprobación (pt). */
const RULER_BORDER = 0.4;

/**
 * Regla de comprobación: el contorno de la barra, sus casillas rellenas (una de cada dos) y el
 * rótulo a la derecha, todo en el color de las líneas de corte.
 */
function drawRuler(page: PDFPage, font: PDFFont, ruler: RulerPlacement, color: RGB) {
  const { x, y, width, height, label } = ruler;
  page.drawRectangle({ x, y, width, height, borderColor: color, borderWidth: RULER_BORDER });
  for (const cell of rulerCells(ruler)) page.drawRectangle({ ...cell, color });
  page.drawText(RULER_LABEL, { x: label.x, y: label.y, size: label.size, font, color });
}

/**
 * Ahorro de tinta sobre los huecos con carta: un gris con fusión «Saturation» (que la deja en
 * escala de grises con la misma luminosidad) y encima un blanco semitransparente que la aclara.
 * Las imágenes no se tocan. Son transparencias de PDF 1.4; pdf-lib no conoce ese modo de fusión,
 * así que el estado gráfico se crea a mano.
 */
function drawInkSaver(page: PDFPage, rects: Rect[]) {
  if (rects.length === 0) return;
  const layers = [
    { state: { BM: 'Saturation', ca: 1 }, gray: 0.5 },
    { state: { BM: 'Normal', ca: INK_SAVER_LIGHTEN }, gray: 1 },
  ];
  for (const { state, gray } of layers) {
    const key = page.node.newExtGState('GS', page.doc.context.obj({ Type: 'ExtGState', ...state }));
    page.pushOperators(
      pushGraphicsState(),
      setGraphicsState(key),
      setFillingRgbColor(gray, gray, gray),
      ...rects.map((r) => rectangle(r.x, r.y, r.width, r.height)),
      fill(),
      popGraphicsState(),
    );
  }
}

function pathOperator(c: PathCommand) {
  switch (c.op) {
    case 'move':
      return moveTo(c.x, c.y);
    case 'line':
      return lineTo(c.x, c.y);
    case 'curve':
      return appendBezierCurve(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    case 'close':
      return closePath();
  }
}

/** Operadores que recortan lo que se dibuje después al hueco, con las esquinas redondeadas si hay radio. */
function clipTo(rect: Rect, radius: number) {
  const outline =
    radius > 0
      ? roundedRectPath(rect, radius).map(pathOperator)
      : [rectangle(rect.x, rect.y, rect.width, rect.height)];
  return [...outline, clip(), endPath()];
}

function hexToRgb(hex: string) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = [...h].map((d) => d + d).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255);
}

/**
 * Genera el PDF de cartas. Cada imagen se incrusta una sola vez y se reutiliza en todas sus
 * copias; JPG y PNG van tal cual, sin volver a codificarlos, también al recortar.
 */
export async function buildPdf(
  input: BuildInput,
  onProgress?: ProgressHandler,
): Promise<Uint8Array> {
  const { settings, cards, back = null } = input;
  const plan = planDocument(
    settings,
    cards.map((c) => ({ ...c, blank: c.data === null })),
    back,
  );

  const doc = await PDFDocument.create();
  doc.setCreator('PnP Cards');
  doc.setProducer('PnP Cards (pdf-lib)');
  if (input.title) doc.setTitle(input.title);

  const embedded = new Map<PdfCard | PdfBack, PDFImage>();
  async function image(source: PdfCard | PdfBack): Promise<PDFImage | null> {
    if (!source.data) return null;
    let img = embedded.get(source);
    if (!img) {
      const bytes = new Uint8Array(await source.data.arrayBuffer());
      img = source.format === 'jpeg' ? await doc.embedJpg(bytes) : await doc.embedPng(bytes);
      embedded.set(source, img);
    }
    return img;
  }

  const bleedColor = hexToRgb(settings.bleed.color);
  const lineColor = hexToRgb(settings.cutLines.color);
  // La fuente solo se incrusta si alguna página lleva cabecera o regla.
  const needsFont = plan.pages.some((p) => (input.header && p.header !== null) || p.ruler !== null);
  const font = needsFont ? await doc.embedFont(StandardFonts.Helvetica) : null;
  const header = font && input.header ? { font, texts: input.header } : null;
  const headerName = header ? encodable(header.texts.name, header.font) : '';
  let done = 0;

  for (const planned of plan.pages) {
    const page: PDFPage = doc.addPage([planned.size.width, planned.size.height]);

    // El margen de corte va debajo de las cartas.
    for (const r of planned.bleed) {
      page.drawRectangle({ ...r, color: bleedColor });
    }

    // En una página de reversos, cada hueco lleva la imagen del reverso con su propio recorte.
    const isBack = planned.side === 'back';
    const radius = planned.cornerRadius;
    const drawn: Rect[] = [];
    for (const { card, placement, crop, rotation } of planned.items) {
      const source = isBack ? back! : cards[card];
      const img = await image(source);
      if (img) drawn.push(placement);
      if (img && rotation !== undefined) {
        // Carta girada (por plantilla, por su giro o en un reverso): se recorta al hueco (con
        // sus esquinas redondeadas, que son las mismas gire como gire) y se gira el sistema de
        // coordenadas; dentro, la carta se dibuja sin girar (y con su recorte, si lo hay) de
        // 0,0 a su tamaño.
        const local = { x: 0, y: 0, ...slotLocalSize(placement, rotation) };
        const [a, b, c, d, e, f] = slotMatrix(placement, rotation);
        page.pushOperators(
          pushGraphicsState(),
          ...clipTo(placement, radius),
          concatTransformationMatrix(a, b, c, d, e, f),
        );
        page.drawImage(img, crop ? imageDrawRect(local, crop, source) : local);
        page.pushOperators(popGraphicsState());
      } else if (img && (crop || radius > 0)) {
        // Se dibuja la imagen entera y una máscara del tamaño del hueco (redondeada, si toca)
        // oculta lo recortado.
        page.pushOperators(pushGraphicsState(), ...clipTo(placement, radius));
        page.drawImage(img, crop ? imageDrawRect(placement, crop, source) : placement);
        page.pushOperators(popGraphicsState());
      } else if (img) {
        page.drawImage(img, placement);
      }
      if (isBack) continue;
      done += 1;
      onProgress?.(done, plan.total);
    }
    if (settings.inkSaver) drawInkSaver(page, drawn);

    if (planned.header && header) {
      const label = header.texts.pageLabel
        .replace('{{n}}', String(planned.sheet))
        .replace('{{total}}', String(plan.sheets));
      drawHeader(page, header.font, planned.header, headerName, encodable(label, header.font));
    }
    if (planned.ruler && font) drawRuler(page, font, planned.ruler, lineColor);

    if (planned.cutLines) {
      const thickness = planned.cutLines.lineWidth;
      for (const s of planned.cutLines.segments) {
        page.drawLine({
          start: { x: s.x1, y: s.y1 },
          end: { x: s.x2, y: s.y2 },
          thickness,
          color: lineColor,
        });
      }
    }
  }

  return doc.save();
}
