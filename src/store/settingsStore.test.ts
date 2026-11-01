import { DEFAULT_SETTINGS, mergeSettings } from '../lib/settings';
import { useSettingsStore } from './settingsStore';

describe('settingsStore', () => {
  beforeEach(() => useSettingsStore.getState().reset());

  it('empieza con los valores por defecto de PDFCartas', () => {
    expect(useSettingsStore.getState().settings).toEqual(DEFAULT_SETTINGS);
    expect(useSettingsStore.getState().openAfter).toBe(true);
  });

  it('actualiza parte de la configuración', () => {
    useSettingsStore.getState().update({ marginMm: 5 });
    useSettingsStore
      .getState()
      .update({ bleed: { enabled: true, mm: 3, color: '#ff0000', fill: 'color' } });
    const s = useSettingsStore.getState().settings;
    expect(s.marginMm).toBe(5);
    expect(s.bleed).toEqual({ enabled: true, mm: 3, color: '#ff0000', fill: 'color' });
    expect(s.mode).toBe('vertical9');
  });

  it('el ajuste de la impresora no cambia al abrir un proyecto ni al restablecer', () => {
    const store = useSettingsStore.getState();
    store.update({ backOffsetMm: { x: 1.5, y: -0.5 } });
    store.replace({ ...DEFAULT_SETTINGS, marginMm: 5, backOffsetMm: { x: 3, y: 3 } });
    expect(useSettingsStore.getState().settings.marginMm).toBe(5);
    expect(useSettingsStore.getState().settings.backOffsetMm).toEqual({ x: 1.5, y: -0.5 });
    store.reset();
    expect(useSettingsStore.getState().settings.marginMm).toBe(8);
    expect(useSettingsStore.getState().settings.backOffsetMm).toEqual({ x: 1.5, y: -0.5 });
    store.update({ backOffsetMm: { x: 0, y: 0 } });
  });

  it('al cargar una configuración guardada incompleta, completa lo que falta', () => {
    const merged = mergeSettings({ marginMm: 3, crop: { enabled: true } });
    expect(merged.marginMm).toBe(3);
    expect(merged.crop).toEqual({ ...DEFAULT_SETTINGS.crop, enabled: true });
    expect(merged.cutLines).toEqual(DEFAULT_SETTINGS.cutLines);
    expect(
      mergeSettings({ backOffsetMm: { x: 2 } as { x: number; y: number } }).backOffsetMm,
    ).toEqual({ x: 2, y: 0 });
  });
});
