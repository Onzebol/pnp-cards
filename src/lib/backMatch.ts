/**
 * Emparejamiento de reversos por nombre al añadir imágenes. Una imagen cuyo nombre lleva la
 * palabra «trasera», «reverso», «dorso» o «back» (entera, tras un espacio, «_» o «-») es el
 * reverso de un grupo de cartas: las que empiezan por lo que va antes de la palabra.
 *
 *   «7 Wonder - Fichas ofrenda - Trasera x3»  → grupo «7 Wonder - Fichas ofrenda»
 *   «Cartas Phanteon - Trasera - 1 x3»        → grupo «Cartas Phanteon - 1»
 *
 * Una imagen llamada «__reverso» (o «__back»…) es el reverso común.
 */

const WORDS = 'trasera|reverso|dorso|back';
/** Prefijo (sin separador al final), separador, palabra y, opcionalmente, separador y resto. */
const BACK_NAME = new RegExp(`^(.*[^\\s_-])([\\s_-]+)(?:${WORDS})(?:[\\s_-]+(.*\\S))?$`, 'i');
const COMMON_NAME = new RegExp(`^__(?:${WORDS})$`, 'i');
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Nombre sin la extensión ni el sufijo de copias « xN». */
function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const base = dot > 0 ? fileName.slice(0, dot) : fileName;
  return base.replace(/ x\d+$/, '').trim();
}

/** Grupo de cartas del que es reverso la imagen, o null si su nombre no es de reverso. */
export function backGroup(fileName: string): string | null {
  const match = BACK_NAME.exec(baseName(fileName));
  if (!match) return null;
  const [, prefix, separator, suffix] = match;
  return suffix ? `${prefix}${separator}${suffix}` : prefix;
}

/** Si la imagen es el reverso común («__reverso», «__back»…). */
export function isCommonBackName(fileName: string): boolean {
  return COMMON_NAME.test(baseName(fileName));
}

/** Si la carta es del grupo: su nombre empieza por él y no sigue con una letra o un número. */
function inGroup(cardName: string, group: string): boolean {
  const name = baseName(cardName).toLowerCase();
  const prefix = group.toLowerCase();
  return name.startsWith(prefix) && !LETTER_OR_DIGIT.test(name.charAt(prefix.length));
}

export interface BackPairing {
  /** Imagen añadida que pasa a ser el reverso común, o null. */
  common: number | null;
  /**
   * Imágenes añadidas que son reversos (por su índice), con las cartas de su grupo: entre las
   * añadidas y entre las que ya estaban en la lista. Las de nombre de reverso sin ninguna carta
   * no están: se quedan como cartas.
   */
  backs: { image: number; added: number[]; existing: number[] }[];
}

/**
 * Qué imágenes añadidas son reversos y de qué cartas. `existing` son los nombres de las cartas
 * de la lista que pueden recibir reverso (las que no tienen uno propio ni van sin reverso). Si
 * una carta encaja en varios grupos, gana el más largo.
 */
export function pairBacks(added: string[], existing: string[]): BackPairing {
  const commonIndex = added.findIndex(isCommonBackName);
  const groups = added
    .map((name, image) => ({ image, group: backGroup(name) }))
    .filter((g): g is { image: number; group: string } => g.group !== null);
  const isBack = new Set(groups.map((g) => g.image));

  /** El reverso (índice de imagen) cuyo grupo es el más largo de los que encajan. */
  const bestBack = (name: string) => {
    let best: { image: number; group: string } | null = null;
    for (const g of groups) {
      if (inGroup(name, g.group) && (!best || g.group.length > best.group.length)) best = g;
    }
    return best?.image ?? null;
  };

  const backs = groups.map(({ image }) => ({
    image,
    added: [] as number[],
    existing: [] as number[],
  }));
  const byImage = new Map(backs.map((b) => [b.image, b]));
  added.forEach((name, i) => {
    if (isBack.has(i) || i === commonIndex) return;
    const back = bestBack(name);
    if (back !== null) byImage.get(back)!.added.push(i);
  });
  existing.forEach((name, i) => {
    const back = bestBack(name);
    if (back !== null) byImage.get(back)!.existing.push(i);
  });

  return {
    common: commonIndex === -1 ? null : commonIndex,
    backs: backs.filter((b) => b.added.length + b.existing.length > 0),
  };
}
