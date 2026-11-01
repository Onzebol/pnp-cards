import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from '../../i18n';
import { useCardsStore, type NewImage } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { TaskError, type TaskOptions, type GeneratePdf } from '../../workers/pdfClient';
import { PrintPanel } from './PrintPanel';

const image: NewImage = {
  name: 'a.png',
  path: 'a.png',
  blob: new Blob(['x'], { type: 'image/png' }),
  format: 'png',
  widthPx: 744,
  heightPx: 1039,
  dpi: { x: 300, y: 300 },
  thumbUrl: null,
};

/** Generador controlable desde el test. */
function controllable() {
  let options: TaskOptions = {};
  let resolve!: (pdf: Uint8Array) => void;
  let reject!: (err: unknown) => void;
  const generate = vi.fn<GeneratePdf>((_input, opts) => {
    options = opts ?? {};
    return new Promise((res, rej) => {
      resolve = res;
      reject = rej;
      options.signal?.addEventListener('abort', () =>
        rej(new DOMException('Cancelado', 'AbortError')),
      );
    });
  });
  return {
    generate,
    progress: (done: number, total: number) => act(() => options.onProgress?.(done, total)),
    finish: (bytes = 2_400_000) => act(async () => resolve(new Uint8Array(bytes))),
    fail: (err: unknown) => act(async () => reject(err)),
  };
}

beforeAll(() => i18n.changeLanguage('es'));
beforeEach(() => {
  useCardsStore.getState().reset();
  useSettingsStore.getState().reset();
  useSettingsStore.getState().setOpenAfter(false);
  URL.createObjectURL = vi.fn(() => 'blob:pdf');
  URL.revokeObjectURL = vi.fn();
});

describe('PrintPanel', () => {
  it('no deja generar sin cartas', () => {
    render(<PrintPanel />);
    expect(screen.getByRole('button', { name: 'Generar PDF' })).toBeDisabled();
  });

  it('envía las cartas y la configuración, muestra el progreso y descarga el PDF', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useCardsStore.getState().addImages([{ ...image, name: 'a x10.png' }]);
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);

    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    const [input] = gen.generate.mock.calls[0];
    expect(input.cards).toHaveLength(1);
    expect(input.cards[0]).toMatchObject({ copies: 10, format: 'png', widthPx: 744 });
    expect(input.settings.mode).toBe('vertical9');
    // Sin nombre de proyecto, la cabecera lleva el título genérico; el worker numera las páginas.
    expect(input.header).toEqual({ name: 'Cartas', pageLabel: 'Página {{n}} de {{total}}' });

    gen.progress(4, 10);
    expect(screen.getByText('Generando el PDF: 4 de 10 cartas')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '4');

    await gen.finish();
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByText('PDF listo: 2 páginas, 2,4 MB.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Abrir el PDF' })).toHaveAttribute('href', 'blob:pdf');
  });

  it('con reversos, envía el reverso y qué cartas no lo llevan, y cuenta sus páginas', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useSettingsStore.getState().update({ backs: { enabled: true, flip: 'long' } });
    useCardsStore.getState().setBack({ ...image, name: 'dorso.png', widthPx: 750 });
    useCardsStore.getState().addImages([{ ...image, name: 'a x10.png' }, image]);
    const id = useCardsStore.getState().cards[1].id;
    useCardsStore.getState().setNoBack(id, true);
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);

    // 11 cartas: 2 páginas de cartas y 2 de reversos.
    expect(screen.getByText('4 páginas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    const [input] = gen.generate.mock.calls[0];
    expect(input.back).toMatchObject({ format: 'png', widthPx: 750, heightPx: 1039 });
    expect(input.cards.map((c) => c.noBack ?? false)).toEqual([false, true]);
  });

  it('envía cada reverso propio una vez y qué cartas lo usan; el que falta, sin reverso', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useSettingsStore.getState().update({ backs: { enabled: true, flip: 'long' } });
    const store = useCardsStore.getState();
    store.addImages([image, image, image, image]);
    const [a, b, c] = useCardsStore.getState().cards;
    const templo = store.addBack({ ...image, name: 'templo.png', widthPx: 600 });
    const perdido = store.addBack({ ...image, name: 'x.png', blob: null, missing: true });
    store.setOwnBack(a.id, templo);
    store.setOwnBack(b.id, templo);
    store.setOwnBack(c.id, perdido);
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);

    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    const [input] = gen.generate.mock.calls[0];
    expect(input.backs).toHaveLength(1);
    expect(input.backs![0]).toMatchObject({ format: 'png', widthPx: 600, heightPx: 1039 });
    expect(input.cards.map((c) => [c.ownBack, c.noBack ?? false])).toEqual([
      [0, false],
      [0, false],
      [undefined, true],
      [undefined, false],
    ]);
  });

  it('envía el giro elegido de cada carta', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useCardsStore.getState().addImages([image, { ...image, name: 'b.png' }]);
    useCardsStore.getState().setRotation(useCardsStore.getState().cards[1].id, 90);
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);
    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    const [input] = gen.generate.mock.calls[0];
    expect(input.cards.map((c) => c.rotation)).toEqual([undefined, 90]);
  });

  it('explica que falta la imagen del reverso', async () => {
    const user = userEvent.setup();
    useCardsStore.getState().addImages([image]);
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);

    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    await gen.fail(new TaskError('no-back', 'no-back'));
    expect(screen.getByRole('alert')).toHaveTextContent('Elige la imagen del reverso');
  });

  it('se puede cancelar mientras se genera', async () => {
    const user = userEvent.setup();
    useCardsStore.getState().addImages([image]);
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);

    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(await screen.findByText('Has cancelado la generación del PDF.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Generar PDF' })).toBeEnabled();
  });

  it('explica cómo arreglar una imagen en blanco sin tamaño', async () => {
    const user = userEvent.setup();
    useCardsStore.getState().addImages([image]);
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);

    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    await gen.fail(new TaskError('blank-without-size', 'blank-without-size'));
    expect(screen.getByRole('alert')).toHaveTextContent('fuerza el ancho y el alto');
  });

  it('abre el PDF en una pestaña si está activada la opción', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const tab = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    useSettingsStore.getState().setOpenAfter(true);
    useCardsStore.getState().addImages([image]);
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);

    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    expect(open).toHaveBeenCalledTimes(1);
    await gen.finish();
    expect(tab.location.href).toBe('blob:pdf');
  });

  it('con reversos, la cabecera numera hojas y lleva el nombre del proyecto', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    useCardsStore.getState().addImages([{ ...image, name: 'a x10.png' }]);
    useCardsStore.getState().setName('Dragones del valle');
    useCardsStore.getState().setBack(image);
    useSettingsStore.getState().update({ backs: { enabled: true, flip: 'long' } });
    const gen = controllable();
    render(<PrintPanel generatePdf={gen.generate} />);

    await user.click(screen.getByRole('button', { name: 'Generar PDF' }));
    const [input] = gen.generate.mock.calls[0];
    expect(input.header).toEqual({
      name: 'Dragones del valle',
      pageLabel: 'Hoja {{n}} de {{total}}',
    });
  });

  it('recuerda siempre que hay que imprimir a tamaño real', () => {
    render(<PrintPanel generatePdf={vi.fn()} />);
    const note = screen.getByText(/Al imprimir, elige/);
    expect(note).toHaveTextContent(
      'Al imprimir, elige tamaño real o escala 100 %, no «Ajustar a la página»: si no, las cartas salen más pequeñas.',
    );
    expect(note.querySelectorAll('strong')).toHaveLength(2);
  });
});
