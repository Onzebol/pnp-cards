import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { useCardsStore, type NewImage } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { CropDialog } from './CropDialog';
import { PagePreview } from './PagePreview';

const image = (name: string, over: Partial<NewImage> = {}): NewImage => ({
  name,
  path: name,
  blob: new Blob(['x'], { type: 'image/png' }),
  format: 'png',
  widthPx: 822,
  heightPx: 1122,
  dpi: { x: 300, y: 300 },
  thumbUrl: `blob:${name}`,
  ...over,
});

const images = (container: HTMLElement) => container.querySelectorAll('image');

beforeAll(() => i18n.changeLanguage('es'));
beforeEach(() => {
  useCardsStore.getState().reset();
  useSettingsStore.getState().reset();
  URL.createObjectURL = vi.fn(() => 'blob:full');
  URL.revokeObjectURL = vi.fn();
});

describe('PagePreview', () => {
  it('invita a añadir cartas cuando no hay ninguna', () => {
    render(<PagePreview />);
    expect(screen.getByText(/Añade cartas para ver/)).toBeInTheDocument();
  });

  it('muestra cada página con sus cartas y deja pasar de una a otra', async () => {
    const user = userEvent.setup();
    useCardsStore.getState().addImages([image('a x10.png')]);
    const { container } = render(<PagePreview />);

    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    expect(images(container)).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
    expect(images(container)).toHaveLength(1);
  });

  it('con reversos, detrás de cada página muestra la de reversos con su imagen', async () => {
    const user = userEvent.setup();
    useSettingsStore.getState().update({ backs: { enabled: true, flip: 'long' } });
    useCardsStore.getState().setBack(image('dorso.png'));
    useCardsStore.getState().addImages([image('a x3.png')]);
    const { container } = render(<PagePreview />);

    expect(screen.getByText('Página 1 de 2')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(screen.getByText('Página 2 de 2 · reversos')).toBeInTheDocument();
    const backs = [...images(container)].map((i) => i.getAttribute('href'));
    expect(backs).toEqual(['blob:dorso.png', 'blob:dorso.png', 'blob:dorso.png']);
  });

  it('con reversos pero sin imagen, pide elegirla', () => {
    useSettingsStore.getState().update({ backs: { enabled: true, flip: 'long' } });
    useCardsStore.getState().setBack(null);
    useCardsStore.getState().addImages([image('a.png')]);
    render(<PagePreview />);
    expect(screen.getByRole('alert')).toHaveTextContent('Elige la imagen del reverso');
  });

  it('dibuja las líneas de corte si están activadas', () => {
    useSettingsStore.getState().update({
      cutLines: { ...DEFAULT_SETTINGS.cutLines, enabled: true, style: 'full' },
    });
    useCardsStore.getState().addImages([image('a.png')]);
    const { container } = render(<PagePreview />);
    expect(container.querySelectorAll('line')).toHaveLength(12);
  });

  it('muestra solo la parte recortada de cada imagen', () => {
    useSettingsStore.getState().update({
      crop: { enabled: true, widthMm: 63, heightMm: 88, centered: true, x: 0, y: 0 },
    });
    useCardsStore.getState().addImages([image('a.png')]);
    const { container } = render(<PagePreview />);
    expect(images(container)[0].parentElement).toHaveAttribute('viewBox', '39 42 744 1039');
  });

  it('con el ahorro de tinta, las cartas pasan por un filtro de grises; sin él, no', () => {
    useCardsStore.getState().addImages([image('a.png')]);
    const { container, rerender } = render(<PagePreview />);
    expect(screen.getByTestId('cards')).not.toHaveAttribute('filter');
    expect(container.querySelector('filter')).toBeNull();

    useSettingsStore.getState().update({ inkSaver: true });
    rerender(<PagePreview />);
    const filter = container.querySelector('filter')!;
    expect(screen.getByTestId('cards')).toHaveAttribute('filter', `url(#${filter.id})`);
    expect(filter.querySelector('feColorMatrix')).toHaveAttribute('values', '0');
    expect(filter.querySelector('feFuncR')).toHaveAttribute('intercept', '0.5');
    // Las líneas de corte quedan fuera del filtro.
    useSettingsStore
      .getState()
      .update({ cutLines: { ...DEFAULT_SETTINGS.cutLines, enabled: true, style: 'full' } });
    rerender(<PagePreview />);
    expect(screen.getByTestId('cards').querySelectorAll('line')).toHaveLength(0);
    expect(container.querySelectorAll('line')).toHaveLength(12);
  });

  it('con relleno de imagen, el margen de corte repite la carta en cada banda', () => {
    useSettingsStore.getState().update({
      bleed: { ...DEFAULT_SETTINGS.bleed, enabled: true, fill: 'mirror' },
    });
    useCardsStore.getState().addImages([image('a.png')]);
    const { container } = render(<PagePreview />);
    // La carta más sus ocho bandas, cada una recortada a su rectángulo.
    expect(images(container)).toHaveLength(9);
    expect(container.querySelectorAll('clipPath')).toHaveLength(8);
    // La primera banda (la izquierda) refleja sobre el borde: -1 0 0 1 0 0.
    const banda =
      container.querySelector('clipPath')!.parentElement!.parentElement!.lastElementChild!
        .lastElementChild!;
    expect(banda.getAttribute('transform')).toBe('matrix(-1 0 0 1 0 0)');
  });

  it('con color plano, el margen de corte son cuatro rectángulos sin recortes', () => {
    useSettingsStore.getState().update({ bleed: { ...DEFAULT_SETTINGS.bleed, enabled: true } });
    useCardsStore.getState().addImages([image('a.png')]);
    const { container } = render(<PagePreview />);
    expect(images(container)).toHaveLength(1);
    expect(container.querySelector('clipPath')).toBeNull();
    expect(container.querySelectorAll('[data-testid="bleed"] rect')).toHaveLength(4);
  });

  it('explica el problema si solo hay imágenes en blanco', () => {
    useCardsStore.getState().addBlank();
    render(<PagePreview />);
    expect(screen.getByRole('alert')).toHaveTextContent('fuerza el ancho y el alto');
  });
});

describe('CropDialog', () => {
  function openWithCrop() {
    useSettingsStore.getState().update({
      crop: { enabled: true, widthMm: 63, heightMm: 88, centered: true, x: 0, y: 0 },
    });
    useCardsStore.getState().addImages([image('a.png')]);
    render(<CropDialog open onClose={() => {}} />);
  }

  it('muestra el tamaño de la imagen y del recorte en píxeles', () => {
    openWithCrop();
    expect(
      screen.getByText('Imagen: 822 × 1122 px (69,6 × 95,0 mm a 300 ppp)'),
    ).toBeInTheDocument();
    expect(screen.getByText('Recorte: 744 × 1039 px')).toBeInTheDocument();
  });

  it('con el recorte centrado, X e Y muestran la posición calculada y no se editan', () => {
    openWithCrop();
    expect(screen.getByLabelText('X')).toHaveValue('39');
    expect(screen.getByLabelText('X')).toBeDisabled();
  });

  it('mover el recorte con las flechas deja de centrarlo', () => {
    openWithCrop();
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Zona recortada' }), {
      key: 'ArrowRight',
      shiftKey: true,
    });
    expect(useSettingsStore.getState().settings.crop).toMatchObject({
      centered: false,
      x: 49,
      y: 42,
    });
  });

  it('avisa si el recorte no cabe en la imagen', async () => {
    const user = userEvent.setup();
    openWithCrop();
    const width = screen.getByLabelText('Ancho');
    await user.clear(width);
    await user.type(width, '100');
    expect(screen.getByText(/no cabe en esta imagen/)).toBeInTheDocument();
  });

  describe('cabecera', () => {
    const texts = (container: HTMLElement) =>
      [...container.querySelectorAll('svg text')].map((el) => el.textContent);

    it('sin la opción no dibuja ningún texto en la página', () => {
      useCardsStore.getState().addImages([image('a.png')]);
      const { container } = render(<PagePreview />);
      expect(texts(container)).toEqual([]);
    });

    it('muestra el nombre del proyecto y el número de página en cada página', async () => {
      const user = userEvent.setup();
      useSettingsStore.getState().update({ header: true });
      useCardsStore.getState().setName('Dragones del valle');
      useCardsStore.getState().addImages([image('a x10.png')]);
      const { container } = render(<PagePreview />);

      expect(texts(container)).toEqual(['Dragones del valle', 'Página 1 de 2']);
      await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
      expect(texts(container)).toEqual(['Dragones del valle', 'Página 2 de 2']);
      expect(screen.queryByText(/La cabecera no cabe/)).not.toBeInTheDocument();
    });

    it('sin nombre de proyecto usa el título genérico', () => {
      useSettingsStore.getState().update({ header: true });
      useCardsStore.getState().addImages([image('a.png')]);
      const { container } = render(<PagePreview />);
      expect(texts(container)).toEqual(['Cartas', 'Página 1 de 1']);
    });

    it('con reversos numera hojas y no la pone en las páginas de reversos', async () => {
      const user = userEvent.setup();
      useSettingsStore.getState().update({ header: true, backs: { enabled: true, flip: 'long' } });
      useCardsStore.getState().setBack(image('dorso.png'));
      useCardsStore.getState().addImages([image('a x10.png')]);
      const { container } = render(<PagePreview />);

      expect(texts(container)).toEqual(['Cartas', 'Hoja 1 de 2']);
      await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
      expect(texts(container)).toEqual([]);
      await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
      expect(texts(container)).toEqual(['Cartas', 'Hoja 2 de 2']);
    });

    it('avisa cuando no cabe en ningún sitio', () => {
      useSettingsStore.getState().update({ header: true, mode: 'manual', marginMm: 1 });
      useCardsStore.getState().addImages([image('a.png')]);
      const { container } = render(<PagePreview />);
      expect(texts(container)).toEqual([]);
      expect(screen.getByText(/La cabecera no cabe/)).toBeInTheDocument();
    });
  });

  describe('regla de comprobación', () => {
    const ruler = () => screen.queryByTestId('ruler');

    it('sin la opción no se dibuja', () => {
      useCardsStore.getState().addImages([image('a.png')]);
      render(<PagePreview />);
      expect(ruler()).not.toBeInTheDocument();
    });

    it('va solo en la primera página, con cinco casillas y «50 mm» en el color de las líneas', async () => {
      const user = userEvent.setup();
      useSettingsStore.getState().update({
        ruler: { enabled: true, allPages: false },
        cutLines: { ...DEFAULT_SETTINGS.cutLines, color: '#ff0000' },
      });
      useCardsStore.getState().addImages([image('a x10.png')]);
      render(<PagePreview />);

      const bar = ruler();
      expect(bar).toBeInTheDocument();
      expect(bar).toHaveAttribute('fill', '#ff0000');
      // El contorno y las cinco casillas rellenas.
      expect(bar!.querySelectorAll('rect')).toHaveLength(6);
      expect(bar).toHaveTextContent('50 mm');
      expect(screen.queryByText(/La regla de comprobación no cabe/)).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
      expect(ruler()).not.toBeInTheDocument();
    });

    it('con «en todas las páginas» va en todas, pero no en las de reversos', async () => {
      const user = userEvent.setup();
      useSettingsStore.getState().update({
        ruler: { enabled: true, allPages: true },
        backs: { enabled: true, flip: 'long' },
      });
      useCardsStore.getState().setBack(image('dorso.png'));
      useCardsStore.getState().addImages([image('a x10.png')]);
      render(<PagePreview />);

      expect(ruler()).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
      expect(ruler()).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
      expect(ruler()).toBeInTheDocument();
    });

    it('avisa cuando no cabe ni abajo ni arriba', () => {
      useSettingsStore
        .getState()
        .update({ ruler: { enabled: true, allPages: false }, mode: 'manual', marginMm: 1 });
      useCardsStore.getState().addImages([image('a.png')]);
      render(<PagePreview />);
      expect(ruler()).not.toBeInTheDocument();
      expect(screen.getByText(/La regla de comprobación no cabe/)).toBeInTheDocument();
    });
  });
});
