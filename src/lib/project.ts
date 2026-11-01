import { normalizePath, type ImageRef } from './imageMatch';
import { mergeSettings, type LayoutSettings } from './settings';
import { ROTATIONS, type Rotation } from './template';

/** Extensión de los proyectos: un JSON que apunta a las imágenes de la carpeta del usuario. */
export const PROJECT_EXTENSION = '.pnpcards';
export const PROJECT_MIME = 'application/x-pnpcards';

const FORMAT = 'pnp-cards';
/**
 * 2: reverso común (`back`) y cartas sin reverso (`noBack`). 3: giro por carta (`rotation`) y
 * la casilla de girar las cartas horizontales (`settings.autoRotate`). 4: reverso propio por carta
 * (`back` en cada carta).
 */
const VERSION = 4;

/** Carta del proyecto: ruta dentro de la carpeta de imágenes (y nombre); '' = en blanco. */
export interface ProjectCardRef {
  path: string;
  name: string;
  copies: number;
  /** Solo si es true: la carta no lleva reverso. */
  noBack?: true;
  /** Solo si tiene giro propio (antihorario). */
  rotation?: Exclude<Rotation, 0>;
  /** Solo si tiene reverso propio: su imagen, en la misma carpeta que las cartas. */
  back?: ImageRef;
}

export interface ProjectFile {
  name: string;
  /** Nombre de la carpeta de imágenes, para ayudar a encontrarla al abrir el proyecto. */
  folder: string;
  settings: LayoutSettings;
  cards: ProjectCardRef[];
  /** Imagen del reverso común, en la misma carpeta que las cartas. */
  back: ImageRef | null;
}

/** Clave para saber si dos referencias son la misma imagen. */
export const imageKey = (ref: ImageRef) => normalizePath(ref.path || ref.name);

/** Las imágenes de los reversos propios del proyecto, cada una una vez y en orden de aparición. */
export function ownBackRefs(project: Pick<ProjectFile, 'cards'>): ImageRef[] {
  const seen = new Map<string, ImageRef>();
  for (const { back } of project.cards) {
    if (back && !seen.has(imageKey(back))) seen.set(imageKey(back), back);
  }
  return [...seen.values()];
}

/** Cuántas imágenes hay que buscar en la carpeta: cartas, reverso común y reversos propios. */
export function projectImageCount(project: ProjectFile): number {
  return (
    project.cards.filter((c) => c.name).length +
    (project.back ? 1 : 0) +
    ownBackRefs(project).length
  );
}

export type ProjectErrorCode = 'invalid' | 'newer-version';

export class ProjectError extends Error {
  constructor(readonly code: ProjectErrorCode) {
    super(code);
    this.name = 'ProjectError';
  }
}

export function serializeProject(project: ProjectFile): string {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      app: 'PnP Cards',
      name: project.name,
      folder: project.folder,
      settings: project.settings,
      cards: project.cards.map(({ path, name, copies, noBack, rotation, back }) => ({
        path,
        name,
        copies,
        ...(noBack ? { noBack } : {}),
        ...(rotation ? { rotation } : {}),
        ...(back ? { back: { path: back.path, name: back.name } } : {}),
      })),
      back: project.back ? { path: project.back.path, name: project.back.name } : null,
    },
    null,
    2,
  );
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Giro guardado, si es un cuarto de vuelta distinto de cero. */
function readRotation(value: unknown): Exclude<Rotation, 0> | undefined {
  return ROTATIONS.includes(value as Rotation) && value !== 0
    ? (value as Exclude<Rotation, 0>)
    : undefined;
}

function readBack(value: unknown): ImageRef | null {
  const back = value as Record<string, unknown> | null | undefined;
  const name = str(back?.name);
  return name ? { path: str(back?.path), name } : null;
}

export function parseProject(text: string): ProjectFile {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ProjectError('invalid');
  }
  if (
    !json ||
    json.format !== FORMAT ||
    typeof json.version !== 'number' ||
    !Array.isArray(json.cards)
  ) {
    throw new ProjectError('invalid');
  }
  if (json.version > VERSION) throw new ProjectError('newer-version');

  return {
    name: str(json.name),
    folder: str(json.folder),
    settings: mergeSettings(json.settings as Partial<LayoutSettings> | undefined),
    cards: (json.cards as Record<string, unknown>[]).map((c) => {
      const copies = Number(c?.copies);
      const rotation = readRotation(c?.rotation);
      const back = readBack(c?.back);
      return {
        path: str(c?.path),
        name: str(c?.name),
        copies: Number.isInteger(copies) && copies > 0 ? copies : 1,
        ...(c?.noBack === true ? { noBack: true as const } : {}),
        ...(rotation ? { rotation } : {}),
        ...(back ? { back } : {}),
      };
    }),
    back: readBack(json.back),
  };
}
