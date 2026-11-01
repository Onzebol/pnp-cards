import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import i18n from '../../i18n';
import { useCardsStore, type NewImage } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
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
