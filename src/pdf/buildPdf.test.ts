// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { pageContent } from '../test/pdfContent';
import { buildPdf, type PdfCard } from './buildPdf';

const fixture = (name: string) =>
  Uint8Array.from(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url)));
const jpg = fixture('card.jpg');
const png = fixture('card.png');

const card = (
  bytes: Uint8Array<ArrayBuffer>,
  format: PdfCard['format'],
  copies: number,
): PdfCard => ({
  data: new Blob([bytes]),
  format,
  widthPx: 30,
  heightPx: 42,
  dpi: { x: 300, y: 300 },
  copies,
});

function imageStreams(doc: PDFDocument) {
  return doc.context
    .enumerateIndirectObjects()
    .map(([, obj]) => obj)
    .filter(
      (obj): obj is PDFRawStream =>
        obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'),
    );
}

describe('buildPdf', () => {
  it('genera una página por cada nueve cartas en A4 vertical', async () => {
    const bytes = await buildPdf({
      settings: DEFAULT_SETTINGS,
      cards: [card(jpg, 'jpeg', 10), card(png, 'png', 1)],
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    expect(doc.getPage(0).getSize()).toEqual({ width: 595, height: 842 });
  });

  it('incrusta cada imagen una sola vez, aunque tenga muchas copias', async () => {
    const doc = await PDFDocument.load(
      await buildPdf({
        settings: DEFAULT_SETTINGS,
        cards: [card(jpg, 'jpeg', 12), card(png, 'png', 5)],
      }),
    );
    expect(imageStreams(doc)).toHaveLength(2);
  });

  it('incrusta el JPG tal cual, sin volver a codificarlo', async () => {
    const doc = await PDFDocument.load(
      await buildPdf({ settings: DEFAULT_SETTINGS, cards: [card(jpg, 'jpeg', 1)] }),
    );
    const [stream] = imageStreams(doc);
    expect(stream.dict.get(PDFName.of('Filter'))).toBe(PDFName.of('DCTDecode'));
    expect(stream.getContents()).toEqual(jpg);
  });

  it('las imágenes en blanco no incrustan ninguna imagen', async () => {
    const blank: PdfCard = { ...card(jpg, 'jpeg', 2), data: null };
    const doc = await PDFDocument.load(
      await buildPdf({ settings: DEFAULT_SETTINGS, cards: [card(png, 'png', 1), blank] }),
    );
    expect(imageStreams(doc)).toHaveLength(1);
  });

  it('informa del progreso carta a carta hasta el total', async () => {
    const progress: number[] = [];
    await buildPdf({ settings: DEFAULT_SETTINGS, cards: [card(png, 'png', 3)] }, (done, total) =>
      progress.push(done / total),
    );
    expect(progress.at(-1)).toBe(1);
    expect(progress).toHaveLength(3);
  });

  it('guarda el título y el creador en los metadatos', async () => {
    const doc = await PDFDocument.load(
      await buildPdf({ settings: DEFAULT_SETTINGS, cards: [card(png, 'png', 1)], title: 'Cartas' }),
    );
    expect(doc.getTitle()).toBe('Cartas');
    expect(doc.getCreator()).toBe('PnP Cards');
  });

  it('recorta sin volver a codificar: el JPG sigue intacto y la página lleva una máscara', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      crop: { enabled: true, widthMm: 2, heightMm: 3, centered: true, x: 0, y: 0 },
    };
    const doc = await PDFDocument.load(await buildPdf({ settings, cards: [card(jpg, 'jpeg', 2)] }));
    const [stream] = imageStreams(doc);
    expect(stream.getContents()).toEqual(jpg);

    // re = rectángulo, W n = usarlo como máscara de recorte.
    expect(pageContent(doc, 0)).toMatch(/re\s+W\s+n/);
  });

  describe('con reversos', () => {
    const back = { data: new Blob([png]), format: 'png' as const, widthPx: 30, heightPx: 30 };
    const withBacks = (flip: 'long' | 'short') => ({
      ...DEFAULT_SETTINGS,
      backs: { enabled: true, flip },
    });

    it('intercala una página de reversos tras cada página de cartas', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: withBacks('long'),
          cards: [card(jpg, 'jpeg', 10)],
          back,
        }),
      );
      expect(doc.getPageCount()).toBe(4);
      // Do = dibujar una imagen: 9 reversos en la página 2 y 1 en la 4.
      expect(pageContent(doc, 1).match(/\bDo\b/g)).toHaveLength(9);
      expect(pageContent(doc, 3).match(/\bDo\b/g)).toHaveLength(1);
    });

    it('incrusta el reverso una sola vez y sin volver a codificarlo', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({ settings: withBacks('long'), cards: [card(jpg, 'jpeg', 12)], back }),
      );
      expect(imageStreams(doc)).toHaveLength(2);
    });

    it('por el borde corto, gira el reverso media vuelta: -1 0 0 -1 e f cm', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({ settings: withBacks('short'), cards: [card(jpg, 'jpeg', 1)], back }),
      );
      expect(pageContent(doc, 1)).toMatch(/-1 0 0 -1 [\d.]+ [\d.]+ cm/);
    });

    it('el progreso cuenta solo las cartas', async () => {
      const progress: [number, number][] = [];
      await buildPdf(
        { settings: withBacks('long'), cards: [card(png, 'png', 3)], back },
        (done, total) => progress.push([done, total]),
      );
      expect(progress.at(-1)).toEqual([3, 3]);
      expect(progress).toHaveLength(3);
    });
  });

  it('con plantilla, gira la carta en su hueco sin volver a codificarla', async () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      mode: 'template' as const,
      template: {
        id: 't',
        name: 'x',
        pageMm: { width: 100, height: 100 },
        slots: [{ id: 'a', xMm: 10, yMm: 10, widthMm: 40, heightMm: 30, rotation: 90 as const }],
      },
    };
    const doc = await PDFDocument.load(await buildPdf({ settings, cards: [card(jpg, 'jpeg', 1)] }));
    expect(imageStreams(doc)[0].getContents()).toEqual(jpg);
    const content = pageContent(doc, 0);
    // Recorte al hueco y matriz de giro de 90°: 0 1 -1 0 e f cm.
    expect(content).toMatch(/re\s+W\s+n/);
    expect(content).toMatch(/\b0 1 -1 0 [\d.]+ [\d.]+ cm/);
  });

  describe('cabecera', () => {
    /** Textos dibujados en una página (cadenas hexadecimales de los operadores Tj, en WinAnsi). */
    function texts(doc: PDFDocument, index: number) {
      return [...pageContent(doc, index).matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) =>
        String.fromCharCode(...(m[1].match(/../g) ?? []).map((h) => parseInt(h, 16))),
      );
    }

    it('sin la opción no dibuja texto', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: DEFAULT_SETTINGS,
          cards: [card(jpg, 'jpeg', 1)],
          header: { name: 'Dragones', pageLabel: 'Página {{n}} de {{total}}' },
        }),
      );
      expect(texts(doc, 0)).toEqual([]);
    });

    it('escribe el nombre y el número de hoja en cada página de cartas, en Helvetica', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: { ...DEFAULT_SETTINGS, header: true },
          cards: [card(jpg, 'jpeg', 10)],
          header: { name: 'Dragones del valle', pageLabel: 'Página {{n}} de {{total}}' },
        }),
      );
      expect(texts(doc, 0)).toEqual(['Dragones del valle', 'P\xe1gina 1 de 2']);
      expect(texts(doc, 1)).toEqual(['Dragones del valle', 'P\xe1gina 2 de 2']);
      expect(pageContent(doc, 0)).toMatch(/\/[\w-]+ 7 Tf/);
      const fonts = doc.context
        .enumerateIndirectObjects()
        .map(([, obj]) => obj)
        .filter(
          (obj): obj is PDFDict =>
            obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font'),
        );
      expect(fonts).toHaveLength(1);
      expect(String(fonts[0].get(PDFName.of('BaseFont')))).toBe('/Helvetica');
    });

    it('con reversos, las páginas de reversos no llevan cabecera y las hojas se numeran seguidas', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: { ...DEFAULT_SETTINGS, header: true, backs: { enabled: true, flip: 'long' } },
          cards: [card(jpg, 'jpeg', 10)],
          back: { data: new Blob([png]), format: 'png', widthPx: 30, heightPx: 42 },
          header: { name: 'Dragones', pageLabel: 'Hoja {{n}} de {{total}}' },
        }),
      );
      expect(doc.getPageCount()).toBe(4);
      expect(texts(doc, 0)).toEqual(['Dragones', 'Hoja 1 de 2']);
      expect(texts(doc, 1)).toEqual([]);
      expect(texts(doc, 2)).toEqual(['Dragones', 'Hoja 2 de 2']);
    });

    it('sustituye los caracteres que Helvetica no tiene', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: { ...DEFAULT_SETTINGS, header: true },
          cards: [card(jpg, 'jpeg', 1)],
          header: { name: 'Smoków \u{1F409} Wałęsa', pageLabel: '{{n}}/{{total}}' },
        }),
      );
      expect(texts(doc, 0)).toEqual(['Smok\xf3w ? Wa??sa', '1/1']);
    });

    it('en el lateral, el texto va girado 90°', async () => {
      // Cartas pegadas de 63,5 × 99 mm: tres filas llenan la hoja y solo quedan los laterales.
      const tall = { ...card(jpg, 'jpeg', 1), widthPx: 750, heightPx: 1169 };
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: { ...DEFAULT_SETTINGS, header: true, mode: 'manual', placement: 'together' },
          cards: [tall],
          header: { name: 'Dragones', pageLabel: '{{n}}/{{total}}' },
        }),
      );
      // Matriz de texto de un giro de 90° antihorario: [cos sin -sin cos x y] con cos ≈ 0.
      const matrices = [...pageContent(doc, 0).matchAll(/^(\S+) 1 -1 (\S+) \S+ \S+ Tm$/gm)];
      expect(matrices).toHaveLength(2);
      for (const m of matrices) expect(Math.abs(Number(m[1]))).toBeLessThan(1e-9);
    });
  });

  describe('regla de comprobación', () => {
    const texts = (doc: PDFDocument, index: number) =>
      [...pageContent(doc, index).matchAll(/<([0-9A-Fa-f]+)> Tj/g)].map((m) =>
        String.fromCharCode(...(m[1].match(/../g) ?? []).map((h) => parseInt(h, 16))),
      );
    /**
     * Rectángulos de `drawRectangle` en una página: [x, y, ancho, alto] en puntos. pdf-lib los
     * dibuja como un trazado tras desplazar el origen a su esquina.
     */
    const rectangles = (doc: PDFDocument, index: number) =>
      [
        ...pageContent(doc, index).matchAll(
          /^1 0 0 1 (\S+) (\S+) cm\n1 0 0 1 0 0 cm\n1 0 0 1 0 0 cm\n0 0 m\n0 (\S+) l\n(\S+) \S+ l$/gm,
        ),
      ].map((m) => [m[1], m[2], m[4], m[3]].map(Number));
    const ruler = { enabled: true, allPages: false };

    it('sin la opción no dibuja nada', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({ settings: DEFAULT_SETTINGS, cards: [card(jpg, 'jpeg', 1)] }),
      );
      expect(texts(doc, 0)).toEqual([]);
      expect(rectangles(doc, 0)).toEqual([]);
    });

    it('dibuja la barra a cuadros y «50 mm» a 6 pt solo en la primera página', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: { ...DEFAULT_SETTINGS, ruler },
          cards: [card(jpg, 'jpeg', 10)],
        }),
      );
      expect(texts(doc, 0)).toEqual(['50 mm']);
      expect(pageContent(doc, 0)).toMatch(/\/[\w-]+ 6 Tf/);
      // El contorno de 50 × 2 mm y cinco casillas de 5 mm, todo en el margen de 8 mm.
      const rects = rectangles(doc, 0);
      expect(rects).toHaveLength(6);
      const mm = 72 / 25.4;
      expect(rects[0][2]).toBeCloseTo(50 * mm, 2);
      expect(rects[0][3]).toBeCloseTo(2 * mm, 2);
      for (const r of rects.slice(1)) {
        expect(r[2]).toBeCloseTo(5 * mm, 2);
        expect(r[1]).toBeCloseTo(3 * mm, 2);
      }
      expect(rects[0][0]).toBeCloseTo(8 * mm, 2);
      expect(rects[0][1]).toBeCloseTo(3 * mm, 2);
      expect(rects.slice(1).map((r) => r[0] - rects[0][0])).toEqual(
        [0, 10, 20, 30, 40].map((x) => expect.closeTo(x * mm, 2)),
      );
      expect(texts(doc, 1)).toEqual([]);
      expect(rectangles(doc, 1)).toEqual([]);
    });

    it('con «en todas las páginas» va en todas, y nunca en las de reversos', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: {
            ...DEFAULT_SETTINGS,
            ruler: { enabled: true, allPages: true },
            backs: { enabled: true, flip: 'long' },
          },
          cards: [card(jpg, 'jpeg', 10)],
          back: { data: new Blob([png]), format: 'png', widthPx: 30, heightPx: 42 },
        }),
      );
      expect([0, 1, 2, 3].map((i) => texts(doc, i))).toEqual([['50 mm'], [], ['50 mm'], []]);
    });

    it('usa el color de las líneas de corte y comparte la Helvetica con la cabecera', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: {
            ...DEFAULT_SETTINGS,
            ruler,
            header: true,
            cutLines: { ...DEFAULT_SETTINGS.cutLines, color: '#ff0000' },
          },
          cards: [card(jpg, 'jpeg', 1)],
          header: { name: 'Dragones', pageLabel: '{{n}}/{{total}}' },
        }),
      );
      expect(texts(doc, 0)).toEqual(['Dragones', '1/1', '50 mm']);
      expect(pageContent(doc, 0)).toMatch(/1 0 0 rg/);
      const fonts = doc.context
        .enumerateIndirectObjects()
        .map(([, obj]) => obj)
        .filter(
          (obj): obj is PDFDict =>
            obj instanceof PDFDict && obj.get(PDFName.of('Type')) === PDFName.of('Font'),
        );
      expect(fonts).toHaveLength(1);
    });
  });

  describe('ahorro de tinta', () => {
    /** Estados gráficos de los recursos de una página. */
    const extGStates = (doc: PDFDocument, index: number) => {
      const states = doc.getPage(index).node.Resources()?.lookup(PDFName.of('ExtGState'), PDFDict);
      if (!states) return [];
      return states.entries().map(([key]) => {
        const d = states.lookup(key, PDFDict);
        return { BM: String(d.get(PDFName.of('BM'))), ca: String(d.get(PDFName.of('ca'))) };
      });
    };

    it('sin la opción no usa estados gráficos ni transparencias', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({ settings: DEFAULT_SETTINGS, cards: [card(jpg, 'jpeg', 1)] }),
      );
      expect(extGStates(doc, 0)).toEqual([]);
      expect(pageContent(doc, 0)).not.toMatch(/ gs$/m);
    });

    it('sobre cada carta pinta un gris con fusión «Saturation» y un blanco al 50 %, sin recodificar', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: { ...DEFAULT_SETTINGS, inkSaver: true },
          cards: [card(jpg, 'jpeg', 2)],
        }),
      );
      // Un estado por capa y por página: el PDF no engorda con las copias.
      expect(extGStates(doc, 0).sort((a, b) => a.BM.localeCompare(b.BM))).toEqual([
        { BM: '/Normal', ca: '0.5' },
        { BM: '/Saturation', ca: '1' },
      ]);
      const content = pageContent(doc, 0);
      // Dos cartas: dos rectángulos en cada capa, del tamaño de cada carta (30 × 42 px a 300 ppp).
      const w = (30 / 300) * 72;
      const h = (42 / 300) * 72;
      const rects = [...content.matchAll(/^(\S+) (\S+) (\S+) (\S+) re$/gm)].map((m) =>
        m.slice(1, 5).map(Number),
      );
      // Las máscaras de recorte no están activadas: solo quedan los rectángulos del ahorro.
      expect(rects).toHaveLength(4);
      for (const r of rects) {
        expect(r[2]).toBeCloseTo(w, 6);
        expect(r[3]).toBeCloseTo(h, 6);
      }
      expect(rects[0]).toEqual(rects[2]);
      expect(rects[1]).toEqual(rects[3]);
      // Gris al 50 % en la primera capa y blanco en la segunda, cada una dentro de su estado.
      expect(content).toMatch(/\/\S+ gs\n0\.5 0\.5 0\.5 rg\n/);
      expect(content).toMatch(/\/\S+ gs\n1 1 1 rg\n/);
      // Las imágenes siguen sin tocarse.
      const streams = imageStreams(doc);
      expect(streams).toHaveLength(1);
      expect(streams[0].contents).toEqual(jpg);
    });

    it('las capas van después de las cartas y antes de las líneas de corte, que conservan su color', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: {
            ...DEFAULT_SETTINGS,
            inkSaver: true,
            cutLines: { ...DEFAULT_SETTINGS.cutLines, enabled: true, color: '#ff0000' },
          },
          cards: [card(jpg, 'jpeg', 1)],
        }),
      );
      const content = pageContent(doc, 0);
      const image = content.search(/ Do$/m);
      const layers = content.search(/ gs$/m);
      const lines = content.search(/^1 0 0 RG$/m);
      expect(image).toBeGreaterThan(-1);
      expect(layers).toBeGreaterThan(image);
      expect(lines).toBeGreaterThan(layers);
      // El estado gráfico se restaura antes de las líneas: tantos Q como q.
      expect(content.match(/^q$/gm)).toHaveLength(content.match(/^Q$/gm)!.length);
      expect(content.slice(lines)).not.toMatch(/ gs$/m);
    });

    it('también aclara los reversos, pero no las cartas en blanco', async () => {
      const build = (inkSaver: boolean) =>
        buildPdf({
          settings: { ...DEFAULT_SETTINGS, inkSaver, backs: { enabled: true, flip: 'long' } },
          cards: [card(jpg, 'jpeg', 1), { ...card(jpg, 'jpeg', 1), data: null }],
          back: { data: new Blob([png]), format: 'png', widthPx: 30, heightPx: 42 },
        });
      const plain = await PDFDocument.load(await build(false));
      const saver = await PDFDocument.load(await build(true));
      const rects = (doc: PDFDocument, index: number) =>
        pageContent(doc, index).match(/ re$/gm)?.length ?? 0;
      // Carta y reverso: un rectángulo más por capa en cada página (el reverso ya lleva el de su
      // recorte), y nada sobre la carta en blanco.
      expect(rects(saver, 0) - rects(plain, 0)).toBe(2);
      expect(rects(saver, 1) - rects(plain, 1)).toBe(2);
      expect(extGStates(saver, 1).map((s) => s.BM)).toEqual(['/Saturation', '/Normal']);
    });
  });

  describe('con esquinas redondeadas', () => {
    const rounded = { ...DEFAULT_SETTINGS, corners: { rounded: true, radiusMm: 3 } };
    const curves = (content: string) => content.match(/ c$/gm)?.length ?? 0;

    it('recorta cada carta con un trazado de cuatro arcos antes de dibujarla', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({ settings: rounded, cards: [card(png, 'png', 2)] }),
      );
      const content = pageContent(doc, 0);
      expect(curves(content)).toBe(8);
      expect(content).toMatch(/ c\s+h\s+W\s+n/);
      expect(content.match(/\bDo\b/g)).toHaveLength(2);
    });

    it('sin la opción no hay ningún arco', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({ settings: DEFAULT_SETTINGS, cards: [card(png, 'png', 2)] }),
      );
      expect(curves(pageContent(doc, 0))).toBe(0);
    });

    it('también redondea las cartas giradas y los reversos', async () => {
      const back = { data: new Blob([png]), format: 'png' as const, widthPx: 30, heightPx: 30 };
      const doc = await PDFDocument.load(
        await buildPdf({
          settings: { ...rounded, backs: { enabled: true, flip: 'long' } },
          cards: [{ ...card(png, 'png', 1), rotation: 90 }],
          back,
        }),
      );
      expect(curves(pageContent(doc, 0))).toBe(4);
      expect(curves(pageContent(doc, 1))).toBe(4);
    });

    it('la imagen sigue incrustándose tal cual', async () => {
      const doc = await PDFDocument.load(
        await buildPdf({ settings: rounded, cards: [card(jpg, 'jpeg', 1)] }),
      );
      const [stream] = imageStreams(doc);
      expect(stream.getContents()).toEqual(jpg);
    });
  });
});
