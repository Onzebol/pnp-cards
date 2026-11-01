import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n';
import { useCardsStore, type NewImage } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { BackSettings } from './BackSettings';
import { CardTray } from './CardTray';

vi.mock('./loadImages', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadImage: async (file: File, path = file.name): Promise<NewImage> => ({
    name: file.name,
    path,
    blob: file,
    format: 'png',
    widthPx: 744,
    heightPx: 1039,
    dpi: { x: 300, y: 300 },
    thumbUrl: `blob:${file.name}`,
  }),
}));

const image = (name: string, over: Partial<NewImage> = {}): NewImage => ({
  name,
  path: name,
  blob: new Blob(['x'], { type: 'image/png' }),
  format: 'png',
  widthPx: 744,
  heightPx: 1039,
  dpi: { x: 300, y: 300 },
  thumbUrl: `blob:${name}`,
  ...over,
});

const png = (name: string) => new File(['x'], name, { type: 'image/png' });
const store = () => useCardsStore.getState();
const enableBacks = () =>
  useSettingsStore.getState().update({ backs: { enabled: true, flip: 'long' } });

beforeAll(() => i18n.changeLanguage('es'));
beforeEach(() => {
  store().reset();
  useSettingsStore.getState().reset();
  URL.revokeObjectURL = vi.fn();
});

describe('reverso propio de una carta', () => {
  it('se elige desde su información: común, propio (archivo o uno ya cargado) o ninguno', async () => {
    const user = userEvent.setup();
    enableBacks();
    store().addImages([image('egipcio.png'), image('fenicio.png')]);
    render(<CardTray />, { wrapper: MemoryRouter });

    await user.click(screen.getByRole('button', { name: 'Información de egipcio.png' }));
    expect(screen.getByLabelText('Reverso común')).toBeChecked();
    await user.click(screen.getByLabelText('Reverso propio'));
    await user.upload(screen.getByLabelText('Elegir imagen…'), png('templo trasera.png'));
    const [egipcio] = store().cards;
    expect(store().backs).toHaveLength(1);
    expect(egipcio.backId).toBe(store().backs[0].id);
    expect(screen.getByLabelText('Reverso propio')).toBeChecked();
    expect(screen.getByText('Solo lo usa esta carta')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    // La segunda carta elige el mismo reverso, que ya está cargado.
    await user.click(screen.getByRole('button', { name: 'Información de fenicio.png' }));
    await user.click(screen.getByLabelText('Reverso propio'));
    await user.click(screen.getByRole('button', { name: 'templo trasera.png' }));
    expect(store().cards[1].backId).toBe(store().backs[0].id);
    expect(store().backs).toHaveLength(1);
    expect(screen.getByText('Lo usan 2 cartas')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Sin reverso'));
    expect(store().cards[1].noBack).toBe(true);
    expect(store().cards[1].backId).toBeUndefined();
    await user.click(screen.getByLabelText('Reverso común'));
    expect(store().cards[1].noBack).toBe(false);
  });

  it('la tarjeta lleva la marca con su reverso, o «Sin reverso»', () => {
    enableBacks();
    store().addImages([image('egipcio.png'), image('serpiente.png')]);
    const [egipcio, serpiente] = store().cards;
    store().setOwnBack(egipcio.id, store().addBack(image('templo trasera.png')));
    store().setNoBack(serpiente.id, true);
    render(<CardTray />, { wrapper: MemoryRouter });

    const mark = screen.getByTitle('Reverso propio: templo trasera.png');
    expect(mark).toHaveTextContent('Reverso');
    expect(mark.querySelector('img')).toHaveAttribute('src', 'blob:templo trasera.png');
    expect(screen.getByText('Sin reverso')).toBeInTheDocument();
  });

  it('una tira muestra los reversos propios y cuántas cartas usan cada uno', () => {
    enableBacks();
    store().addImages([image('egipcio.png'), image('fenicio.png'), image('estatua.png')]);
    const [egipcio, fenicio, estatua] = store().cards;
    const templo = store().addBack(image('templo trasera.png'));
    store().setOwnBack(egipcio.id, templo);
    store().setOwnBack(fenicio.id, templo);
    store().setOwnBack(estatua.id, store().addBack(image('maravilla trasera.png')));
    render(<CardTray />, { wrapper: MemoryRouter });

    const strip = screen.getByRole('region', { name: 'Reversos propios' });
    const items = within(strip).getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual([
      'templo trasera.png2 cartas',
      'maravilla trasera.png1 carta',
    ]);
  });

  it('avisa del reverso propio que falta y deja buscarlo', async () => {
    const user = userEvent.setup();
    enableBacks();
    store().addImages([image('egipcio.png')]);
    const missing = image('templo trasera.png', { blob: null, thumbUrl: null, missing: true });
    store().setOwnBack(store().cards[0].id, store().addBack(missing));
    render(<CardTray />, { wrapper: MemoryRouter });

    expect(screen.getByText('Falta el reverso')).toBeInTheDocument();
    const strip = screen.getByRole('region', { name: 'Reversos propios' });
    await user.upload(
      within(strip).getByLabelText('Buscar imagen de templo trasera.png'),
      png('templo trasera.png'),
    );
    expect(store().backs[0]).toMatchObject({ missing: false, thumbUrl: 'blob:templo trasera.png' });
    expect(screen.queryByText('Falta el reverso')).not.toBeInTheDocument();
  });

  it('sin reversos activados no hay marcas, tira ni elección', async () => {
    const user = userEvent.setup();
    store().addImages([image('egipcio.png')]);
    store().setOwnBack(store().cards[0].id, store().addBack(image('templo trasera.png')));
    render(<CardTray />, { wrapper: MemoryRouter });

    expect(screen.queryByTitle(/Reverso propio/)).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Reversos propios' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Información de egipcio.png' }));
    expect(screen.queryByLabelText('Reverso propio')).not.toBeInTheDocument();
  });
});

describe('emparejar reversos al añadir imágenes', () => {
  /** Cargador de prueba: cada archivo se convierte en una imagen con su nombre. */
  const loadImages = vi.fn(async (entries: { file: File; path: string }[]) => ({
    images: entries.map((e) => image(e.file.name)),
    failed: [],
  }));

  it('toma las traseras como reversos de su grupo, activa los reversos y deja deshacerlo', async () => {
    const user = userEvent.setup();
    render(<CardTray loadImages={loadImages} />, { wrapper: MemoryRouter });

    await user.upload(screen.getByTestId('file-input'), [
      png('templo - egipcio.png'),
      png('templo - fenicio.png'),
      png('templo - trasera x2.png'),
      png('serpiente.png'),
    ]);
    expect(
      await screen.findByText(
        'Por su nombre, «templo - trasera x2.png» se ha tomado como reverso de 2 cartas. Se han activado los reversos.',
      ),
    ).toBeInTheDocument();
    expect(store().cards.map((c) => c.name)).toEqual([
      'templo - egipcio.png',
      'templo - fenicio.png',
      'serpiente.png',
    ]);
    expect(useSettingsStore.getState().settings.backs.enabled).toBe(true);
    expect(screen.getAllByTitle('Reverso propio: templo - trasera x2.png')).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(store().cards.map((c) => [c.name, c.copies])).toEqual([
      ['templo - egipcio.png', 1],
      ['templo - fenicio.png', 1],
      ['templo - trasera x2.png', 2],
      ['serpiente.png', 1],
    ]);
    expect(store().backs).toEqual([]);
    expect(useSettingsStore.getState().settings.backs.enabled).toBe(false);
    expect(screen.queryByText(/Por su nombre/)).not.toBeInTheDocument();
  });

  it('avisa de varios reversos y del reverso común, sin tocar los reversos si ya estaban activados', async () => {
    const user = userEvent.setup();
    enableBacks();
    render(<CardTray loadImages={loadImages} />, { wrapper: MemoryRouter });

    await user.upload(screen.getByTestId('file-input'), [
      png('__reverso.png'),
      png('elfo - arquero.png'),
      png('elfo - trasera.png'),
      png('orco - jefe.png'),
      png('orco - trasera.png'),
    ]);
    expect(
      await screen.findByText(
        'Por su nombre, 2 imágenes se han tomado como reversos de 2 cartas. «__reverso.png» es ahora el reverso común.',
      ),
    ).toBeInTheDocument();
    expect(store().back?.name).toBe('__reverso.png');
  });

  it('sin nombres de reverso, añade las imágenes como siempre y no avisa', async () => {
    const user = userEvent.setup();
    render(<CardTray loadImages={loadImages} />, { wrapper: MemoryRouter });
    await user.upload(screen.getByTestId('file-input'), [
      png('a.png'),
      png('dragón - trasera.png'),
    ]);
    expect(await screen.findByText('dragón - trasera.png')).toBeInTheDocument();
    expect(screen.queryByText(/Por su nombre/)).not.toBeInTheDocument();
    expect(useSettingsStore.getState().settings.backs.enabled).toBe(false);
  });
});

describe('activar y desactivar los reversos', () => {
  it('sin reversos, los reversos propios salen en la lista como cartas; al volver, se emparejan', async () => {
    const user = userEvent.setup();
    enableBacks();
    store().addImagesPairingBacks([
      image('templo - egipcio.png'),
      image('templo - fenicio.png'),
      image('templo - trasera x2.png'),
    ]);
    render(
      <>
        <BackSettings />
        <CardTray />
      </>,
      { wrapper: MemoryRouter },
    );
    // Se abre la sección «Reverso» de los ajustes (su título, no la marca de las cartas).
    await user.click(screen.getByText('Reverso', { selector: 'summary' }));

    await user.click(screen.getByLabelText(/Añadir reversos/));
    expect(useSettingsStore.getState().settings.backs.enabled).toBe(false);
    expect(screen.getByText('templo - trasera x2.png')).toBeInTheDocument();
    expect(store().cards.map((c) => [c.name, c.copies])).toEqual([
      ['templo - egipcio.png', 1],
      ['templo - fenicio.png', 1],
      ['templo - trasera x2.png', 2],
    ]);

    await user.click(screen.getByLabelText(/Añadir reversos/));
    expect(store().cards.map((c) => c.name)).toEqual([
      'templo - egipcio.png',
      'templo - fenicio.png',
    ]);
    expect(screen.getAllByTitle('Reverso propio: templo - trasera x2.png')).toHaveLength(2);
  });
});
