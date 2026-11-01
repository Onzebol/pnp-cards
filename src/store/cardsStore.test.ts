import { useCardsStore, totalCards, type CardImage } from './cardsStore';

function image(name: string, over: Partial<CardImage> = {}): Omit<CardImage, 'id' | 'copies'> {
  return {
    name,
    path: name,
    blob: new Blob(['x'], { type: 'image/png' }),
    format: 'png',
    widthPx: 744,
    heightPx: 1039,
    dpi: null,
    thumbUrl: null,
    ...over,
  };
}

const store = () => useCardsStore.getState();

describe('cardsStore', () => {
  beforeEach(() => store().clear());

  it('añade cartas con una copia, o las indicadas con " xN" en el nombre', () => {
    store().addImages([image('a.png'), image('b x3.png')]);
    expect(store().cards.map((c) => [c.name, c.copies])).toEqual([
      ['a.png', 1],
      ['b x3.png', 3],
    ]);
  });

  it('cuenta el total de cartas sumando las copias', () => {
    store().addImages([image('a x2.png'), image('b x3.png')]);
    expect(totalCards(store().cards)).toBe(5);
  });

  it('cambia las copias de una carta, con un mínimo de una', () => {
    store().addImages([image('a.png')]);
    const id = store().cards[0].id;
    store().setCopies(id, 7);
    expect(store().cards[0].copies).toBe(7);
    store().setCopies(id, 0);
    expect(store().cards[0].copies).toBe(1);
  });

  it('gira una carta, y conserva el giro al encontrar su imagen', () => {
    store().addImages([image('a.png')]);
    const id = store().cards[0].id;
    store().setRotation(id, 270);
    expect(store().cards[0].rotation).toBe(270);
    store().setRotation(id, 0);
    expect(store().cards[0].rotation).toBeUndefined();
    store().setRotation(id, 90);
    store().setNoBack(id, true);
    store().replaceImage(id, image('a.png'));
    expect(store().cards[0]).toMatchObject({ rotation: 90, noBack: true });
  });

  describe('reversos propios', () => {
    const revoke = vi.fn();
    beforeEach(() => {
      revoke.mockClear();
      URL.revokeObjectURL = revoke;
    });

    it('varias cartas comparten la misma imagen de reverso', () => {
      store().addImages([image('a.png'), image('b.png'), image('c.png')]);
      const [a, b] = store().cards;
      const back = store().addBack(image('trasera.png'));
      store().setOwnBack(a.id, back);
      store().setOwnBack(b.id, back);
      expect(store().backs).toHaveLength(1);
      expect(store().backs[0]).toMatchObject({ id: back, name: 'trasera.png' });
      expect(store().cards.map((c) => c.backId)).toEqual([back, back, undefined]);
    });

    it('elegir un reverso propio quita la marca de sin reverso', () => {
      store().addImages([image('a.png')]);
      const id = store().cards[0].id;
      store().setNoBack(id, true);
      store().setOwnBack(id, store().addBack(image('trasera.png')));
      expect(store().cards[0].noBack).toBeFalsy();
    });

    it('elegir sin reverso o el común quita el propio', () => {
      store().addImages([image('a.png'), image('b.png')]);
      const [a, b] = store().cards;
      const back = store().addBack(image('trasera.png'));
      store().setOwnBack(a.id, back);
      store().setOwnBack(b.id, back);
      store().setNoBack(a.id, true);
      store().setOwnBack(b.id, null);
      expect(store().cards.map((c) => c.backId)).toEqual([undefined, undefined]);
      expect(store().cards[0].noBack).toBe(true);
    });

    it('descarta el reverso que ya no usa ninguna carta y libera su miniatura', () => {
      store().addImages([image('a.png'), image('b.png')]);
      const [a, b] = store().cards;
      const back = store().addBack(image('trasera.png', { thumbUrl: 'blob:trasera' }));
      store().setOwnBack(a.id, back);
      store().setOwnBack(b.id, back);
      store().setOwnBack(a.id, null);
      expect(store().backs).toHaveLength(1);
      expect(revoke).not.toHaveBeenCalled();
      store().setNoBack(b.id, true);
      expect(store().backs).toEqual([]);
      expect(revoke).toHaveBeenCalledWith('blob:trasera');
    });

    it('al quitar una carta conserva su reverso mientras se pueda deshacer', () => {
      store().addImages([image('a.png'), image('b.png')]);
      const [a, b] = store().cards;
      const back = store().addBack(image('trasera.png', { thumbUrl: 'blob:trasera' }));
      store().setOwnBack(a.id, back);
      store().remove(a.id);
      expect(store().backs).toHaveLength(1);
      store().undoRemove();
      expect(store().cards[0].backId).toBe(back);
      store().remove(a.id);
      // Al quitar otra, ya no se puede deshacer la primera: su reverso sobra.
      store().remove(b.id);
      expect(store().backs).toEqual([]);
      expect(revoke).toHaveBeenCalledWith('blob:trasera');
    });

    it('al encontrar la imagen de una carta que falta conserva su reverso propio', () => {
      store().addImages([image('a.png')]);
      const id = store().cards[0].id;
      const back = store().addBack(image('trasera.png'));
      store().setOwnBack(id, back);
      store().replaceImage(id, image('a.png'));
      expect(store().cards[0].backId).toBe(back);
    });

    it('al encontrar la imagen de un reverso que falta, la sustituye para todas sus cartas', () => {
      store().addImages([image('a.png')]);
      const id = store().cards[0].id;
      const back = store().addBack(
        image('trasera.png', { blob: null, thumbUrl: 'blob:vieja', missing: true }),
      );
      store().setOwnBack(id, back);
      store().replaceBack(back, image('trasera.png', { thumbUrl: 'blob:nueva' }));
      expect(store().backs).toEqual([
        expect.objectContaining({ id: back, thumbUrl: 'blob:nueva', missing: false }),
      ]);
      expect(store().cards[0].backId).toBe(back);
      expect(revoke).toHaveBeenCalledWith('blob:vieja');
    });

    it('carga un proyecto con sus reversos propios', () => {
      store().load(
        'Mi juego',
        [
          { ...image('a.png'), copies: 1, backId: 'r1' },
          { ...image('b.png'), copies: 1 },
        ],
        null,
        null,
        [{ ...image('trasera.png'), id: 'r1' }],
      );
      expect(store().backs.map((b) => b.id)).toEqual(['r1']);
      expect(store().cards[0].backId).toBe('r1');
    });

    it('vaciar la lista o empezar un proyecto nuevo quita los reversos propios', () => {
      store().addImages([image('a.png')]);
      store().setOwnBack(
        store().cards[0].id,
        store().addBack(image('trasera.png', { thumbUrl: 'blob:t' })),
      );
      store().clear();
      expect(store().backs).toEqual([]);
      expect(revoke).toHaveBeenCalledWith('blob:t');
      store().load('x', [{ ...image('a.png'), copies: 1, backId: 'r1' }], null, null, [
        { ...image('trasera.png'), id: 'r1' },
      ]);
      store().reset();
      expect(store().backs).toEqual([]);
    });
  });

  describe('emparejar reversos al añadir', () => {
    beforeEach(() => {
      URL.revokeObjectURL = vi.fn();
    });
    const names = () => store().cards.map((c) => c.name);

    it('las imágenes con nombre de reverso pasan a ser el reverso propio de su grupo', () => {
      const result = store().addImagesPairingBacks([
        image('templo - egipcio.png'),
        image('templo - fenicio.png'),
        image('templo - trasera x2.png'),
        image('serpiente.png'),
      ]);
      expect(names()).toEqual(['templo - egipcio.png', 'templo - fenicio.png', 'serpiente.png']);
      expect(store().backs.map((b) => b.name)).toEqual(['templo - trasera x2.png']);
      const back = store().backs[0].id;
      expect(store().cards.map((c) => c.backId)).toEqual([back, back, undefined]);
      expect(result).toEqual({
        backs: 1,
        cards: 2,
        common: null,
        first: 'templo - trasera x2.png',
      });
    });

    it('también da reverso a las cartas de la lista que no tienen uno propio ni van sin él', () => {
      store().addImages([image('elfo.png'), image('elfo x2.png'), image('elfo arquero.png')]);
      const [, sinReverso, conReverso] = store().cards;
      store().setNoBack(sinReverso.id, true);
      const otro = store().addBack(image('otro.png'));
      store().setOwnBack(conReverso.id, otro);
      const result = store().addImagesPairingBacks([image('elfo reverso.png')]);
      expect(result?.cards).toBe(1);
      const back = store().backs.find((b) => b.name === 'elfo reverso.png')!.id;
      expect(store().cards.map((c) => c.backId)).toEqual([back, undefined, otro]);
    });

    it('«__reverso» pasa a ser el reverso común', () => {
      const result = store().addImagesPairingBacks([image('a.png'), image('__reverso.png')]);
      expect(names()).toEqual(['a.png']);
      expect(store().back?.name).toBe('__reverso.png');
      expect(result).toEqual({ backs: 0, cards: 0, common: '__reverso.png', first: null });
    });

    it('sin nada que emparejar, añade las imágenes como siempre y no devuelve nada', () => {
      expect(
        store().addImagesPairingBacks([image('a x3.png'), image('dragón - trasera.png')]),
      ).toBeNull();
      expect(store().cards.map((c) => [c.name, c.copies])).toEqual([
        ['a x3.png', 3],
        ['dragón - trasera.png', 1],
      ]);
      expect(store().lastPairing).toBeNull();
    });

    it('deshacer devuelve los reversos a la lista como cartas, en su sitio, y quita los asignados', () => {
      store().addImages([image('elfo.png')]);
      store().setBack(image('común.png'));
      store().addImagesPairingBacks([
        image('elfo - trasera x3.png'),
        image('templo - egipcio.png'),
        image('templo - trasera.png'),
        image('__reverso.png'),
      ]);
      store().undoPairing();
      expect(store().cards.map((c) => [c.name, c.copies, c.backId])).toEqual([
        ['elfo.png', 1, undefined],
        ['elfo - trasera x3.png', 3, undefined],
        ['templo - egipcio.png', 1, undefined],
        ['templo - trasera.png', 1, undefined],
        ['__reverso.png', 1, undefined],
      ]);
      expect(store().backs).toEqual([]);
      expect(store().back?.name).toBe('común.png');
      expect(store().lastPairing).toBeNull();
    });

    it('añadir más imágenes, quitar o vaciar la lista ya no deja deshacer el emparejamiento', () => {
      store().addImagesPairingBacks([image('a.png'), image('a - trasera.png')]);
      expect(store().lastPairing).not.toBeNull();
      store().addImages([image('b.png')]);
      expect(store().lastPairing).toBeNull();
      store().addImagesPairingBacks([image('c.png'), image('c - trasera.png')]);
      store().remove(store().cards[0].id);
      expect(store().lastPairing).toBeNull();
      store().addImagesPairingBacks([image('d.png'), image('d - trasera.png')]);
      store().clear();
      expect(store().lastPairing).toBeNull();
    });

    it('si se deja de poder deshacer, libera el reverso común que había antes', () => {
      const revoke = vi.fn();
      URL.revokeObjectURL = revoke;
      store().setBack(image('común.png', { thumbUrl: 'blob:común' }));
      store().addImagesPairingBacks([image('a.png'), image('__reverso.png')]);
      expect(revoke).not.toHaveBeenCalledWith('blob:común');
      store().addImages([image('b.png')]);
      expect(revoke).toHaveBeenCalledWith('blob:común');
    });
  });

  it('añade una imagen en blanco al final', () => {
    store().addImages([image('a.png')]);
    store().addBlank();
    expect(store().cards[1]).toMatchObject({ blob: null, copies: 1 });
  });

  it('quita cartas', () => {
    store().addImages([image('a.png'), image('b.png')]);
    store().remove(store().cards[0].id);
    expect(store().cards.map((c) => c.name)).toEqual(['b.png']);
  });

  it('deshace la última carta quitada, en su posición', () => {
    store().addImages([image('a.png'), image('b.png'), image('c.png')]);
    store().remove(store().cards[1].id);
    expect(store().lastRemoved?.card.name).toBe('b.png');
    store().undoRemove();
    expect(store().cards.map((c) => c.name)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(store().lastRemoved).toBeNull();
  });

  it('mueve una carta a la posición de otra', () => {
    store().addImages([image('a.png'), image('b.png'), image('c.png')]);
    const [a, , c] = store().cards;
    store().move(a.id, c.id);
    expect(store().cards.map((x) => x.name)).toEqual(['b.png', 'c.png', 'a.png']);
  });

  it('carga un proyecto entero: nombre y cartas con sus copias', () => {
    store().addImages([image('vieja.png')]);
    store().load(
      'Mi juego',
      [
        { ...image('a.png'), copies: 4 },
        { ...image(''), blob: null, copies: 2 },
      ],
      { name: 'cartas', handle: null },
    );
    expect(store().name).toBe('Mi juego');
    expect(store().folder).toEqual({ name: 'cartas', handle: null });
    expect(store().cards.map((c) => [c.name, c.copies, c.blob === null])).toEqual([
      ['a.png', 4, false],
      ['', 2, true],
    ]);
    expect(store().lastRemoved).toBeNull();
  });

  it('empezar un proyecto nuevo vacía la lista y el nombre', () => {
    store().load('Mi juego', [{ ...image('a.png'), copies: 1 }], null);
    store().reset();
    expect(store().name).toBe('');
    expect(store().folder).toBeNull();
    expect(store().cards).toEqual([]);
  });

  it('una carta que falta guarda su ruta y sus copias, sin imagen', () => {
    store().load(
      'x',
      [{ ...image('elfo.png'), path: 'heroes/elfo.png', blob: null, missing: true, copies: 3 }],
      null,
    );
    expect(store().cards[0]).toMatchObject({ path: 'heroes/elfo.png', missing: true, copies: 3 });
  });

  it('al encontrar la imagen de una carta que falta, la sustituye y conserva copias y ruta', () => {
    store().load(
      'x',
      [{ ...image('elfo.png'), path: 'heroes/elfo.png', blob: null, missing: true, copies: 3 }],
      null,
    );
    const id = store().cards[0].id;
    store().replaceImage(id, image('elfo.png'));
    expect(store().cards[0]).toMatchObject({
      id,
      path: 'heroes/elfo.png',
      copies: 3,
      missing: false,
    });
    expect(store().cards[0].blob).not.toBeNull();
  });

  it('si la imagen encontrada tiene otro nombre, usa su nombre como ruta', () => {
    store().load(
      'x',
      [{ ...image('elfo.png'), path: 'heroes/elfo.png', blob: null, missing: true, copies: 1 }],
      null,
    );
    store().replaceImage(store().cards[0].id, image('elfo-v2.png'));
    expect(store().cards[0]).toMatchObject({ name: 'elfo-v2.png', path: 'elfo-v2.png' });
  });
});
