import { cardsBucket, eventPaths, pagesBucket } from './events';

describe('rangos', () => {
  it('agrupa las páginas en 1, 2-5, 6-20 y más de 20', () => {
    expect([1, 2, 5, 6, 20, 21, 300].map(pagesBucket)).toEqual([
      '1',
      '2-5',
      '2-5',
      '6-20',
      '6-20',
      'mas-de-20',
      'mas-de-20',
    ]);
  });

  it('agrupa las cartas en rangos', () => {
    expect([1, 9, 10, 54, 55, 200, 201].map(cardsBucket)).toEqual([
      '1-9',
      '1-9',
      '10-54',
      '10-54',
      '55-200',
      '55-200',
      'mas-de-200',
    ]);
  });
});

describe('eventPaths', () => {
  it('un PDF generado cuenta el evento y cada dato por separado', () => {
    expect(
      eventPaths({
        name: 'pdf-generado',
        pages: 7,
        cards: 60,
        layout: 'manual',
        crop: true,
        cutLines: false,
        bleed: true,
        backs: true,
        inkSaver: true,
        roundedCorners: true,
        lowDpi: 0,
      }),
    ).toEqual([
      'pdf-generado',
      'pdf-generado/paginas/6-20',
      'pdf-generado/cartas/55-200',
      'pdf-generado/distribucion/manual',
      'pdf-generado/opcion/recorte',
      'pdf-generado/opcion/margen-de-corte',
      'pdf-generado/opcion/reversos',
      'pdf-generado/opcion/ahorro-de-tinta',
      'pdf-generado/opcion/esquinas-redondeadas',
    ]);
  });

  it('las cartas con poca resolución se cuentan por rangos, solo si las hay', () => {
    const event = {
      name: 'pdf-generado' as const,
      pages: 1,
      cards: 3,
      layout: 'vertical9' as const,
      crop: false,
      cutLines: false,
      bleed: false,
      backs: false,
      inkSaver: false,
      roundedCorners: false,
    };
    expect(eventPaths({ ...event, lowDpi: 2 })).toContain('pdf-generado/poca-resolucion/1-9');
    expect(eventPaths({ ...event, lowDpi: 0 }).join()).not.toContain('poca-resolucion');
  });

  it('los errores solo mandan su código, limpio', () => {
    expect(eventPaths({ name: 'pdf-error', code: 'Blank Without Size/../x' })).toEqual([
      'pdf-error',
      'pdf-error/codigo/blank-without-size-x',
    ]);
  });

  it('los eventos sin datos son una sola ruta', () => {
    expect(eventPaths({ name: 'unir-pdf' })).toEqual(['unir-pdf']);
    expect(eventPaths({ name: 'proyecto-abierto', kind: 'bsk' })).toEqual([
      'proyecto-abierto',
      'proyecto-abierto/tipo/bsk',
    ]);
  });

  it('extraer imágenes cuenta el modo', () => {
    expect(eventPaths({ name: 'extraer-imagenes', mode: 'paginas' })).toEqual([
      'extraer-imagenes',
      'extraer-imagenes/modo/paginas',
    ]);
  });
});
