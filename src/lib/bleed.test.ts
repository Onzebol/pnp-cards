import {
  bleedBandMatrix,
  bleedBandSvgMatrix,
  bleedLocalBand,
  bleedLocalSide,
  bleedPixel,
  bleedRects,
  type BleedBand,
  type BleedSide,
} from './bleed';
import { DEFAULT_SETTINGS } from './settings';
import { mmToPt } from './units';

const on = (fill: 'color' | 'stretch' | 'mirror', mm = 2) => ({
  ...DEFAULT_SETTINGS,
  bleed: { enabled: true, mm, color: '#fff', fill },
});

// 2 mm en puntos: 2 · 72 / 25,4.
const z = 144 / 25.4;
const caja = { x: 100, y: 200, width: 150, height: 250 };

describe('bleedRects', () => {
  it('rodea cada carta con cuatro bandas del ancho del margen de corte', () => {
    // 25,4 mm = 72 pt
    const rects = bleedRects([caja], on('color', 25.4));
    expect(rects).toEqual([
      { rect: { x: 28, y: 128, width: 72, height: 394 }, card: null, side: 'left' },
      { rect: { x: 250, y: 128, width: 72, height: 394 }, card: null, side: 'right' },
      { rect: { x: 100, y: 128, width: 150, height: 72 }, card: null, side: 'bottom' },
      { rect: { x: 100, y: 450, width: 150, height: 72 }, card: null, side: 'top' },
    ]);
  });

  it('dibuja bandas solo para las cartas colocadas en la página', () => {
    const card = { x: 0, y: 0, width: 10, height: 10 };
    expect(bleedRects([card, card, card], on('color'))).toHaveLength(12);
  });

  it('no dibuja nada si el margen de corte está desactivado', () => {
    expect(bleedRects([{ x: 0, y: 0, width: 10, height: 10 }], DEFAULT_SETTINGS)).toEqual([]);
  });

  it('con relleno de imagen, cuatro bandas de borde sin invadir las esquinas y cuatro esquinas', () => {
    const bands = bleedRects([caja], on('stretch'));
    // Bordes: cada uno solo su lado.
    expect(bands.slice(0, 4)).toEqual([
      { rect: { x: 100 - z, y: 200, width: z, height: 250 }, card: 0, side: 'left' },
      { rect: { x: 250, y: 200, width: z, height: 250 }, card: 0, side: 'right' },
      { rect: { x: 100, y: 200 - z, width: 150, height: z }, card: 0, side: 'bottom' },
      { rect: { x: 100, y: 450, width: 150, height: z }, card: 0, side: 'top' },
    ]);
    // Esquinas: un cuadrado del ancho del margen en cada una, con su propio lado.
    expect(bands.slice(4)).toEqual([
      { rect: { x: 100 - z, y: 200 - z, width: z, height: z }, card: 0, side: 'bottom-left' },
      { rect: { x: 250, y: 200 - z, width: z, height: z }, card: 0, side: 'bottom-right' },
      { rect: { x: 100 - z, y: 450, width: z, height: z }, card: 0, side: 'top-left' },
      { rect: { x: 250, y: 450, width: z, height: z }, card: 0, side: 'top-right' },
    ]);
  });

  it('las bandas llevan la carta que las rellena; sin fuente, color plano', () => {
    // La segunda carta va en blanco: color plano, con sus cuatro bandas de siempre.
    const bands = bleedRects([caja, caja], on('mirror'), [0, null]);
    expect(bands.filter((b) => b.card === 0)).toHaveLength(8);
    expect(bands.filter((b) => b.card === null)).toHaveLength(4);
  });
});

/** Banda del lado dado alrededor de la caja { x: 100, y: 200, width: 10, height: 6 }. */
const banda = (side: BleedSide): BleedBand => {
  const rects: Record<BleedSide, BleedBand['rect']> = {
    left: { x: 100 - z, y: 200, width: z, height: 6 },
    right: { x: 110, y: 200, width: z, height: 6 },
    bottom: { x: 100, y: 200 - z, width: 10, height: z },
    top: { x: 100, y: 206, width: 10, height: z },
    'bottom-left': { x: 100 - z, y: 200 - z, width: z, height: z },
    'bottom-right': { x: 110, y: 200 - z, width: z, height: z },
    'top-left': { x: 100 - z, y: 206, width: z, height: z },
    'top-right': { x: 110, y: 206, width: z, height: z },
  };
  return { rect: rects[side], card: 0, side };
};

/** Compara una matriz con los valores calculados a mano. */
const puntual = (m: number[], esperado: number[]) =>
  m.forEach((v, i) => expect(v).toBeCloseTo(esperado[i], 6));

describe('bleedBandMatrix', () => {
  // Hueco de 10 × 6 pt con su esquina en (100, 200).
  const hueco = { x: 100, y: 200, width: 10, height: 6 };

  it('mirror: refleja la carta sobre su borde, hacia fuera', () => {
    expect(bleedBandMatrix(banda('left'), hueco, 'mirror', { x: 0.5, y: 0.25 })).toEqual([
      -1, 0, 0, 1, 200, 0,
    ]);
    // Reflejo sobre el borde derecho (x = 110): la imagen cae en [110, 120].
    expect(bleedBandMatrix(banda('right'), hueco, 'mirror', { x: 0.5, y: 0.25 })).toEqual([
      -1, 0, 0, 1, 220, 0,
    ]);
    expect(bleedBandMatrix(banda('bottom'), hueco, 'mirror', { x: 0.5, y: 0.25 })).toEqual([
      1, 0, 0, -1, 0, 400,
    ]);
    expect(bleedBandMatrix(banda('top'), hueco, 'mirror', { x: 0.5, y: 0.25 })).toEqual([
      1, 0, 0, -1, 0, 412,
    ]);
  });

  it('mirror: cada esquina refleja por los dos lados, con su propia esquina de la imagen', () => {
    expect(bleedBandMatrix(banda('bottom-left'), hueco, 'mirror', { x: 0.5, y: 0.25 })).toEqual([
      -1, 0, 0, -1, 200, 400,
    ]);
    expect(bleedBandMatrix(banda('top-right'), hueco, 'mirror', { x: 0.5, y: 0.25 })).toEqual([
      -1, 0, 0, -1, 220, 412,
    ]);
    expect(bleedBandMatrix(banda('top-left'), hueco, 'mirror', { x: 0.5, y: 0.25 })).toEqual([
      -1, 0, 0, -1, 200, 412,
    ]);
    expect(bleedBandMatrix(banda('bottom-right'), hueco, 'mirror', { x: 0.5, y: 0.25 })).toEqual([
      -1, 0, 0, -1, 220, 400,
    ]);
  });

  it('stretch: la última fila o columna, anclada en el borde, llena la banda', () => {
    // Un píxel de 0,5 pt de ancho se estira hasta cubrir la banda de z pt: factor z / 0,5 = 2z.
    // El ancla es el borde de la caja: x' = (1 + s)·A − s·x deja el borde en su sitio.
    expect(bleedBandMatrix(banda('left'), hueco, 'stretch', { x: 0.5, y: 0.25 })).toEqual([
      -2 * z,
      0,
      0,
      1,
      (1 + 2 * z) * 100,
      0,
    ]);
    // Anclada en el borde derecho (x = 110): la última columna queda en [110, 110 + z].
    expect(bleedBandMatrix(banda('right'), hueco, 'stretch', { x: 0.5, y: 0.25 })).toEqual([
      -2 * z,
      0,
      0,
      1,
      (1 + 2 * z) * 110,
      0,
    ]);
    // Un píxel de 0,25 pt de alto: factor z / 0,25 = 4z.
    expect(bleedBandMatrix(banda('bottom'), hueco, 'stretch', { x: 0.5, y: 0.25 })).toEqual([
      1,
      0,
      0,
      -4 * z,
      0,
      (1 + 4 * z) * 200,
    ]);
    // Anclada en el borde superior (y = 206): la última fila queda en [206, 206 + z].
    expect(bleedBandMatrix(banda('top'), hueco, 'stretch', { x: 0.5, y: 0.25 })).toEqual([
      1,
      0,
      0,
      -4 * z,
      0,
      (1 + 4 * z) * 206,
    ]);
  });

  it('stretch: cada esquina estira por los dos lados', () => {
    expect(bleedBandMatrix(banda('bottom-left'), hueco, 'stretch', { x: 0.5, y: 0.25 })).toEqual([
      -2 * z,
      0,
      0,
      -4 * z,
      (1 + 2 * z) * 100,
      (1 + 4 * z) * 200,
    ]);
    expect(bleedBandMatrix(banda('top-right'), hueco, 'stretch', { x: 0.5, y: 0.25 })).toEqual([
      -2 * z,
      0,
      0,
      -4 * z,
      (1 + 2 * z) * 110,
      (1 + 4 * z) * 206,
    ]);
  });

  it('con el hueco girado un cuarto de vuelta, la banda mide z en el marco de la imagen', () => {
    // Hueco de plantilla de 40 × 30 mm girado 90°: la imagen sin girar mide 30 × 40 mm
    // (85,039 × 113,386 pt) y el borde izquierdo de la página es el superior de la imagen.
    const local = { x: 0, y: 0, width: 2160 / 25.4, height: 2880 / 25.4 };
    const bandaIzquierda: BleedBand = {
      rect: { x: 100 - z, y: 200, width: z, height: 2160 / 25.4 },
      card: 0,
      side: 'left',
    };
    const enImagen = bleedLocalBand(bandaIzquierda, 90);
    expect(enImagen.side).toBe('top');
    // A lo largo del eje que rellena, la banda mide z (el margen), no el alto del hueco.
    expect(enImagen.rect.width).toBeCloseTo(2160 / 25.4, 9);
    expect(enImagen.rect.height).toBeCloseTo(z, 9);
    // Un píxel de 0,25 pt de alto: la última fila se estira factor 4z, anclada arriba.
    puntual(bleedBandMatrix(enImagen, local, 'stretch', { x: 0.5, y: 0.25 }), [
      1,
      0,
      0,
      -4 * z,
      0,
      (1 + 4 * z) * (2880 / 25.4),
    ]);
    // En espejo, la misma banda refleja sobre el borde superior de la imagen.
    puntual(bleedBandMatrix(enImagen, local, 'mirror', { x: 0.5, y: 0.25 }), [
      1,
      0,
      0,
      -1,
      0,
      2 * (2880 / 25.4),
    ]);
  });
});

describe('bleedBandSvgMatrix', () => {
  // En el marco local de la caja (sin girar), la caja va de (0, 0) a (10, 6).
  const local = { x: 0, y: 0, width: 10, height: 6 };
  const bandaLocal = (side: BleedSide): BleedBand => {
    const b = banda(side);
    return {
      ...b,
      rect: {
        ...b.rect,
        x: b.side.includes('right') ? 10 : b.side.includes('left') ? -z : b.rect.x - 100,
        y: b.side.includes('top') ? 6 : b.side.includes('bottom') ? -z : b.rect.y - 200,
      },
    };
  };

  it('traduce la matriz del PDF al espacio de la vista previa (y hacia abajo)', () => {
    // Reflejar sobre el borde izquierdo es igual en los dos espacios.
    puntual(
      bleedBandSvgMatrix(bandaLocal('left'), local, 'mirror', { x: 0.5, y: 0.25 }),
      [-1, 0, 0, 1, 0, 0],
    );
    // Reflejar sobre el borde superior (y = 6 en el PDF) pasa a reflejar sobre y = 0 de la vista.
    puntual(
      bleedBandSvgMatrix(bandaLocal('top'), local, 'mirror', { x: 0.5, y: 0.25 }),
      [1, 0, 0, -1, 0, 0],
    );
    // Esquina inferior izquierda estirada: y' = −4z·y + 24z + 6 deja el borde (y = 6 en la vista,
    // que es el de abajo) en su sitio y estira hacia fuera.
    puntual(bleedBandSvgMatrix(bandaLocal('bottom-left'), local, 'stretch', { x: 0.5, y: 0.25 }), [
      -2 * z,
      0,
      0,
      -4 * z,
      0,
      24 * z + 6,
    ]);
  });
});

describe('bleedLocalSide', () => {
  it('sin giro, cada banda sale del mismo lado de la imagen', () => {
    expect(bleedLocalSide('left', 0)).toBe('left');
    expect(bleedLocalSide('bottom', 0)).toBe('bottom');
    expect(bleedLocalSide('top-left', 0)).toBe('top-left');
  });

  it('con giro, traduce el lado de la página al lado de la imagen sin girar', () => {
    // Un cuarto de vuelta antihorario: el borde izquierdo de la imagen queda abajo en la página.
    expect(bleedLocalSide('bottom', 90)).toBe('left');
    expect(bleedLocalSide('left', 90)).toBe('top');
    expect(bleedLocalSide('top', 90)).toBe('right');
    expect(bleedLocalSide('right', 90)).toBe('bottom');
    // Media vuelta: cada lado al opuesto; la esquina también.
    expect(bleedLocalSide('bottom-left', 180)).toBe('top-right');
    // Tres cuartos de vuelta: el borde izquierdo de la imagen queda arriba en la página.
    expect(bleedLocalSide('left', 270)).toBe('bottom');
    expect(bleedLocalSide('bottom', 270)).toBe('right');
    expect(bleedLocalSide('bottom-left', 270)).toBe('bottom-right');
  });
});

describe('bleedPixel', () => {
  it('mide un píxel de la zona visible: del recorte si lo hay, de la imagen entera si no', () => {
    const image = { widthPx: 30, heightPx: 42 };
    expect(
      bleedPixel(
        { x: 0, y: 0, width: 120, height: 70 },
        { x: 3, y: 4, width: 24, height: 35 },
        image,
      ),
    ).toEqual({ x: 5, y: 2 });
    expect(bleedPixel({ x: 0, y: 0, width: 120, height: 70 }, null, image)).toEqual({
      x: 4,
      y: 70 / 42,
    });
  });
});

describe('bandas y mmToPt', () => {
  it('el ancho de las bandas es el margen de corte en puntos', () => {
    expect(mmToPt(2)).toBeCloseTo(z, 9);
  });
});
