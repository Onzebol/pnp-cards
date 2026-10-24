import { planDocument, PlanError, translatePage, type CardSpec, type PlannedPage } from './plan';
import { DEFAULT_SETTINGS, type LayoutSettings } from './settings';
import { mmToPt } from './units';

const dpi300 = { x: 300, y: 300 };
const big: CardSpec = { widthPx: 744, heightPx: 1039, dpi: dpi300, blank: false, copies: 1 };
const small: CardSpec = { widthPx: 372, heightPx: 520, dpi: dpi300, blank: false, copies: 1 };
const blank: CardSpec = { widthPx: 0, heightPx: 0, dpi: null, blank: true, copies: 1 };
/** Carta horizontal: 88 × 63 mm a 300 ppp (249,36 × 178,56 pt sin girar). */
const wide: CardSpec = { widthPx: 1039, heightPx: 744, dpi: dpi300, blank: false, copies: 1 };
/** Reverso cuadrado, para ver cómo se recorta. */
const square = { widthPx: 1000, heightPx: 1000 };

function settings(over: Partial<LayoutSettings> = {}): LayoutSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}

describe('planDocument', () => {
  it('reparte las copias de cada carta en páginas, en orden', () => {
    const plan = planDocument(settings(), [
      { ...big, copies: 7 },
      { ...small, copies: 3 },
    ]);
    expect(plan.total).toBe(10);
    expect(plan.pages.map((p) => p.items.map((i) => i.card))).toEqual([
      [0, 0, 0, 0, 0, 0, 0, 1, 1],
      [1],
    ]);
    expect(plan.pages.map((p) => p.number)).toEqual([1, 2]);
  });

  it('ignora las cartas con cero copias', () => {
    const plan = planDocument(settings(), [{ ...big, copies: 0 }, small]);
    expect(plan.pages[0].items.map((i) => i.card)).toEqual([1]);
  });

  it('separa las cartas según la primera carta del documento en todas las páginas', () => {
    const plan = planDocument(settings(), [
      { ...big, copies: 9 },
      { ...small, copies: 2 },
    ]);
    const [first, second] = plan.pages[1].items;
    expect(first.placement.x).toBeCloseTo(22.677, 3);
    // 22,677 + ancho de la carta pequeña (89,28) + separación de la grande (6,983)
    expect(second.placement.x).toBeCloseTo(118.94, 3);
    expect(second.placement.width).toBeCloseTo(89.28, 3);
  });

  it('una imagen en blanco toma el tamaño de la carta anterior', () => {
    const plan = planDocument(settings(), [small, blank]);
    const [, b] = plan.pages[0].items;
    expect(b.placement.width).toBeCloseTo(89.28, 3);
    expect(b.placement.height).toBeCloseTo(124.8, 3);
  });

  it('una imagen en blanco al principio toma el tamaño de la carta siguiente', () => {
    const plan = planDocument(settings(), [blank, big]);
    expect(plan.pages[0].items[0].placement.width).toBeCloseTo(178.56, 3);
  });

  it('con ancho y alto forzados, la imagen en blanco usa ese tamaño', () => {
    const forced = settings({
      forceWidth: true,
      forceHeight: true,
      cardWidthMm: 25.4,
      cardHeightMm: 50.8,
    });
    const item = planDocument(forced, [blank]).pages[0].items[0];
    expect(item.placement.width).toBeCloseTo(72, 6);
    expect(item.placement.height).toBeCloseTo(144, 6);
  });

  it('falla si solo hay imágenes en blanco y no se fuerza el tamaño', () => {
    expect(() => planDocument(settings(), [blank])).toThrow(PlanError);
  });

  it('falla si no hay ninguna carta que imprimir', () => {
    expect(() => planDocument(settings(), [{ ...big, copies: 0 }])).toThrow(PlanError);
  });

  it('calcula el margen de corte de cada página con sus cartas', () => {
    const plan = planDocument(settings({ bleed: { enabled: true, mm: 2, color: '#fff' } }), [
      { ...big, copies: 10 },
    ]);
    expect(plan.pages[0].bleed).toHaveLength(36);
    expect(plan.pages[1].bleed).toHaveLength(4);
  });

  it('traza las líneas de corte con la primera carta de cada página', () => {
    const s = settings({
      placement: 'together',
      cutLines: { enabled: true, style: 'full', color: '#000', widthHundredthsMm: 4 },
    });
    const plan = planDocument(s, [{ ...big, copies: 9 }, small]);
    const xs = (i: number) =>
      plan.pages[i].cutLines!.segments.filter((g) => g.x1 === g.x2).map((g) => g.x1);
    // Página 1: carta grande; página 2: pequeña, con la posición de la grande.
    expect(xs(0)[1] - xs(0)[0]).toBeCloseTo(178.56, 3);
    expect(xs(1)[1] - xs(1)[0]).toBeCloseTo(89.28, 3);
    expect(xs(1)[0]).toBeCloseTo(xs(0)[0], 6);
  });

  it('con las líneas de corte desactivadas, la página no tiene líneas', () => {
    expect(planDocument(settings(), [big]).pages[0].cutLines).toBeNull();
  });

  describe('con reversos', () => {
    const long = settings({ backs: { enabled: true, flip: 'long' } });
    const short = settings({ backs: { enabled: true, flip: 'short' } });

    it('detrás de cada página de cartas va una de reversos con los mismos huecos', () => {
      const plan = planDocument(
        long,
        [
          { ...big, copies: 7 },
          { ...small, copies: 3 },
        ],
        square,
      );
      expect(plan.pages.map((p) => p.side)).toEqual(['front', 'back', 'front', 'back']);
      expect(plan.pages.map((p) => p.number)).toEqual([1, 2, 3, 4]);
      expect(plan.pages[1].items.map((i) => i.card)).toEqual([0, 0, 0, 0, 0, 0, 0, 1, 1]);
      expect(plan.pages[3].items.map((i) => i.card)).toEqual([1]);
      // Los reversos no son cartas.
      expect(plan.total).toBe(10);
    });

    it('por el borde largo, cada reverso va en espejo horizontal de su carta', () => {
      const [front, back] = planDocument(long, [{ ...big, copies: 2 }], square).pages;
      // Primera carta: 8 mm desde la izquierda; su reverso, 8 mm desde la derecha:
      // 595 − 22,677 − 178,56 = 393,763.
      expect(front.items[0].placement.x).toBeCloseTo(22.677, 3);
      expect(back.items[0].placement.x).toBeCloseTo(393.763, 3);
      expect(back.items[0].placement.y).toBeCloseTo(front.items[0].placement.y, 6);
      // Segunda carta: 22,677 + 178,56 + 6,983 = 208,22 → 595 − 208,22 − 178,56 = 208,22.
      expect(back.items[1].placement.x).toBeCloseTo(208.22, 2);
      expect(back.items[0].rotation).toBeUndefined();
    });

    it('por el borde corto, cada reverso va en espejo vertical y girado media vuelta', () => {
      const [front, back] = planDocument(short, [big], square).pages;
      // Primera fila: 842 − 22,677 − 249,36 = 569,963 desde abajo; su reverso, a 22,677.
      expect(front.items[0].placement.y).toBeCloseTo(569.963, 3);
      expect(back.items[0].placement.y).toBeCloseTo(22.677, 3);
      expect(back.items[0].placement.x).toBeCloseTo(22.677, 3);
      expect(back.items[0].rotation).toBe(180);
    });

    it('recorta el reverso centrado para que llene el hueco sin deformarse', () => {
      const back = planDocument(long, [big], square).pages[1];
      // 178,56 / 249,36 = 0,716 → del cuadrado de 1000 px se ven 716 × 1000.
      expect(back.items[0].crop).toEqual({ x: 142, y: 0, width: 716, height: 1000 });
    });

    it('las cartas en blanco y las marcadas sin reverso dejan su hueco vacío', () => {
      const plan = planDocument(long, [big, blank, { ...small, noBack: true }, big], square);
      expect(plan.pages[1].items.map((i) => i.card)).toEqual([0, 3]);
      // El reverso de la cuarta carta va en espejo de su hueco (el cuarto, abajo a la izquierda).
      expect(plan.pages[1].items[1].placement.x).toBeCloseTo(393.763, 3);
    });

    it('lleva margen de corte pero no líneas de corte', () => {
      const s = settings({
        backs: { enabled: true, flip: 'long' },
        bleed: { enabled: true, mm: 2, color: '#fff' },
        cutLines: { enabled: true, style: 'normal', color: '#000', widthHundredthsMm: 4 },
      });
      const back = planDocument(s, [{ ...big, copies: 2 }], square).pages[1];
      expect(back.bleed).toHaveLength(8);
      expect(back.cutLines).toBeNull();
    });

    it('sin imagen de reverso no se puede generar', () => {
      expect(() => planDocument(long, [big], null)).toThrow(
        expect.objectContaining({ code: 'no-back' }),
      );
    });

    it('sin reversos activados, las páginas son todas de cartas', () => {
      const plan = planDocument(settings(), [{ ...big, copies: 10 }], square);
      expect(plan.pages.map((p) => p.side)).toEqual(['front', 'front']);
    });

    describe('con el ajuste de la impresora', () => {
      // 1,5 mm a la derecha = 4,252 pt; 0,5 mm hacia abajo = −1,417 pt.
      const offset = { x: 1.5, y: -0.5 };
      const moved = settings({ backs: { enabled: true, flip: 'long' }, backOffsetMm: offset });

      it('desplaza los reversos en mm, a la derecha y hacia arriba, y no las cartas', () => {
        const [front, back] = planDocument(moved, [big], square).pages;
        expect(front.items[0].placement.x).toBeCloseTo(22.677, 3);
        expect(front.items[0].placement.y).toBeCloseTo(569.963, 3);
        // 393,763 + 4,252 y 569,963 − 1,417.
        expect(back.items[0].placement.x).toBeCloseTo(398.015, 2);
        expect(back.items[0].placement.y).toBeCloseTo(568.546, 2);
        expect(back.items[0].placement.width).toBeCloseTo(178.56, 3);
      });

      it('es el mismo en todas las páginas de reversos: no se acumula', () => {
        const plan = planDocument(moved, [{ ...big, copies: 10 }], square);
        expect(plan.pages[3].items[0].placement.x).toBeCloseTo(398.015, 2);
        expect(plan.pages[3].items[0].placement.y).toBeCloseTo(568.546, 2);
        expect(plan.pages[2].items[0].placement.x).toBeCloseTo(22.677, 3);
      });

      it('mueve el margen de corte exactamente lo mismo que los reversos', () => {
        const s = { ...moved, bleed: { enabled: true, mm: 2, color: '#fff' } };
        const back = planDocument(s, [big], square).pages[1];
        const { x, y } = back.items[0].placement;
        // La banda izquierda empieza 2 mm (5,669 pt) a la izquierda del reverso desplazado.
        expect(back.bleed[0].x).toBeCloseTo(x - 5.669, 3);
        expect(back.bleed[0].y).toBeCloseTo(y - 5.669, 3);
      });

      it('se aplica igual por el borde corto y conserva el giro', () => {
        const s = { ...moved, backs: { enabled: true, flip: 'short' as const } };
        const back = planDocument(s, [big], square).pages[1];
        // 22,677 + 4,252 y 22,677 − 1,417.
        expect(back.items[0].placement.x).toBeCloseTo(26.929, 2);
        expect(back.items[0].placement.y).toBeCloseTo(21.26, 2);
        expect(back.items[0].rotation).toBe(180);
      });

      it('no cambia el recorte del reverso', () => {
        const back = planDocument(moved, [big], square).pages[1];
        expect(back.items[0].crop).toEqual({ x: 142, y: 0, width: 716, height: 1000 });
      });
    });
  });

  describe('translatePage', () => {
    const page: PlannedPage = {
      number: 2,
      sheet: 1,
      side: 'back',
      header: null,
      ruler: null,
      cornerRadius: 0,
      size: { width: 595, height: 842 },
      items: [{ card: 0, placement: { x: 10, y: 20, width: 30, height: 40 }, crop: null }],
      bleed: [{ x: 5, y: 15, width: 5, height: 50 }],
      cutLines: { lineWidth: 0.1, segments: [{ x1: 0, y1: 20, x2: 10, y2: 20 }] },
    };

    it('mueve cartas, margen y líneas de corte lo mismo', () => {
      const moved = translatePage(page, 4, -1);
      expect(moved.items[0].placement).toEqual({ x: 14, y: 19, width: 30, height: 40 });
      expect(moved.bleed[0]).toEqual({ x: 9, y: 14, width: 5, height: 50 });
      expect(moved.cutLines!.segments[0]).toEqual({ x1: 4, y1: 19, x2: 14, y2: 19 });
      expect(moved.cutLines!.lineWidth).toBe(0.1);
    });

    it('sin desplazamiento, devuelve la misma página', () => {
      expect(translatePage(page, 0, 0)).toBe(page);
    });
  });

  describe('con recorte', () => {
    const cropped = settings({
      crop: { enabled: true, widthMm: 63, heightMm: 88, centered: true, x: 0, y: 0 },
    });
    const noDpi: CardSpec = { widthPx: 822, heightPx: 1122, dpi: null, blank: false, copies: 1 };

    it('la carta mide lo que el recorte, a 300 ppp, aunque la imagen no indique sus ppp', () => {
      const { placement } = planDocument(cropped, [noDpi]).pages[0].items[0];
      expect(placement.width).toBeCloseTo(178.56, 3);
      expect(placement.height).toBeCloseTo(249.36, 3);
    });

    it('centra el recorte en cada imagen por separado', () => {
      const other: CardSpec = { ...noDpi, widthPx: 800, heightPx: 1100 };
      const [a, b] = planDocument(cropped, [noDpi, other]).pages[0].items;
      expect(a.crop).toEqual({ x: 39, y: 42, width: 744, height: 1039 });
      expect(b.crop).toEqual({ x: 28, y: 31, width: 744, height: 1039 });
    });

    it('marca las cartas cuyo recorte no cabe en la imagen', () => {
      const tiny: CardSpec = { ...noDpi, widthPx: 500 };
      const plan = planDocument(cropped, [noDpi, tiny]);
      expect(plan.clampedCards).toEqual([1]);
    });

    it('sin recorte, las colocaciones no tienen recorte', () => {
      expect(planDocument(settings(), [big]).pages[0].items[0].crop).toBeNull();
    });
  });

  describe('con giro', () => {
    const auto = settings({ autoRotate: true });

    it('gira un cuarto de vuelta a la derecha la carta horizontal de una distribución vertical', () => {
      const [first, second] = planDocument(auto, [big, wide]).pages[0].items;
      expect(first.rotation).toBeUndefined();
      expect(second.rotation).toBe(270);
      // Girada ocupa un hueco vertical, igual que la otra carta.
      expect(second.placement.width).toBeCloseTo(178.56, 3);
      expect(second.placement.height).toBeCloseTo(249.36, 3);
      expect(second.placement.x).toBeCloseTo(first.placement.x + 178.56 + 6.983, 2);
    });

    it('desactivado, la carta horizontal ocupa un hueco ancho', () => {
      const [, second] = planDocument(settings(), [big, wide]).pages[0].items;
      expect(second.rotation).toBeUndefined();
      expect(second.placement.width).toBeCloseTo(249.36, 3);
    });

    it('el giro elegido para la carta manda sobre el automático', () => {
      const cards: CardSpec[] = [
        { ...big, rotation: 180 },
        { ...wide, rotation: 90 },
      ];
      const [first, second] = planDocument(auto, cards).pages[0].items;
      expect(first.rotation).toBe(180);
      expect(first.placement.width).toBeCloseTo(178.56, 3);
      expect(second.rotation).toBe(90);
      expect(second.placement.width).toBeCloseTo(178.56, 3);
    });

    it('con ancho y alto forzados, la carta girada ocupa el hueco forzado', () => {
      const forced = settings({
        autoRotate: true,
        forceWidth: true,
        forceHeight: true,
        cardWidthMm: 63,
        cardHeightMm: 88,
      });
      const item = planDocument(forced, [wide]).pages[0].items[0];
      expect(item.rotation).toBe(270);
      expect(item.placement.width).toBeCloseTo(178.583, 3);
      expect(item.placement.height).toBeCloseTo(249.449, 3);
    });

    it('con recorte, decide la forma del recorte, que se aplica antes de girar', () => {
      // Solo 50 mm de ancho (591 px a 300 ppp) y todo el alto: las dos quedan verticales.
      const cropped = settings({
        autoRotate: true,
        crop: { enabled: true, widthMm: 50, heightMm: 0, centered: true, x: 0, y: 0 },
      });
      const [, second] = planDocument(cropped, [big, wide]).pages[0].items;
      expect(second.rotation).toBeUndefined();
      expect(second.crop).toEqual({ x: 224, y: 0, width: 591, height: 744 });
      expect(second.placement.width).toBeCloseTo(141.84, 3);
      expect(second.placement.height).toBeCloseTo(178.56, 3);
    });

    it('con reversos, el reverso sigue el giro de la carta combinado con el espejo', () => {
      const long = settings({ autoRotate: true, backs: { enabled: true, flip: 'long' } });
      const [front, back] = planDocument(long, [big, wide], square).pages;
      expect(front.items[1].rotation).toBe(270);
      expect(back.items[1].rotation).toBe(90);
      // El reverso se recorta a la forma de la carta sin girar (249,36 × 178,56): 1000 × 716.
      expect(back.items[1].crop).toEqual({ x: 0, y: 142, width: 1000, height: 716 });
      const short = settings({ autoRotate: true, backs: { enabled: true, flip: 'short' } });
      expect(planDocument(short, [big, wide], square).pages[1].items[1].rotation).toBe(270);
    });
  });

  describe('con plantilla', () => {
    const template = {
      id: 't',
      name: 'Caja',
      pageMm: { width: 100, height: 150 },
      slots: [
        { id: 'a', xMm: 10, yMm: 10, widthMm: 50, heightMm: 70, rotation: 0 as const },
        { id: 'b', xMm: 10, yMm: 80, widthMm: 70, heightMm: 50, rotation: 90 as const },
      ],
    };
    const tpl = settings({ mode: 'template', template });

    it('usa el tamaño de página de la plantilla y un hueco por carta, en orden', () => {
      const plan = planDocument(tpl, [{ ...big, copies: 3 }]);
      expect(plan.pages).toHaveLength(2);
      expect(plan.pages[0].size.width).toBeCloseTo(283.465, 3);
      expect(plan.pages[0].size.height).toBeCloseTo(425.197, 3);
      expect(plan.pages.map((p) => p.items.length)).toEqual([2, 1]);
    });

    it('cada carta ocupa su hueco, con su giro, aunque la imagen sea de otro tamaño', () => {
      const [first, second] = planDocument(tpl, [{ ...big, copies: 2 }]).pages[0].items;
      expect(first.rotation).toBe(0);
      expect(first.placement.x).toBeCloseTo(28.346, 3);
      // 150 − 10 − 70 = 70 mm desde abajo.
      expect(first.placement.y).toBeCloseTo(198.425, 3);
      expect(first.placement.width).toBeCloseTo(141.732, 3);
      expect(second.rotation).toBe(90);
      expect(second.placement.width).toBeCloseTo(198.425, 3);
    });

    it('las imágenes en blanco no necesitan tamaño: el hueco ya lo tiene', () => {
      expect(() => planDocument(tpl, [blank])).not.toThrow();
    });

    it('pone el margen de corte y marcas de corte alrededor de cada hueco ocupado', () => {
      const s = settings({
        mode: 'template',
        template,
        bleed: { enabled: true, mm: 2, color: '#fff' },
        cutLines: { enabled: true, style: 'normal', color: '#000', widthHundredthsMm: 4 },
      });
      const page = planDocument(s, [big]).pages[0];
      expect(page.bleed).toHaveLength(4);
      expect(page.cutLines!.segments).toHaveLength(8);
      // Las marcas empiezan fuera del margen de corte: 2 mm + 1 pt.
      const left = page.cutLines!.segments.find((g) => g.y1 === g.y2 && g.x2 < g.x1)!;
      expect(left.x1).toBeCloseTo(28.346 - 5.669 - 1, 3);
    });

    it('sin plantilla elegida, o con una sin huecos, no se puede generar', () => {
      expect(() => planDocument(settings({ mode: 'template', template: null }), [big])).toThrow(
        expect.objectContaining({ code: 'no-template' }),
      );
      const empty = { ...template, slots: [] };
      expect(() => planDocument(settings({ mode: 'template', template: empty }), [big])).toThrow(
        expect.objectContaining({ code: 'no-template' }),
      );
    });

    it('con reversos por el borde largo, refleja los huecos y el giro', () => {
      const s = settings({ mode: 'template', template, backs: { enabled: true, flip: 'long' } });
      const [front, back] = planDocument(s, [{ ...big, copies: 2 }], square).pages;
      // Hueco 1: 10 mm desde la izquierda en las cartas; en los reversos, 10 mm desde la derecha.
      expect(front.items[0].placement.x).toBeCloseTo(28.346, 3);
      expect(back.items[0].placement.x).toBeCloseTo(113.386, 3);
      // 100 − 10 − 70 = 20 mm.
      expect(back.items[1].placement.x).toBeCloseTo(56.693, 3);
      // Un giro de 90° se convierte en 270° al dar la vuelta a la hoja.
      expect(front.items[1].rotation).toBe(90);
      expect(back.items[1].rotation).toBe(270);
    });

    it('con reversos por el borde corto, refleja en vertical y gira media vuelta', () => {
      const s = settings({ mode: 'template', template, backs: { enabled: true, flip: 'short' } });
      const back = planDocument(s, [{ ...big, copies: 2 }], square).pages[1];
      // Hueco 1: 10 mm desde arriba en las cartas; en los reversos, 10 mm desde abajo.
      expect(back.items[0].placement.x).toBeCloseTo(28.346, 3);
      expect(back.items[0].placement.y).toBeCloseTo(28.346, 3);
      expect(back.items[0].rotation).toBe(180);
      // Hueco 2: de 20 mm desde abajo pasa a 80 mm; su giro de 90° se queda en 90°.
      expect(back.items[1].placement.y).toBeCloseTo(226.772, 3);
      expect(back.items[1].rotation).toBe(90);
    });

    it('recorta el reverso a la forma del hueco sin girar', () => {
      const s = settings({ mode: 'template', template, backs: { enabled: true, flip: 'long' } });
      const back = planDocument(s, [{ ...big, copies: 2 }], square).pages[1];
      // Hueco 1: 50 × 70 mm → del cuadrado de 1000 px se ven 714 × 1000 (5/7).
      expect(back.items[0].crop).toEqual({ x: 143, y: 0, width: 714, height: 1000 });
      // Hueco 2: 70 × 50 mm girado 90° → la carta sin girar también mide 50 × 70.
      expect(back.items[1].crop).toEqual({ x: 143, y: 0, width: 714, height: 1000 });
    });

    it('el ajuste de la impresora desplaza los huecos de los reversos sin cambiar su giro', () => {
      const s = settings({
        mode: 'template',
        template,
        backs: { enabled: true, flip: 'long' },
        backOffsetMm: { x: 1.5, y: -0.5 },
      });
      const [front, back] = planDocument(s, [{ ...big, copies: 2 }], square).pages;
      expect(front.items[0].placement.x).toBeCloseTo(28.346, 3);
      // 113,386 + 4,252; 198,425 − 1,417.
      expect(back.items[0].placement.x).toBeCloseTo(117.638, 2);
      expect(back.items[0].placement.y).toBeCloseTo(197.008, 2);
      expect(back.items[1].rotation).toBe(270);
    });

    it('de derecha a izquierda refleja los huecos en todas las páginas', () => {
      const s = settings({ mode: 'template', template, rightToLeft: true });
      const [first] = planDocument(s, [big]).pages;
      expect(first.items[0].placement.x).toBeCloseTo(113.386, 3);
    });

    it('con el giro automático, la carta horizontal se gira para coincidir con cada hueco', () => {
      const s = settings({ mode: 'template', template, autoRotate: true });
      // Hueco 1: vertical, sin giro → la carta gira 270°. Hueco 2: 70 × 50 girado 90° (la carta
      // va en vertical) → 90° + 270° = 0°.
      const [first, second] = planDocument(s, [{ ...wide, copies: 2 }]).pages[0].items;
      expect(first.rotation).toBe(270);
      expect(second.rotation).toBe(0);
      // Una carta vertical no cambia.
      const [a, b] = planDocument(s, [{ ...big, copies: 2 }]).pages[0].items;
      expect([a.rotation, b.rotation]).toEqual([0, 90]);
    });

    it('el giro elegido para la carta se suma al del hueco', () => {
      const [first, second] = planDocument(tpl, [{ ...big, copies: 2, rotation: 180 }]).pages[0]
        .items;
      expect(first.rotation).toBe(180);
      expect(second.rotation).toBe(270);
    });
  });

  describe('cabecera', () => {
    it('sin la opción, ninguna página lleva cabecera', () => {
      const { pages, sheets } = planDocument(settings(), [{ ...big, copies: 10 }]);
      expect(pages.every((p) => p.header === null)).toBe(true);
      expect(sheets).toBe(2);
      expect(pages.map((p) => p.sheet)).toEqual([1, 2]);
    });

    it('con la opción, cada página de cartas lleva la cabecera arriba, en el margen de 8 mm', () => {
      const { pages } = planDocument(settings({ header: true }), [{ ...big, copies: 10 }]);
      expect(pages).toHaveLength(2);
      for (const page of pages) {
        expect(page.header?.where).toBe('top');
        expect(page.header?.size).toBe(7);
        // Alineada con el bloque de cartas (8 mm de margen) más 1,5 mm de separación.
        expect(page.header?.start.x).toBeCloseTo(mmToPt(9.5), 6);
        expect(page.header?.end.x).toBeCloseTo(595 - mmToPt(9.5), 6);
      }
    });

    it('con reversos, solo las páginas de cartas la llevan y las hojas se numeran de una en una', () => {
      const { pages, sheets } = planDocument(
        settings({ header: true, backs: { enabled: true, flip: 'long' } }),
        [{ ...big, copies: 10 }],
        square,
      );
      expect(pages.map((p) => p.side)).toEqual(['front', 'back', 'front', 'back']);
      expect(pages.map((p) => p.header !== null)).toEqual([true, false, true, false]);
      expect(pages.map((p) => p.sheet)).toEqual([1, 1, 2, 2]);
      expect(sheets).toBe(2);
    });

    it('con cartas pegadas que llenan la hoja, va en el lateral', () => {
      // 63,5 × 99 mm: tres filas ocupan los 297 mm de alto; a los lados quedan 9,75 mm.
      const tall: CardSpec = { ...big, widthPx: 750, heightPx: 1169 };
      const { pages } = planDocument(
        settings({ header: true, mode: 'manual', placement: 'together' }),
        [{ ...tall, copies: 1 }],
      );
      expect(pages[0].header?.where).toBe('left');
    });

    it('el ajuste de la impresora desplaza también la cabecera', () => {
      const page = planDocument(settings({ header: true }), [big]).pages[0];
      const moved = translatePage(page, 10, -5);
      expect(moved.header?.start).toEqual({
        x: page.header!.start.x + 10,
        y: page.header!.start.y - 5,
      });
      expect(moved.header?.end).toEqual({ x: page.header!.end.x + 10, y: page.header!.end.y - 5 });
    });
  });

  describe('regla de comprobación', () => {
    it('sin la opción, ninguna página lleva regla', () => {
      const { pages } = planDocument(settings(), [{ ...big, copies: 10 }]);
      expect(pages.every((p) => p.ruler === null)).toBe(true);
    });

    it('con la opción, solo la primera página la lleva, abajo y alineada con la primera columna', () => {
      const { pages } = planDocument(settings({ ruler: { enabled: true, allPages: false } }), [
        { ...big, copies: 10 },
      ]);
      expect(pages).toHaveLength(2);
      expect(pages[0].ruler?.where).toBe('bottom');
      // Margen de 8 mm: la barra empieza donde las cartas y queda centrada en el margen.
      expect(pages[0].ruler?.x).toBeCloseTo(mmToPt(8), 6);
      expect(pages[0].ruler?.y).toBeCloseTo(mmToPt(3), 6);
      expect(pages[1].ruler).toBeNull();
    });

    it('con «en todas las páginas», todas la llevan en el mismo sitio', () => {
      const { pages } = planDocument(settings({ ruler: { enabled: true, allPages: true } }), [
        { ...big, copies: 10 },
      ]);
      expect(pages.map((p) => p.ruler !== null)).toEqual([true, true]);
      expect(pages[1].ruler).toEqual(pages[0].ruler);
    });

    it('con reversos, las páginas de reversos nunca la llevan', () => {
      const { pages } = planDocument(
        settings({
          ruler: { enabled: true, allPages: true },
          backs: { enabled: true, flip: 'long' },
        }),
        [{ ...big, copies: 10 }],
        square,
      );
      expect(pages.map((p) => p.ruler !== null)).toEqual([true, false, true, false]);
    });

    it('con la cabecera arriba, la regla se queda abajo', () => {
      const { pages } = planDocument(
        settings({ header: true, ruler: { enabled: true, allPages: false } }),
        [big],
      );
      expect(pages[0].header?.where).toBe('top');
      expect(pages[0].ruler?.where).toBe('bottom');
    });

    it('con plantilla también va en la primera página', () => {
      const template = {
        id: 't',
        name: 'Una',
        pageMm: { width: 210, height: 297 },
        slots: [{ id: 'a', xMm: 10, yMm: 10, widthMm: 63, heightMm: 88, rotation: 0 as const }],
      };
      const { pages } = planDocument(
        settings({ mode: 'template', template, ruler: { enabled: true, allPages: false } }),
        [{ ...big, copies: 2 }],
      );
      expect(pages[0].ruler?.where).toBe('bottom');
      expect(pages[0].ruler?.x).toBeCloseTo(mmToPt(10), 6);
      expect(pages[1].ruler).toBeNull();
    });

    it('el ajuste de la impresora desplaza también la regla', () => {
      const page = planDocument(settings({ ruler: { enabled: true, allPages: false } }), [big])
        .pages[0];
      const moved = translatePage(page, 10, -5);
      expect(moved.ruler).toEqual({
        ...page.ruler,
        x: page.ruler!.x + 10,
        y: page.ruler!.y - 5,
        label: { ...page.ruler!.label, x: page.ruler!.label.x + 10, y: page.ruler!.label.y - 5 },
      });
    });
  });

  describe('con esquinas redondeadas', () => {
    it('cada página lleva el radio en puntos, también la de reversos', () => {
      const { pages } = planDocument(
        settings({
          corners: { rounded: true, radiusMm: 3 },
          backs: { enabled: true, flip: 'long' },
        }),
        [big],
        square,
      );
      expect(pages).toHaveLength(2);
      expect(pages[0].cornerRadius).toBeCloseTo(3 * (72 / 25.4), 6);
      expect(pages[1].cornerRadius).toBeCloseTo(3 * (72 / 25.4), 6);
    });

    it('con plantilla también', () => {
      const template = {
        id: 't',
        name: 'Una',
        pageMm: { width: 210, height: 297 },
        slots: [{ id: 'a', xMm: 10, yMm: 10, widthMm: 63, heightMm: 88, rotation: 0 as const }],
      };
      const { pages } = planDocument(
        settings({ mode: 'template', template, corners: { rounded: true, radiusMm: 2 } }),
        [big],
      );
      expect(pages[0].cornerRadius).toBeCloseTo(mmToPt(2), 6);
    });

    it('desactivadas, el radio es 0', () => {
      expect(planDocument(settings(), [big]).pages[0].cornerRadius).toBe(0);
    });
  });
});
