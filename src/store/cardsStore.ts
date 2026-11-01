import { create } from 'zustand';
import type { Dpi } from '../lib/dpi';
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
  addImages: (images: NewImage[]) => void;
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

  addImages: (images) =>
    set((s) => ({
      cards: [
        ...s.cards,
        ...images.map((img) => ({
          ...img,
          id: crypto.randomUUID(),
          copies: parseCopies(img.name) ?? 1,
        })),
      ],
    })),

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
      return { cards, backs: keepUsedBacks(s.backs, cards, s.lastRemoved) };
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
      return { cards, backs: keepUsedBacks(s.backs, cards, s.lastRemoved) };
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
      return { back };
    }),

  replaceBack: (id, image) =>
    set((s) => ({
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
      return { cards, lastRemoved, backs: keepUsedBacks(s.backs, cards, lastRemoved) };
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
      return { cards };
    }),

  clear: () =>
    set((s) => {
      revokeAll(s);
      return { cards: [], backs: [], lastRemoved: null };
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
      };
    }),

  reset: () =>
    set((s) => {
      revokeAll(s);
      return { name: '', folder: null, cards: [], back: null, backs: [], lastRemoved: null };
    }),
}));
