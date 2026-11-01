import type { Rect } from './bleed';
import type { LayoutSettings } from './settings';
import { mmToPt } from './units';

/** Radio de las esquinas de las cartas en puntos, o 0 si no se redondean. */
export function cornerRadius(settings: LayoutSettings): number {
  const { rounded, radiusMm } = settings.corners;
  return rounded && radiusMm > 0 ? mmToPt(radiusMm) : 0;
}

/** Distancia de los puntos de control que aproximan un cuarto de circunferencia con una Bézier. */
const KAPPA = 0.5522847498;

export type PathCommand =
  | { op: 'move'; x: number; y: number }
  | { op: 'line'; x: number; y: number }
  | { op: 'curve'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'close' };

/**
 * Contorno de un rectángulo con las esquinas redondeadas, en el sistema de coordenadas del PDF
 * (origen abajo a la izquierda): empieza en el borde inferior y recorre el rectángulo en sentido
 * antihorario, con un arco de Bézier en cada esquina. El radio se limita a la mitad del lado
 * menor. Lo usan el PDF (como trazado de recorte) y la vista previa.
 */
export function roundedRectPath(rect: Rect, radius: number): PathCommand[] {
  const { x, y, width: w, height: h } = rect;
  const r = Math.min(radius, w / 2, h / 2);
  const k = r * KAPPA;
  return [
    { op: 'move', x: x + r, y },
    { op: 'line', x: x + w - r, y },
    { op: 'curve', x1: x + w - r + k, y1: y, x2: x + w, y2: y + r - k, x: x + w, y: y + r },
    { op: 'line', x: x + w, y: y + h - r },
    {
      op: 'curve',
      x1: x + w,
      y1: y + h - r + k,
      x2: x + w - r + k,
      y2: y + h,
      x: x + w - r,
      y: y + h,
    },
    { op: 'line', x: x + r, y: y + h },
    { op: 'curve', x1: x + r - k, y1: y + h, x2: x, y2: y + h - r + k, x, y: y + h - r },
    { op: 'line', x, y: y + r },
    { op: 'curve', x1: x, y1: y + r - k, x2: x + r - k, y2: y, x: x + r, y },
    { op: 'close' },
  ];
}
