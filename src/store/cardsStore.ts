import { create } from 'zustand';
import type { Dpi } from '../lib/dpi';
import { pairBacks } from '../lib/backMatch';
import { parseCopies } from '../lib/filename';
import type { Rotation } from '../lib/template';

export type ImageFormat = 'jpeg' | 'png';

export interface CardImage {
  id: string;
  name: string;
  /** Ruta dentro de la carpeta de imágenes (o el nombre, si se añadió suelta); '' = en blanco. */
  path: string;
  /** null en una imagen en blanco. */
  blob: Blob | null;
  /** Formato de `blob`; las demás imágenes se convierten a PNG al cargarlas. */
  format: ImageFormat;
  widthPx: number;
  heightPx: number;
  dpi: Dpi | null;
  thumbUrl: string | null;
  /** Formato del archivo original ('jpeg', 'png', 'webp', 'tiff'…), antes de convertirlo. */
  sourceFormat?: string;
  /** Peso del archivo original, en bytes. */
  fileBytes?: number;
  /**
   * La imagen no se encontró al abrir el proyecto: se conserva (ruta y copias) para no perderla al
   * guardar, pero no se imprime hasta que se encuentre.
   */
  missing?: boolean;
  /** La carta no lleva reverso (con los reversos activados). */
  noBack?: boolean;
  /** Reverso propio: id de su imagen en `backs`. Sin él, la carta lleva el reverso común. */
  backId?: string;
  /** Giro elegido para la carta (antihorario); ausente, sin giro (o el automático). */
  rotation?: Rotation;
  copies: number;
}

export type NewImage = Omit<CardImage, 'id' | 'copies' | 'backId'>;

/** Imagen de un reverso propio, que pueden compartir varias cartas. */
export type BackImage = NewImage & { id: string };

/** Resumen de lo que se ha emparejado por nombre al añadir imágenes, para avisar. */
export interface PairingResult {
  /** Cuántas imágenes han pasado a ser reversos propios. */
  backs: number;
  /** A cuántas cartas se les ha dado reverso. */
  cards: number;
  /** Nombre de la imagen que ha pasado a ser el reverso común, si alguna. */
  common: string | null;
  /** Nombre del primer reverso propio (para el aviso de uno solo). */
  first: string | null;
}

/** Lo necesario para deshacer el último emparejamiento: cómo venían las imágenes añadidas. */
interface LastPairing {
  /** Posición de la lista en la que se añadieron. */
  start: number;
  order: (
    | { kind: 'card'; id: string }
    | { kind: 'back'; back: BackImage }
    | { kind: 'common'; image: NewImage }
  )[];
  /** El reverso común que había antes, si el emparejamiento lo cambió. */
  previousBack?: NewImage | null;
}

/** Carpeta de las imágenes del proyecto. En Chrome y Edge se guarda el acceso para reabrirla. */
export interface ImageFolder {
  name: string;
  handle: FileSystemDirectoryHandle | null;
}

interface CardsState {
  /** Nombre del proyecto ('' = sin nombre). */
  name: string;
  folder: ImageFolder | null;
  cards: CardImage[];
  /** Imagen del reverso común (no es una carta: no tiene copias ni va en la lista). */
  back: NewImage | null;
  /**
   * Reversos propios de las cartas (cada carta apunta a uno con `backId`). Se descartan solos
   * cuando ya no los usa ninguna carta.
   */
  backs: BackImage[];
  /** Última carta quitada, para poder deshacerlo. */
  lastRemoved: { card: CardImage; index: number } | null;
  /** Último emparejamiento de reversos por nombre, mientras se pueda deshacer. */
  lastPairing: LastPairing | null;
  addImages: (images: NewImage[]) => void;
  /**
   * Añade imágenes tomando como reversos las que lo son por su nombre (`pairBacks`): pasan a ser
   * el reverso propio de las cartas de su grupo (las añadidas y las de la lista sin reverso
   * propio ni marcadas sin reverso), y «__reverso» el común. Devuelve qué se ha emparejado, o
   * null si nada (entonces las añade como `addImages`).
   */
  addImagesPairingBacks: (images: NewImage[]) => PairingResult | null;
  /** Deshace el último emparejamiento: los reversos vuelven a la lista como cartas. */
  undoPairing: () => void;
  /**
   * Al desactivar los reversos: cada reverso propio vuelve a la lista como carta normal (con
   * las copias de su nombre), detrás de la última carta que lo usaba.
   */
  backsToCards: () => void;
  /**
   * Al activar los reversos: las cartas de la lista con nombre de reverso pasan a ser el reverso
   * propio de las de su grupo (`pairBacks`), y «__reverso» el común si no hay. Devuelve cuántos
   * reversos propios ha creado.
   */
  cardsToBacks: () => number;
  addBlank: () => void;
  setCopies: (id: string, copies: number) => void;
  /** Marca la carta sin reverso (y le quita el propio) o la devuelve al reverso común. */
  setNoBack: (id: string, noBack: boolean) => void;
  /** Añade la imagen de un reverso propio y devuelve su id, para asignarlo a las cartas. */
  addBack: (image: NewImage) => string;
  /** Reverso propio de la carta (un id de `backs`); null la devuelve al reverso común. */
  setOwnBack: (id: string, backId: string | null) => void;
  /** Pone la imagen encontrada en un reverso propio que faltaba (para todas sus cartas). */
  replaceBack: (id: string, image: NewImage) => void;
  /** Giro elegido para la carta; 0 lo quita. */
  setRotation: (id: string, rotation: Rotation) => void;
  setBack: (back: NewImage | null) => void;
  remove: (id: string) => void;
  /** Pone la imagen encontrada en una carta que faltaba, con sus mismas copias. */
  replaceImage: (id: string, image: NewImage) => void;
  undoRemove: () => void;
  move: (id: string, overId: string) => void;
  clear: () => void;
  setName: (name: string) => void;
  setFolder: (folder: ImageFolder | null) => void;
  /** Sustituye el proyecto actual por otro. */
  load: (
    name: string,
    cards: (NewImage & { copies: number; backId?: string })[],
    folder: ImageFolder | null,
    back?: NewImage | null,
    backs?: BackImage[],
  ) => void;
  /** Proyecto nuevo: sin nombre ni cartas. */
  reset: () => void;
}

export const totalCards = (cards: CardImage[]) => cards.reduce((n, c) => n + c.copies, 0);

/** Cartas que van al PDF: todas menos las que faltan. */
export const printableCards = (cards: CardImage[]) => cards.filter((c) => !c.missing);

/** El reverso común, si se puede imprimir (está elegido y se ha encontrado). */
export const printableBack = (back: NewImage | null) =>
  back?.blob && !back.missing ? (back as NewImage & { blob: Blob }) : null;

/**
 * Cómo lleva el reverso una carta al imprimir: su reverso propio (si tiene y se ha encontrado) o,
 * sin él, el común. Si su reverso propio falta, la carta va sin reverso (hueco vacío) en lugar
 * de llevar otro que no es el suyo.
 */
export function cardBack(
  card: CardImage,
  backs: BackImage[],
): { noBack: boolean; ownBack?: BackImage & { blob: Blob } } {
  const own = card.backId ? backs.find((b) => b.id === card.backId) : undefined;
  if (card.noBack) return { noBack: true };
  if (card.backId) {
    return own?.blob && !own.missing
      ? { noBack: false, ownBack: own as BackImage & { blob: Blob } }
      : { noBack: true };
  }
  return { noBack: false };
}

const revoke = (image: { thumbUrl: string | null }) => {
  if (image.thumbUrl) URL.revokeObjectURL(image.thumbUrl);
};

const revokeAll = (s: CardsState) => {
  s.cards.forEach(revoke);
  if (s.lastRemoved) revoke(s.lastRemoved.card);
  if (s.back) revoke(s.back);
  s.backs.forEach(revoke);
};

/** Una imagen como carta nueva, con las copias de su nombre. */
const toCard = (image: NewImage): CardImage => ({
  ...image,
  id: crypto.randomUUID(),
  copies: parseCopies(image.name) ?? 1,
});

/** Ya no se puede deshacer el emparejamiento: se libera el reverso común que había antes. */
function dropPairing(s: CardsState): { lastPairing: null } {
  if (s.lastPairing?.previousBack) revoke(s.lastPairing.previousBack);
  return { lastPairing: null };
}

/** La carta sin `backId`. */
function withoutOwnBack(card: CardImage): CardImage {
  const next = { ...card };
  delete next.backId;
  return next;
}

/**
 * Los reversos propios que siguen en uso (por una carta de la lista o por la quitada, mientras se
 * pueda deshacer); los demás se descartan liberando su miniatura.
 */
function keepUsedBacks(
  backs: BackImage[],
  cards: CardImage[],
  lastRemoved: CardsState['lastRemoved'],
): BackImage[] {
  const used = new Set(cards.map((c) => c.backId));
  if (lastRemoved) used.add(lastRemoved.card.backId);
  const kept = backs.filter((b) => used.has(b.id));
  if (kept.length === backs.length) return backs;
  backs.filter((b) => !used.has(b.id)).forEach(revoke);
  return kept;
}

export const useCardsStore = create<CardsState>()((set) => ({
  name: '',
  folder: null,
  cards: [],
  back: null,
  backs: [],
  lastRemoved: null,
  lastPairing: null,

  addImages: (images) =>
    set((s) => ({ ...dropPairing(s), cards: [...s.cards, ...images.map(toCard)] })),

  addImagesPairingBacks: (images) => {
    let result: PairingResult | null = null;
    set((s) => {
      const dropped = dropPairing(s);
      const eligible = s.cards.filter((c) => c.blob && !c.missing && !c.backId && !c.noBack);
      const pairing = pairBacks(
        images.map((i) => i.name),
        eligible.map((c) => c.name),
      );
      if (pairing.backs.length === 0 && pairing.common === null) {
        return { ...dropped, cards: [...s.cards, ...images.map(toCard)] };
      }

      const backOf = new Map<number, BackImage>();
      const addedBack = new Map<number, string>();
      const existingBack = new Map<string, string>();
      for (const b of pairing.backs) {
        const back = { ...images[b.image], id: crypto.randomUUID() };
        backOf.set(b.image, back);
        b.added.forEach((i) => addedBack.set(i, back.id));
        b.existing.forEach((i) => existingBack.set(eligible[i].id, back.id));
      }
      const order: LastPairing['order'] = [];
      const added: CardImage[] = [];
      images.forEach((image, i) => {
        const back = backOf.get(i);
        if (i === pairing.common) order.push({ kind: 'common', image });
        else if (back) order.push({ kind: 'back', back });
        else {
          const backId = addedBack.get(i);
          const card = { ...toCard(image), ...(backId ? { backId } : {}) };
          added.push(card);
          order.push({ kind: 'card', id: card.id });
        }
      });

      const common = pairing.common === null ? null : images[pairing.common];
      result = {
        backs: backOf.size,
        cards: addedBack.size + existingBack.size,
        common: common?.name ?? null,
        first: pairing.backs.length > 0 ? images[pairing.backs[0].image].name : null,
      };
      const existing = s.cards.map((c) =>
        existingBack.has(c.id) ? { ...c, backId: existingBack.get(c.id) } : c,
      );
      return {
        cards: [...existing, ...added],
        backs: [...s.backs, ...backOf.values()],
        back: common ?? s.back,
        lastPairing: {
          start: s.cards.length,
          order,
          ...(common ? { previousBack: s.back } : {}),
        },
      };
    });
    return result;
  },

  undoPairing: () =>
    set((s) => {
      const p = s.lastPairing;
      if (!p) return s;
      const paired = new Set(p.order.flatMap((e) => (e.kind === 'back' ? [e.back.id] : [])));
      const addedIds = new Set(p.order.flatMap((e) => (e.kind === 'card' ? [e.id] : [])));
      const current = new Map(s.cards.map((c) => [c.id, c]));
      // Las imágenes añadidas vuelven a la lista en el orden en que llegaron.
      const restored = p.order.flatMap((e): CardImage[] => {
        if (e.kind === 'card') return current.has(e.id) ? [current.get(e.id)!] : [];
        if (e.kind === 'common') return [toCard(e.image)];
        const image: NewImage & { id?: string } = { ...e.back };
        delete image.id;
        return [toCard(image)];
      });
      const cards = s.cards.filter((c) => !addedIds.has(c.id));
      cards.splice(Math.min(p.start, cards.length), 0, ...restored);
      return {
        cards: cards.map((c) => (c.backId && paired.has(c.backId) ? withoutOwnBack(c) : c)),
        backs: s.backs.filter((b) => !paired.has(b.id)),
        back: p.previousBack === undefined ? s.back : p.previousBack,
        lastPairing: null,
      };
    }),

  addBlank: () =>
    set((s) => ({
      cards: [
        ...s.cards,
        {
          id: crypto.randomUUID(),
          name: '',
          path: '',
          blob: null,
          format: 'png',
          widthPx: 0,
          heightPx: 0,
          dpi: null,
          thumbUrl: null,
          copies: 1,
        },
      ],
    })),

  setCopies: (id, copies) =>
    set((s) => ({
      cards: s.cards.map((c) =>
        c.id === id ? { ...c, copies: Math.max(1, Math.floor(copies) || 1) } : c,
      ),
    })),

  setNoBack: (id, noBack) =>
    set((s) => {
      const cards = s.cards.map((c) => {
        if (c.id !== id) return c;
        return noBack ? { ...withoutOwnBack(c), noBack } : { ...c, noBack };
      });
      return { ...dropPairing(s), cards, backs: keepUsedBacks(s.backs, cards, s.lastRemoved) };
    }),

  addBack: (image) => {
    const id = crypto.randomUUID();
    set((s) => ({ backs: [...s.backs, { ...image, id }] }));
    return id;
  },

  setOwnBack: (id, backId) =>
    set((s) => {
      const cards = s.cards.map((c) => {
        if (c.id !== id) return c;
        return backId === null ? withoutOwnBack(c) : { ...c, backId, noBack: false };
      });
      return { ...dropPairing(s), cards, backs: keepUsedBacks(s.backs, cards, s.lastRemoved) };
    }),

  setRotation: (id, rotation) =>
    set((s) => ({
      cards: s.cards.map((c) => {
        if (c.id !== id) return c;
        const next: CardImage = { ...c, rotation };
        if (rotation === 0) delete next.rotation;
        return next;
      }),
    })),

  setBack: (back) =>
    set((s) => {
      if (s.back && s.back !== back) revoke(s.back);
      return { ...dropPairing(s), back };
    }),

  backsToCards: () =>
    set((s) => {
      if (s.backs.length === 0) return s;
      const cards: CardImage[] = s.cards.map((c) => (c.backId ? withoutOwnBack(c) : c));
      for (const back of s.backs) {
        const image: NewImage & { id?: string } = { ...back };
        delete image.id;
        // Detrás de la última carta que lo usa (o al final, si ya no lo usa ninguna).
        const lastUser = s.cards.findLast((c) => c.backId === back.id);
        const at = lastUser ? cards.findIndex((c) => c.id === lastUser.id) + 1 : cards.length;
        cards.splice(at, 0, toCard(image));
      }
      const lastRemoved = s.lastRemoved && {
        ...s.lastRemoved,
        card: withoutOwnBack(s.lastRemoved.card),
      };
      return { ...dropPairing(s), cards, backs: [], lastRemoved };
    }),

  cardsToBacks: () => {
    let created = 0;
    set((s) => {
      const pairing = pairBacks(
        s.cards.map((c) => c.name),
        [],
      );
      const eligible = (c: CardImage) => !!c.blob && !c.missing && !c.backId && !c.noBack;
      const toBack = new Map<number, BackImage>();
      const assign = new Map<number, string>();
      for (const b of pairing.backs) {
        const receivers = b.added.filter((i) => eligible(s.cards[i]));
        if (receivers.length === 0) continue;
        const card: Partial<CardImage> = { ...s.cards[b.image] };
        delete card.copies;
        delete card.rotation;
        delete card.noBack;
        delete card.backId;
        const back = { ...(card as NewImage), id: crypto.randomUUID() };
        toBack.set(b.image, back);
        receivers.forEach((i) => assign.set(i, back.id));
      }
      const common = pairing.common !== null && !s.back ? s.cards[pairing.common] : null;
      created = toBack.size;
      if (created === 0 && !common) return s;
      const cards = s.cards.flatMap((c, i) => {
        if (toBack.has(i) || c === common) return [];
        const backId = assign.get(i);
        return [backId ? { ...c, backId } : c];
      });
      let back = s.back;
      if (common) {
        const image: Partial<CardImage> = { ...common };
        delete image.id;
        delete image.copies;
        back = image as NewImage;
      }
      return { ...dropPairing(s), cards, backs: [...s.backs, ...toBack.values()], back };
    });
    return created;
  },

  replaceBack: (id, image) =>
    set((s) => ({
      ...dropPairing(s),
      backs: s.backs.map((b) => {
        if (b.id !== id) return b;
        revoke(b);
        return { ...image, id, missing: false };
      }),
    })),

  remove: (id) =>
    set((s) => {
      const index = s.cards.findIndex((c) => c.id === id);
      if (index === -1) return s;
      // La miniatura de la carta quitada se conserva hasta que ya no se pueda deshacer.
      if (s.lastRemoved) revoke(s.lastRemoved.card);
      const cards = s.cards.filter((c) => c.id !== id);
      const lastRemoved = { card: s.cards[index], index };
      return {
        ...dropPairing(s),
        cards,
        lastRemoved,
        backs: keepUsedBacks(s.backs, cards, lastRemoved),
      };
    }),

  replaceImage: (id, image) =>
    set((s) => ({
      cards: s.cards.map((c) => {
        if (c.id !== id) return c;
        revoke(c);
        // Si es la misma imagen se conserva su ruta en la carpeta del proyecto, y la carta
        // sigue con sus copias, su giro y si va sin reverso.
        const path = image.name === c.name ? c.path : image.path;
        const { copies, noBack, rotation, backId } = c;
        return { ...image, id, path, copies, noBack, rotation, backId, missing: false };
      }),
    })),

  undoRemove: () =>
    set((s) => {
      if (!s.lastRemoved) return s;
      const { card, index } = s.lastRemoved;
      const cards = [...s.cards];
      cards.splice(Math.min(index, cards.length), 0, card);
      return { cards, lastRemoved: null };
    }),

  move: (id, overId) =>
    set((s) => {
      const from = s.cards.findIndex((c) => c.id === id);
      const to = s.cards.findIndex((c) => c.id === overId);
      if (from === -1 || to === -1 || from === to) return s;
      const cards = [...s.cards];
      const [card] = cards.splice(from, 1);
      cards.splice(to, 0, card);
      return { ...dropPairing(s), cards };
    }),

  clear: () =>
    set((s) => {
      revokeAll(s);
      return { ...dropPairing(s), cards: [], backs: [], lastRemoved: null };
    }),

  setName: (name) => set({ name }),

  setFolder: (folder) => set({ folder }),

  load: (name, cards, folder, back = null, backs = []) =>
    set((s) => {
      revokeAll(s);
      return {
        name,
        folder,
        cards: cards.map((c) => ({ ...c, id: crypto.randomUUID() })),
        back,
        backs,
        lastRemoved: null,
        ...dropPairing(s),
      };
    }),

  reset: () =>
    set((s) => {
      revokeAll(s);
      return {
        ...dropPairing(s),
        name: '',
        folder: null,
        cards: [],
        back: null,
        backs: [],
        lastRemoved: null,
      };
    }),
}));
