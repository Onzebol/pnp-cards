import { parseProject, ProjectError, serializeProject, type ProjectFile } from './project';
import { DEFAULT_SETTINGS } from './settings';

const project: ProjectFile = {
  name: 'Mi juego',
  folder: 'cartas',
  settings: { ...DEFAULT_SETTINGS, marginMm: 5 },
  cards: [
    { path: 'heroes/elfo x3.png', name: 'elfo x3.png', copies: 3 },
    { path: '', name: '', copies: 2 },
  ],
  back: null,
};

const withBack: ProjectFile = {
  ...project,
  settings: {
    ...DEFAULT_SETTINGS,
    backs: { enabled: true, flip: 'short' },
    backOffsetMm: { x: 1.5, y: -0.5 },
  },
  cards: [
    { path: 'elfo.png', name: 'elfo.png', copies: 1 },
    { path: 'mapa.png', name: 'mapa.png', copies: 1, noBack: true },
  ],
  back: { path: 'reversos/dorso.png', name: 'dorso.png' },
};

const rotated: ProjectFile = {
  ...project,
  settings: { ...DEFAULT_SETTINGS, autoRotate: true },
  cards: [
    { path: 'elfo.png', name: 'elfo.png', copies: 1 },
    { path: 'mapa.png', name: 'mapa.png', copies: 2, rotation: 90 },
  ],
};

describe('archivo .pnpcards', () => {
  it('es un JSON legible con el formato, la versión y las cartas, sin imágenes', () => {
    const json = JSON.parse(serializeProject(project));
    expect(json).toMatchObject({
      format: 'pnp-cards',
      version: 4,
      name: 'Mi juego',
      folder: 'cartas',
    });
    expect(json.cards).toEqual([
      { path: 'heroes/elfo x3.png', name: 'elfo x3.png', copies: 3 },
      { path: '', name: '', copies: 2 },
    ]);
  });

  it('al guardarlo y abrirlo se recupera el mismo proyecto', () => {
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it('guarda la ruta del reverso común y qué cartas no llevan reverso', () => {
    const json = JSON.parse(serializeProject(withBack));
    expect(json.back).toEqual({ path: 'reversos/dorso.png', name: 'dorso.png' });
    expect(json.settings.backOffsetMm).toEqual({ x: 1.5, y: -0.5 });
    expect(json.cards).toEqual([
      { path: 'elfo.png', name: 'elfo.png', copies: 1 },
      { path: 'mapa.png', name: 'mapa.png', copies: 1, noBack: true },
    ]);
    expect(parseProject(serializeProject(withBack))).toEqual(withBack);
  });

  it('guarda el giro de cada carta solo si lo tiene, y la casilla de girar las horizontales', () => {
    const json = JSON.parse(serializeProject(rotated));
    expect(json.settings.autoRotate).toBe(true);
    expect(json.cards).toEqual([
      { path: 'elfo.png', name: 'elfo.png', copies: 1 },
      { path: 'mapa.png', name: 'mapa.png', copies: 2, rotation: 90 },
    ]);
    expect(parseProject(serializeProject(rotated))).toEqual(rotated);
  });

  it('guarda la ruta del reverso propio de cada carta, solo en las que lo tienen', () => {
    const own: ProjectFile = {
      ...withBack,
      cards: [
        {
          path: 'templos/egipcio.png',
          name: 'egipcio.png',
          copies: 1,
          back: { path: 'templos/templo trasera.png', name: 'templo trasera.png' },
        },
        { path: 'elfo.png', name: 'elfo.png', copies: 1 },
      ],
    };
    const json = JSON.parse(serializeProject(own));
    expect(json.cards).toEqual([
      {
        path: 'templos/egipcio.png',
        name: 'egipcio.png',
        copies: 1,
        back: { path: 'templos/templo trasera.png', name: 'templo trasera.png' },
      },
      { path: 'elfo.png', name: 'elfo.png', copies: 1 },
    ]);
    expect(parseProject(serializeProject(own))).toEqual(own);
  });

  it('ignora un reverso propio sin nombre', () => {
    const p = parseProject(
      JSON.stringify({
        format: 'pnp-cards',
        version: 4,
        cards: [
          { path: 'a.png', name: 'a.png', copies: 1, back: { path: 'x.png', name: '' } },
          { path: 'b.png', name: 'b.png', copies: 1, back: 'x.png' },
        ],
      }),
    );
    expect(p.cards.map((c) => c.back)).toEqual([undefined, undefined]);
  });

  it('ignora un giro que no sea de cuartos de vuelta', () => {
    const p = parseProject(
      JSON.stringify({
        format: 'pnp-cards',
        version: 3,
        cards: [
          { path: 'a.png', name: 'a.png', copies: 1, rotation: 45 },
          { path: 'b.png', name: 'b.png', copies: 1, rotation: 0 },
          { path: 'c.png', name: 'c.png', copies: 1, rotation: 270 },
        ],
      }),
    );
    expect(p.cards.map((c) => c.rotation)).toEqual([undefined, undefined, 270]);
  });

  it('abre los proyectos de la versión 3, sin reversos propios', () => {
    const p = parseProject(serializeProject(withBack).replace('"version": 4', '"version": 3'));
    expect(p).toEqual(withBack);
  });

  it('abre los proyectos de la versión 2 con las cartas sin girar', () => {
    const p = parseProject(serializeProject(withBack).replace('"version": 4', '"version": 2'));
    expect(p).toEqual(withBack);
    expect(p.settings.autoRotate).toBe(false);
  });

  it('abre los proyectos de la versión 1: sin reverso y sin la doble cara manual', () => {
    const p = parseProject(
      JSON.stringify({
        format: 'pnp-cards',
        version: 1,
        settings: { duplex: true },
        cards: [{ path: 'a.png', name: 'a.png', copies: 2 }],
      }),
    );
    expect(p.back).toBeNull();
    expect(p.cards).toEqual([{ path: 'a.png', name: 'a.png', copies: 2 }]);
    expect(p.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('un proyecto sin ajuste de la impresora abre con los reversos sin desplazar', () => {
    const p = parseProject(
      JSON.stringify({
        format: 'pnp-cards',
        version: 2,
        settings: { backs: { enabled: true, flip: 'long' } },
        cards: [],
      }),
    );
    expect(p.settings.backOffsetMm).toEqual({ x: 0, y: 0 });
  });

  it('completa con los valores por defecto la configuración que falte', () => {
    const p = parseProject(
      JSON.stringify({ format: 'pnp-cards', version: 1, settings: { marginMm: 3 }, cards: [] }),
    );
    expect(p.settings).toEqual({ ...DEFAULT_SETTINGS, marginMm: 3 });
    expect(p.name).toBe('');
    expect(p.folder).toBe('');
  });

  it('corrige copias no válidas a una', () => {
    const p = parseProject(
      JSON.stringify({
        format: 'pnp-cards',
        version: 1,
        cards: [{ path: 'a.png', name: 'a.png', copies: 0 }],
      }),
    );
    expect(p.cards[0].copies).toBe(1);
  });

  it('rechaza archivos que no son proyectos', () => {
    expect(() => parseProject('hola')).toThrow(ProjectError);
    expect(() => parseProject('{"foo": 1}')).toThrow(ProjectError);
  });

  it('avisa si el proyecto es de una versión más nueva de la app', () => {
    try {
      parseProject(JSON.stringify({ format: 'pnp-cards', version: 99, cards: [] }));
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({ code: 'newer-version' });
    }
  });
});
