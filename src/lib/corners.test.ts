import { DEFAULT_SETTINGS } from './settings';
import { cornerRadius, roundedRectPath } from './corners';

describe('cornerRadius', () => {
  it('sin esquinas redondeadas es 0', () => {
    expect(cornerRadius(DEFAULT_SETTINGS)).toBe(0);
  });

  it('convierte el radio de mm a puntos: 3 mm son 3 × 72 / 25,4 pt', () => {
    const settings = { ...DEFAULT_SETTINGS, corners: { rounded: true, radiusMm: 3 } };
    expect(cornerRadius(settings)).toBeCloseTo(8.503937, 5);
  });

  it('un radio de 0 o negativo no redondea', () => {
    expect(cornerRadius({ ...DEFAULT_SETTINGS, corners: { rounded: true, radiusMm: 0 } })).toBe(0);
    expect(cornerRadius({ ...DEFAULT_SETTINGS, corners: { rounded: true, radiusMm: -1 } })).toBe(0);
  });
});

describe('roundedRectPath', () => {
  const rect = { x: 0, y: 0, width: 10, height: 20 };

  it('recorre el rectángulo desde abajo, en sentido antihorario, con un arco por esquina', () => {
    // k = radio × 0,5522847498 (distancia de los puntos de control de un cuarto de circunferencia).
    const k = 1.1045695;
    const path = roundedRectPath(rect, 2);
    expect(path).toHaveLength(10);
    expect(path[0]).toEqual({ op: 'move', x: 2, y: 0 });
    expect(path[1]).toEqual({ op: 'line', x: 8, y: 0 });
    expect(path[2]).toMatchObject({ op: 'curve', x: 10, y: 2 });
    const c = path[2] as { x1: number; y1: number; x2: number; y2: number };
    expect(c.x1).toBeCloseTo(8 + k, 6);
    expect(c.y1).toBe(0);
    expect(c.x2).toBe(10);
    expect(c.y2).toBeCloseTo(2 - k, 6);
    expect(path[3]).toEqual({ op: 'line', x: 10, y: 18 });
    expect(path[4]).toMatchObject({ op: 'curve', x: 8, y: 20 });
    expect(path[5]).toEqual({ op: 'line', x: 2, y: 20 });
    expect(path[6]).toMatchObject({ op: 'curve', x: 0, y: 18 });
    expect(path[7]).toEqual({ op: 'line', x: 0, y: 2 });
    expect(path[8]).toMatchObject({ op: 'curve', x: 2, y: 0 });
    expect(path[9]).toEqual({ op: 'close' });
  });

  it('respeta la posición del rectángulo', () => {
    const path = roundedRectPath({ x: 100, y: 50, width: 10, height: 20 }, 2);
    expect(path[0]).toEqual({ op: 'move', x: 102, y: 50 });
    expect(path[3]).toEqual({ op: 'line', x: 110, y: 68 });
  });

  it('limita el radio a la mitad del lado menor', () => {
    const path = roundedRectPath(rect, 8);
    // Radio 5: el borde inferior queda reducido a un punto (de 5 a 5).
    expect(path[0]).toEqual({ op: 'move', x: 5, y: 0 });
    expect(path[1]).toEqual({ op: 'line', x: 5, y: 0 });
    expect(path[3]).toEqual({ op: 'line', x: 10, y: 15 });
  });
});
