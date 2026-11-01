import { DEFAULT_SETTINGS, mergeSettings } from './settings';

describe('mergeSettings', () => {
  it('completa el relleno del margen de corte con «color» en configuraciones antiguas', () => {
    expect(mergeSettings({ bleed: { enabled: true, mm: 3, color: '#ffffff' } }).bleed).toEqual({
      enabled: true,
      mm: 3,
      color: '#ffffff',
      fill: 'color',
    });
    expect(mergeSettings(undefined).bleed).toEqual(DEFAULT_SETTINGS.bleed);
  });

  it('conserva el relleno guardado en el proyecto', () => {
    expect(
      mergeSettings({ bleed: { enabled: true, mm: 2, color: '#000000', fill: 'mirror' } }).bleed
        .fill,
    ).toBe('mirror');
  });
});
