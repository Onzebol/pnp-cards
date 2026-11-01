import { parseBsk } from './bsk';
import { DEFAULT_SETTINGS } from './settings';

/** Proyecto tal como lo escribe Guardar() de PDFCartas (versión 4). */
const BSK_V4 = `<?xml version="1.0" encoding="utf-8" standalone="yes"?>
<BSK>
  <version>4</version>
  <modo>2</modo>
  <man_tamaño>2</man_tamaño>
  <man_horizontal>1</man_horizontal>
  <man_columnas>4</man_columnas>
  <man_filas>2</man_filas>
  <man_pag_ancho>100</man_pag_ancho>
  <man_pag_alto>150</man_pag_alto>
  <colocar>0</colocar>
  <sep_margen>5</sep_margen>
  <col_derecha>1</col_derecha>
  <col_doblecara>1</col_doblecara>
  <forzar>3</forzar>
  <for_ancho>63,5</for_ancho>
  <for_alto>88</for_alto>
  <recortar>1</recortar>
  <rec_ancho>60</rec_ancho>
  <rec_alto>85</rec_alto>
  <rec_centrado>0</rec_centrado>
  <rec_x>12</rec_x>
  <rec_y>20</rec_y>
  <corte>3</corte>
  <cor_lineas>2</cor_lineas>
  <cor_lin_color>-65536</cor_lin_color>
  <cor_lin_ancho>6</cor_lin_ancho>
  <cor_margen>3</cor_margen>
  <cor_mar_color>-1</cor_mar_color>
  <imagenes>
    <imagen>
      <url>\\img\\Héroe x3.png</url>
      <copias>3</copias>
    </imagen>
    <imagen>
      <url />
      <copias>2</copias>
    </imagen>
    <imagen>
      <url>\\img\\sub\\orco.jpg</url>
      <copias>1</copias>
    </imagen>
  </imagenes>
</BSK>`;

describe('parseBsk', () => {
  const project = parseBsk(BSK_V4);

  it('lee la distribución manual con página personalizada apaisada', () => {
    expect(project.settings).toMatchObject({
      mode: 'manual',
      paper: 'custom',
      landscape: true,
      columns: 4,
      rows: 2,
      customPageMm: { width: 100, height: 150 },
    });
  });

  it('lee la colocación y el orden', () => {
    expect(project.settings).toMatchObject({
      placement: 'separated',
      marginMm: 5,
      rightToLeft: true,
    });
  });

  it('no activa los reversos con la doble cara manual del original', () => {
    expect(project.settings.backs.enabled).toBe(false);
    expect(project.settings).not.toHaveProperty('duplex');
  });

  it('lee el tamaño forzado aunque use coma decimal', () => {
    expect(project.settings).toMatchObject({
      forceWidth: true,
      forceHeight: true,
      cardWidthMm: 63.5,
      cardHeightMm: 88,
    });
  });

  it('lee el recorte con posición', () => {
    expect(project.settings.crop).toEqual({
      enabled: true,
      widthMm: 60,
      heightMm: 85,
      centered: false,
      x: 12,
      y: 20,
    });
  });

  it('convierte los colores ARGB de .NET a hexadecimal', () => {
    expect(project.settings.cutLines).toEqual({
      enabled: true,
      style: 'cross',
      color: '#ff0000',
      widthHundredthsMm: 6,
    });
    expect(project.settings.bleed).toEqual({
      enabled: true,
      mm: 3,
      color: '#ffffff',
      fill: 'color',
    });
  });

  it('lista las imágenes con sus copias; una ruta vacía es una imagen en blanco', () => {
    expect(project.images).toEqual([
      { path: '\\img\\Héroe x3.png', name: 'Héroe x3.png', copies: 3 },
      { path: '', name: '', copies: 2 },
      { path: '\\img\\sub\\orco.jpg', name: 'orco.jpg', copies: 1 },
    ]);
  });

  it('lee los proyectos sin versión: sin grosor de línea', () => {
    const old = parseBsk(
      BSK_V4.replace('<version>4</version>', '')
        .replace('<col_doblecara>1</col_doblecara>', '')
        .replace('<cor_lin_ancho>6</cor_lin_ancho>', ''),
    );
    expect(old.settings.cutLines.widthHundredthsMm).toBe(
      DEFAULT_SETTINGS.cutLines.widthHundredthsMm,
    );
  });

  it('acepta rec_centro, la etiqueta que leía el original al abrir', () => {
    const p = parseBsk(
      BSK_V4.replace(/rec_centrado/g, 'rec_centro').replace('>0</rec_centro', '>1</rec_centro'),
    );
    expect(p.settings.crop.centered).toBe(true);
  });

  it('ignora la marca de orden de bytes del principio', () => {
    expect(parseBsk(String.fromCharCode(0xfeff) + BSK_V4).settings.mode).toBe('manual');
  });

  it('sin colores guardados usa los colores por defecto, no el negro', () => {
    const p = parseBsk(
      BSK_V4.replace('<cor_lin_color>-65536</cor_lin_color>', '').replace(
        '<cor_mar_color>-1</cor_mar_color>',
        '',
      ),
    );
    expect(p.settings.cutLines.color).toBe(DEFAULT_SETTINGS.cutLines.color);
    expect(p.settings.bleed.color).toBe(DEFAULT_SETTINGS.bleed.color);
  });

  it('sin <copias>, deja que las copias salgan del nombre del archivo', () => {
    const p = parseBsk(BSK_V4.replace('<copias>3</copias>', ''));
    expect(p.images[0].copies).toBeNull();
  });

  it('formato antiguo con marca de orden de bytes: el primer nombre queda limpio', () => {
    const p = parseBsk(String.fromCharCode(0xfeff) + 'a.png\r\n');
    expect(p.images[0].name).toBe('a.png');
  });

  it('lee el formato antiguo: una ruta por línea, sin configuración', () => {
    const p = parseBsk('\\img\\a.png\r\n\\img\\b x2.png\r\n');
    expect(p.settings).toEqual(DEFAULT_SETTINGS);
    expect(p.images).toEqual([
      { path: '\\img\\a.png', name: 'a.png', copies: null },
      { path: '\\img\\b x2.png', name: 'b x2.png', copies: null },
    ]);
  });
});
