import { backGroup, isCommonBackName, pairBacks } from './backMatch';

describe('backGroup', () => {
  it('el grupo es lo que va antes de la palabra, sin la extensión ni el « xN»', () => {
    expect(backGroup('7 Wonder - Fichas ofrenda - Trasera x3.jpg')).toBe(
      '7 Wonder - Fichas ofrenda',
    );
    expect(backGroup('Cartas Phanteon - Gran templo - Trasera x5.jpg')).toBe(
      'Cartas Phanteon - Gran templo',
    );
    expect(backGroup('Cartas Phanteon - Maravilla - Trasera x3.jpg')).toBe(
      'Cartas Phanteon - Maravilla',
    );
  });

  it('lo que va detrás de la palabra se une al grupo con el mismo separador', () => {
    expect(backGroup('Cartas Phanteon - Trasera - 1 x3.jpg')).toBe('Cartas Phanteon - 1');
    expect(backGroup('Cartas Phanteon - Trasera - 6.jpg')).toBe('Cartas Phanteon - 6');
    expect(backGroup('elfo_back_azul.png')).toBe('elfo_azul');
  });

  it('vale «trasera», «reverso», «dorso» y «back», sin distinguir mayúsculas', () => {
    expect(backGroup('elfo reverso.png')).toBe('elfo');
    expect(backGroup('elfo_DORSO.png')).toBe('elfo');
    expect(backGroup('elfo-Back.png')).toBe('elfo');
    expect(backGroup('elfo TRASERA.png')).toBe('elfo');
  });

  it('solo cuenta como palabra entera, detrás de un espacio, «_» o «-»', () => {
    expect(backGroup('Backgammon.png')).toBeNull();
    expect(backGroup('Back to the future.png')).toBeNull();
    expect(backGroup('elfo traseras.png')).toBeNull();
    expect(backGroup('elfoback.png')).toBeNull();
    expect(backGroup('Trasera.png')).toBeNull();
    expect(backGroup('elfo.png')).toBeNull();
  });
});

describe('isCommonBackName', () => {
  it('«__reverso», «__back», «__trasera» o «__dorso» son el reverso común', () => {
    expect(isCommonBackName('__reverso.png')).toBe(true);
    expect(isCommonBackName('__Back.jpg')).toBe(true);
    expect(isCommonBackName('__trasera x2.jpg')).toBe(true);
    expect(isCommonBackName('__dorso.webp')).toBe(true);
    expect(isCommonBackName('reverso.png')).toBe(false);
    expect(isCommonBackName('__reverso azul.png')).toBe(false);
  });
});

describe('pairBacks', () => {
  // La carpeta de 7 Wonders Duel Pantheon, en el orden en que se añade (por nombre).
  const pantheon = [
    '7 Wonder - Fichas mitologia - Trasera x10.jpg', // 0
    '7 Wonder - Fichas mitologia 1 x2.jpg', // 1
    '7 Wonder - Fichas mitologia 2 x2.jpg', // 2
    '7 Wonder - Fichas ofrenda - Trasera x3.jpg', // 3
    '7 Wonder - Fichas ofrenda 1.jpg', // 4
    '7 Wonder - Fichas ofrenda 2.jpg', // 5
    '7 Wonder - Fichas Serpiente 1.jpg', // 6
    'Cartas Phanteon - 1-1.jpg', // 7
    'Cartas Phanteon - 1-2.jpg', // 8
    'Cartas Phanteon - 6.jpg', // 9
    'Cartas Phanteon - Gran templo - Egipcio.jpg', // 10
    'Cartas Phanteon - Gran templo - Fenicio.jpg', // 11
    'Cartas Phanteon - Gran templo - Trasera x5.jpg', // 12
    'Cartas Phanteon - Trasera - 1 x3.jpg', // 13
    'Cartas Phanteon - Trasera - 6.jpg', // 14
  ];

  it('cada trasera se lleva las cartas de su grupo', () => {
    expect(pairBacks(pantheon, [])).toEqual({
      common: null,
      backs: [
        { image: 0, added: [1, 2], existing: [] },
        { image: 3, added: [4, 5], existing: [] },
        { image: 12, added: [10, 11], existing: [] },
        { image: 13, added: [7, 8], existing: [] },
        { image: 14, added: [9], existing: [] },
      ],
    });
  });

  it('tras el grupo no puede seguir una letra ni un número', () => {
    const { backs } = pairBacks(
      ['Mazo - Trasera - 1.png', 'Mazo - 1-1.png', 'Mazo - 10-1.png', 'Mazo - 1b.png'],
      [],
    );
    expect(backs).toEqual([{ image: 0, added: [1], existing: [] }]);
  });

  it('si una carta encaja en varios grupos, gana el más largo', () => {
    const { backs } = pairBacks(
      [
        'Cartas - Trasera.png', // grupo «Cartas»
        'Cartas - Templo - Trasera.png', // grupo «Cartas - Templo»
        'Cartas - Templo - Egipcio.png',
        'Cartas - Maravilla.png',
      ],
      [],
    );
    expect(backs).toEqual([
      { image: 0, added: [3], existing: [] },
      { image: 1, added: [2], existing: [] },
    ]);
  });

  it('no distingue mayúsculas al emparejar', () => {
    const { backs } = pairBacks(['ELFO - trasera.png', 'elfo - arquero.png'], []);
    expect(backs).toEqual([{ image: 0, added: [1], existing: [] }]);
  });

  it('también empareja con las cartas que ya estaban en la lista', () => {
    const { backs } = pairBacks(['elfo reverso.png'], ['orco.png', 'elfo.png', 'elfo x3.png']);
    expect(backs).toEqual([{ image: 0, added: [], existing: [1, 2] }]);
  });

  it('una trasera sin cartas de su grupo no es un reverso: se queda como carta', () => {
    expect(pairBacks(['dragón - trasera.png', 'elfo.png'], []).backs).toEqual([]);
  });

  it('una trasera no es carta de otra trasera', () => {
    const { backs } = pairBacks(
      ['Mazo - Trasera.png', 'Mazo - Trasera - 1.png', 'Mazo - 1.png'],
      [],
    );
    expect(backs).toEqual([{ image: 1, added: [2], existing: [] }]);
  });

  it('la imagen «__reverso» pasa a ser el reverso común', () => {
    expect(pairBacks(['a.png', '__reverso.png', 'b.png'], [])).toEqual({ common: 1, backs: [] });
  });
});
