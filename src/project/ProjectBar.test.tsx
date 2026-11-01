import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../i18n';
import { parseProject, serializeProject, type ProjectFile } from '../lib/project';
import { DEFAULT_SETTINGS } from '../lib/settings';
import { useCardsStore, type ImageFolder } from '../store/cardsStore';
import { useSettingsStore } from '../store/settingsStore';
import { ConfirmHost } from '../components/ConfirmHost';
import { CardsPage } from '../features/cards/CardsPage';
import type { PickedFolder } from './folder';
import { createMemoryStorage, type ProjectStorage } from './storage';
import { StorageContext } from './storageContext';
import { resetSessionOffer } from './useProjectActions';
import { useSessionAutosave } from './useSessionAutosave';

// jsdom no tiene createImageBitmap ni File System Access: se simulan el cargador y las carpetas.
const fake = vi.hoisted(() => ({
  pickFolder: vi.fn<() => Promise<PickedFolder | null>>(),
  reopenFolder: vi.fn<(folder: ImageFolder) => Promise<PickedFolder | null>>(),
}));

vi.mock('../features/cards/loadImages', async (importOriginal) => {
  const real = await importOriginal<typeof import('../features/cards/loadImages')>();
  const loadImage = async (file: File, path = file.name) => ({
    name: file.name,
    path,
    blob: file,
    format: 'png' as const,
    widthPx: 744,
    heightPx: 1039,
    dpi: { x: 300, y: 300 },
    thumbUrl: null,
  });
  return {
    ...real,
    loadImage,
    loadImages: async (entries: { file: File; path: string }[]) => ({
      images: await Promise.all(real.sortByPath(entries).map((e) => loadImage(e.file, e.path))),
      failed: [],
    }),
  };
});

vi.mock('./folder', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  pickFolder: () => fake.pickFolder(),
  reopenFolder: (folder: ImageFolder) => fake.reopenFolder(folder),
}));

const png = (name: string) => new File(['x'], name, { type: 'image/png' });
const folderWith = (name: string, paths: string[], handle: unknown = null): PickedFolder => ({
  folder: { name, handle: handle as FileSystemDirectoryHandle | null },
  files: paths.map((path) => ({ path, file: png(path.split('/').pop()!) })),
});

const projectJson = serializeProject({
  name: 'Mazmorra',
  folder: 'cartas',
  settings: { ...DEFAULT_SETTINGS, mode: 'horizontal8' },
  cards: [
    { path: 'heroes/elfo.png', name: 'elfo.png', copies: 3 },
    { path: '', name: '', copies: 1 },
    { path: 'orco.png', name: 'orco.png', copies: 2 },
  ],
  back: null,
});

function renderPage(storage: ProjectStorage = createMemoryStorage()) {
  render(
    <MemoryRouter>
      <StorageContext value={storage}>
        <CardsPage />
        <ConfirmHost />
      </StorageContext>
    </MemoryRouter>,
  );
  return storage;
}

beforeAll(() => i18n.changeLanguage('es'));
beforeEach(() => {
  resetSessionOffer();
  fake.pickFolder.mockReset();
  fake.reopenFolder.mockReset();
  useCardsStore.getState().reset();
  useSettingsStore.getState().reset();
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

describe('abrir un proyecto', () => {
  it('pide la carpeta de las imágenes y las carga con sus copias', async () => {
    const user = userEvent.setup();
    fake.pickFolder.mockResolvedValue(folderWith('cartas', ['heroes/elfo.png', 'orco.png']));
    renderPage();

    await user.upload(
      screen.getByTestId('project-input'),
      new File([projectJson], 'Mazmorra.pnpcards'),
    );
    expect(await screen.findByText(/El proyecto usa 2 imágenes/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Elegir carpeta…' }));

    expect(await screen.findByText('Has abierto Mazmorra.')).toBeInTheDocument();
    const { cards, name, folder } = useCardsStore.getState();
    expect(name).toBe('Mazmorra');
    expect(folder?.name).toBe('cartas');
    expect(cards.map((c) => [c.path, c.copies])).toEqual([
      ['heroes/elfo.png', 3],
      ['', 1],
      ['orco.png', 2],
    ]);
    expect(useSettingsStore.getState().settings.mode).toBe('horizontal8');
  });

  it('carga el reverso común y las cartas sin reverso', async () => {
    const user = userEvent.setup();
    fake.pickFolder.mockResolvedValue(
      folderWith('cartas', ['heroes/elfo.png', 'orco.png', 'reversos/dorso.png']),
    );
    renderPage();
    const json = serializeProject({
      name: 'Mazmorra',
      folder: 'cartas',
      settings: { ...DEFAULT_SETTINGS, backs: { enabled: true, flip: 'short' } },
      cards: [
        { path: 'heroes/elfo.png', name: 'elfo.png', copies: 3 },
        { path: 'orco.png', name: 'orco.png', copies: 2, noBack: true },
      ],
      back: { path: 'reversos/dorso.png', name: 'dorso.png' },
    });

    await user.upload(screen.getByTestId('project-input'), new File([json], 'Mazmorra.pnpcards'));
    expect(await screen.findByText(/El proyecto usa 3 imágenes/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Elegir carpeta…' }));

    expect(await screen.findByText('Has abierto Mazmorra.')).toBeInTheDocument();
    const { cards, back } = useCardsStore.getState();
    expect(cards.map((c) => [c.path, !!c.noBack])).toEqual([
      ['heroes/elfo.png', false],
      ['orco.png', true],
    ]);
    expect(back).toMatchObject({ path: 'reversos/dorso.png', name: 'dorso.png' });
    expect(useSettingsStore.getState().settings.backs).toEqual({ enabled: true, flip: 'short' });
  });

  it('si el reverso no está en la carpeta, lo dice y lo conserva para no perderlo', async () => {
    const user = userEvent.setup();
    fake.pickFolder.mockResolvedValue(folderWith('cartas', ['elfo.png']));
    renderPage();
    const json = serializeProject({
      name: 'Mazmorra',
      folder: 'cartas',
      settings: DEFAULT_SETTINGS,
      cards: [{ path: 'elfo.png', name: 'elfo.png', copies: 1 }],
      back: { path: 'dorso.png', name: 'dorso.png' },
    });

    await user.upload(screen.getByTestId('project-input'), new File([json], 'Mazmorra.pnpcards'));
    await user.click(await screen.findByRole('button', { name: 'Elegir carpeta…' }));
    expect(await screen.findByText('No se han encontrado: dorso.png')).toBeInTheDocument();
    expect(useCardsStore.getState().back).toMatchObject({ name: 'dorso.png', missing: true });
  });

  describe('con reversos propios', () => {
    const trasera = { path: 'templos/templo trasera.png', name: 'templo trasera.png' };
    const json = serializeProject({
      name: 'Panteón',
      folder: 'cartas',
      settings: { ...DEFAULT_SETTINGS, backs: { enabled: true, flip: 'long' } },
      cards: [
        { path: 'templos/egipcio.png', name: 'egipcio.png', copies: 1, back: trasera },
        { path: 'templos/fenicio.png', name: 'fenicio.png', copies: 1, back: trasera },
        { path: 'serpiente.png', name: 'serpiente.png', copies: 2 },
      ],
      back: null,
    });

    it('carga una sola vez el reverso que comparten varias cartas', async () => {
      const user = userEvent.setup();
      fake.pickFolder.mockResolvedValue(
        folderWith('cartas', [
          'templos/egipcio.png',
          'templos/fenicio.png',
          'templos/templo trasera.png',
          'serpiente.png',
        ]),
      );
      renderPage();

      await user.upload(screen.getByTestId('project-input'), new File([json], 'Panteón.pnpcards'));
      // Tres cartas y un reverso.
      expect(await screen.findByText(/El proyecto usa 4 imágenes/)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Elegir carpeta…' }));

      expect(await screen.findByText('Has abierto Panteón.')).toBeInTheDocument();
      const { cards, backs } = useCardsStore.getState();
      expect(backs).toHaveLength(1);
      expect(backs[0]).toMatchObject(trasera);
      expect(cards.map((c) => c.backId)).toEqual([backs[0].id, backs[0].id, undefined]);
    });

    it('si el reverso propio no está, lo dice una vez y lo conserva para no perderlo', async () => {
      const user = userEvent.setup();
      fake.pickFolder.mockResolvedValue(
        folderWith('cartas', ['templos/egipcio.png', 'templos/fenicio.png', 'serpiente.png']),
      );
      renderPage();

      await user.upload(screen.getByTestId('project-input'), new File([json], 'Panteón.pnpcards'));
      await user.click(await screen.findByRole('button', { name: 'Elegir carpeta…' }));
      expect(
        await screen.findByText('No se han encontrado: templos/templo trasera.png'),
      ).toBeInTheDocument();
      const { cards, backs } = useCardsStore.getState();
      expect(backs).toEqual([expect.objectContaining({ ...trasera, missing: true })]);
      expect(cards[0].backId).toBe(backs[0].id);
    });

    it('al guardar, cada carta lleva la ruta de su reverso propio', async () => {
      const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      let saved: Blob | undefined;
      URL.createObjectURL = vi.fn((blob: Blob) => {
        saved = blob;
        return 'blob:x';
      });
      const card = (name: string) => ({
        name,
        path: name,
        blob: png(name),
        format: 'png' as const,
        widthPx: 1,
        heightPx: 1,
        dpi: null,
        thumbUrl: null,
        copies: 1,
      });
      useCardsStore
        .getState()
        .load(
          'Panteón',
          [{ ...card('egipcio.png'), backId: 'r1' }, card('serpiente.png')],
          { name: 'cartas', handle: null },
          null,
          [{ ...card('templo trasera.png'), path: 'templos/templo trasera.png', id: 'r1' }],
        );
      renderPage();

      await userEvent.setup().click(screen.getByRole('button', { name: 'Guardar archivo' }));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(parseProject(await saved!.text()).cards).toEqual([
        { path: 'egipcio.png', name: 'egipcio.png', copies: 1, back: trasera },
        { path: 'serpiente.png', name: 'serpiente.png', copies: 1 },
      ]);
    });
  });

  it('con cartas en la lista, pregunta antes de sustituir el proyecto', async () => {
    const user = userEvent.setup();
    useCardsStore.getState().load(
      'Actual',
      [
        {
          name: 'a.png',
          path: 'a.png',
          blob: png('a.png'),
          format: 'png',
          widthPx: 1,
          heightPx: 1,
          dpi: null,
          thumbUrl: null,
          copies: 1,
        },
      ],
      null,
    );
    renderPage();
    await user.upload(
      screen.getByTestId('project-input'),
      new File([projectJson], 'Mazmorra.pnpcards'),
    );
    const dialog = await screen.findByRole('alertdialog', { name: '¿Abrir otro proyecto?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByText(/El proyecto usa 2 imágenes/)).not.toBeInTheDocument();

    await user.upload(
      screen.getByTestId('project-input'),
      new File([projectJson], 'Mazmorra.pnpcards'),
    );
    await user.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Abrir proyecto',
      }),
    );
    expect(await screen.findByText(/El proyecto usa 2 imágenes/)).toBeInTheDocument();
  });

  it('dice qué imágenes no ha encontrado en la carpeta', async () => {
    const user = userEvent.setup();
    fake.pickFolder.mockResolvedValue(folderWith('otra', ['orco.png']));
    renderPage();

    await user.upload(
      screen.getByTestId('project-input'),
      new File([projectJson], 'Mazmorra.pnpcards'),
    );
    await user.click(await screen.findByRole('button', { name: 'Elegir carpeta…' }));

    expect(await screen.findByText('No se han encontrado: heroes/elfo.png')).toBeInTheDocument();
    // La carta que falta se conserva (ruta y copias) para no perderla al guardar.
    expect(useCardsStore.getState().cards.map((c) => [c.path, c.copies, !!c.missing])).toEqual([
      ['heroes/elfo.png', 3, true],
      ['', 1, false],
      ['orco.png', 2, false],
    ]);
  });

  it('también se pueden elegir las imágenes sueltas', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.upload(
      screen.getByTestId('project-input'),
      new File([projectJson], 'Mazmorra.pnpcards'),
    );
    await user.upload(await screen.findByTestId('project-images'), [
      png('elfo.png'),
      png('orco.png'),
    ]);
    expect(await screen.findByText('Has abierto Mazmorra.')).toBeInTheDocument();
    expect(useCardsStore.getState().cards).toHaveLength(3);
  });

  it('explica que un archivo no es un proyecto', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderPage();
    await user.upload(screen.getByTestId('project-input'), new File(['hola'], 'nota.pnpcards'));
    expect(
      await screen.findByText('nota.pnpcards no es un proyecto de PnP Cards ni de PDFCartas.'),
    ).toBeInTheDocument();
  });

  it('abre los .bsk de PDFCartas con el mismo paso de la carpeta', async () => {
    const user = userEvent.setup();
    const bsk = `<?xml version="1.0"?><BSK><version>4</version><modo>1</modo><colocar>1</colocar>
      <forzar>0</forzar><recortar>0</recortar><corte>0</corte><col_derecha>0</col_derecha>
      <imagenes>
        <imagen><url>\\img\\goblin x3.png</url></imagen>
        <imagen><url>\\img\\troll.png</url><copias>2</copias></imagen>
      </imagenes></BSK>`;
    fake.pickFolder.mockResolvedValue(folderWith('viejo', ['img/goblin x3.png', 'img/troll.png']));
    renderPage();

    await user.upload(screen.getByTestId('project-input'), new File([bsk], 'viejo.bsk'));
    await user.click(await screen.findByRole('button', { name: 'Elegir carpeta…' }));

    await waitFor(() => expect(useCardsStore.getState().name).toBe('viejo'));
    expect(useCardsStore.getState().cards.map((c) => [c.name, c.copies])).toEqual([
      ['goblin x3.png', 3],
      ['troll.png', 2],
    ]);
    expect(useSettingsStore.getState().settings).toMatchObject({
      mode: 'horizontal8',
      placement: 'together',
    });
  });
});

describe('guardar un proyecto', () => {
  it('descarga <nombre>.pnpcards: un JSON con rutas y copias, sin imágenes', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let saved: Blob | undefined;
    URL.createObjectURL = vi.fn((blob: Blob) => {
      saved = blob;
      return 'blob:x';
    });
    useCardsStore.getState().load(
      '',
      [
        {
          name: 'elfo.png',
          path: 'heroes/elfo.png',
          blob: png('elfo.png'),
          format: 'png',
          widthPx: 1,
          heightPx: 1,
          dpi: null,
          thumbUrl: null,
          copies: 2,
        },
      ],
      { name: 'cartas', handle: null },
    );
    const storage = renderPage();

    await user.type(screen.getByLabelText('Nombre del proyecto'), 'Mi juego');
    await user.click(screen.getByRole('button', { name: 'Guardar archivo' }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    expect((click.mock.contexts[0] as HTMLAnchorElement).download).toBe('Mi juego.pnpcards');
    const project = parseProject(await saved!.text());
    expect(project).toMatchObject({ name: 'Mi juego', folder: 'cartas' });
    expect(project.cards).toEqual([{ path: 'heroes/elfo.png', name: 'elfo.png', copies: 2 }]);
    expect((await storage.listRecent()).map((r) => r.project.name)).toEqual(['Mi juego']);
  });
});

describe('recientes', () => {
  it('reabre un proyecto reciente con su carpeta recordada', async () => {
    const user = userEvent.setup();
    const handle = { name: 'cartas' };
    const storage = createMemoryStorage();
    await storage.addRecent({
      project: parseProject(projectJson),
      folder: { name: 'cartas', handle: handle as unknown as FileSystemDirectoryHandle },
    });
    fake.reopenFolder.mockResolvedValue(
      folderWith('cartas', ['heroes/elfo.png', 'orco.png'], handle),
    );
    renderPage(storage);

    await user.click(screen.getByRole('button', { name: 'Recientes…' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir' }));
    await user.click(await screen.findByRole('button', { name: 'Abrir «cartas»' }));

    await waitFor(() => expect(useCardsStore.getState().cards).toHaveLength(3));
    expect(fake.reopenFolder).toHaveBeenCalledWith(expect.objectContaining({ name: 'cartas' }));
  });
});

describe('sesión', () => {
  function Autosave() {
    useSessionAutosave();
    return null;
  }

  it('al volver, ofrece seguir con la última sesión', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    await storage.saveSession({
      project: parseProject(projectJson),
      folder: { name: 'cartas', handle: null },
    });
    fake.pickFolder.mockResolvedValue(folderWith('cartas', ['heroes/elfo.png', 'orco.png']));
    renderPage(storage);

    expect(await screen.findByText('¿Seguir donde lo dejaste?')).toBeInTheDocument();
    expect(
      screen.getByText('La última vez las imágenes estaban en la carpeta «cartas».'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Elegir carpeta…' }));
    await waitFor(() => expect(useCardsStore.getState().name).toBe('Mazmorra'));
  });

  it('recupera una sesión guardada por una versión anterior, con la configuración antigua', async () => {
    const user = userEvent.setup();
    const storage = createMemoryStorage();
    // Así queda en IndexedDB una sesión de la versión 1: con `duplex`, sin `backs` ni `back`.
    const oldSettings: Partial<typeof DEFAULT_SETTINGS> = { ...DEFAULT_SETTINGS };
    delete oldSettings.backs;
    await storage.saveSession({
      project: {
        name: 'Antigua',
        folder: 'cartas',
        settings: { ...oldSettings, duplex: true } as unknown as typeof DEFAULT_SETTINGS,
        cards: [{ path: 'orco.png', name: 'orco.png', copies: 2 }],
      } as unknown as ProjectFile,
      folder: { name: 'cartas', handle: null },
    });
    fake.pickFolder.mockResolvedValue(folderWith('cartas', ['orco.png']));
    renderPage(storage);

    await user.click(await screen.findByRole('button', { name: 'Elegir carpeta…' }));
    expect(await screen.findByText('Has abierto Antigua.')).toBeInTheDocument();
    expect(screen.getByText('orco.png')).toBeInTheDocument();
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it('guarda la sesión como JSON y carpeta, sin imágenes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const storage = createMemoryStorage();
    render(
      <StorageContext value={storage}>
        <Autosave />
      </StorageContext>,
    );
    act(() => {
      useCardsStore.getState().load(
        'Bosque',
        [
          {
            name: 'a.png',
            path: 'a.png',
            blob: png('a.png'),
            format: 'png',
            widthPx: 1,
            heightPx: 1,
            dpi: null,
            thumbUrl: null,
            copies: 4,
          },
        ],
        { name: 'bosque', handle: null },
      );
    });
    await vi.advanceTimersByTimeAsync(1500);
    const session = await storage.loadSession();
    expect(session?.folder?.name).toBe('bosque');
    expect(session?.project.cards).toEqual([{ path: 'a.png', name: 'a.png', copies: 4 }]);
    expect(Object.keys(session?.project.cards[0] ?? {})).not.toContain('blob');
    vi.useRealTimers();
  });
});

describe('añadir carpeta', () => {
  it('añade las imágenes de la carpeta, ordenadas por ruta, y la recuerda para el proyecto', async () => {
    const user = userEvent.setup();
    fake.pickFolder.mockResolvedValue(folderWith('cartas', ['b/2.png', 'a/1.png']));
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Añadir carpeta' }));
    await waitFor(() => expect(useCardsStore.getState().cards).toHaveLength(2));
    expect(useCardsStore.getState().cards.map((c) => c.path)).toEqual(['a/1.png', 'b/2.png']);
    expect(useCardsStore.getState().folder?.name).toBe('cartas');
  });
});
