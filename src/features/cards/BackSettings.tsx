import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { track } from '../../analytics/track';
import { downloadBlob } from '../../components/download';
import { Checkbox, FieldRow, RadioGroup, Section } from '../../components/form/Fields';
import { NumberField } from '../../components/form/NumberField';
import type { BackFlip } from '../../lib/settings';
import { buildAlignmentSheet as defaultBuildSheet } from '../../pdf/alignmentSheet';
import { useCardsStore, type NewImage } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { IMAGE_ACCEPT } from '../../lib/imageFormat';
import { setBacksEnabled } from './backsToggle';
import { HeicOfflineError, loadImage as defaultLoadImage } from './loadImages';
import styles from './SettingsPanel.module.css';

/** Hasta dónde se puede desplazar el reverso (mm): más es un error al escribir. */
const MAX_OFFSET_MM = 20;

/**
 * Reversos: activarlos, elegir la imagen del reverso común, cómo se da la vuelta al papel y el
 * ajuste de la impresora (hoja de prueba y desplazamiento del reverso).
 */
export function BackSettings({
  loadImage = defaultLoadImage,
  buildSheet = defaultBuildSheet,
}: {
  loadImage?: (file: File) => Promise<NewImage>;
  buildSheet?: typeof defaultBuildSheet;
}) {
  const { t } = useTranslation();
  const backs = useSettingsStore((s) => s.settings.backs);
  const offset = useSettingsStore((s) => s.settings.backOffsetMm);
  const update = useSettingsStore((s) => s.update);
  const back = useCardsStore((s) => s.back);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetError, setSheetError] = useState(false);
  const mm = t('settings.mm');

  async function downloadSheet() {
    const { settings } = useSettingsStore.getState();
    try {
      const bytes = await buildSheet(settings, {
        title: t('sheet.title'),
        front: t('sheet.front'),
        back: t('sheet.back'),
        flip: t(settings.backs.flip === 'long' ? 'sheet.flipLong' : 'sheet.flipShort'),
        stepsFront: [t('sheet.step1'), t('sheet.step2'), t('sheet.step3'), t('sheet.step4')],
        stepsBack: [t('sheet.backStep')],
        square: t('sheet.square'),
        right: t('sheet.right'),
        up: t('sheet.up'),
      });
      downloadBlob(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
        t('settings.testSheetFile'),
      );
      track({ name: 'hoja-de-prueba' });
      setSheetError(false);
    } catch {
      setSheetError(true);
    }
  }

  async function choose(file: File) {
    try {
      useCardsStore.getState().setBack(await loadImage(file));
      setError(null);
    } catch (err) {
      const offline = err instanceof HeicOfflineError ? ` ${t('cards.heicOffline')}` : '';
      setError(t('settings.backFailed', { name: file.name }) + offline);
    }
  }

  return (
    <Section title={t('settings.backs')} help="backs">
      <Checkbox
        label={t('settings.backsEnabled')}
        hint={t('settings.backsHint')}
        checked={backs.enabled}
        onChange={setBacksEnabled}
      />
      {backs.enabled ? (
        <FieldRow>
          <div className={styles.back}>
            <span className={styles.label}>{t('settings.backImage')}</span>
            {back ? (
              <div className={styles.backPicked}>
                {back.thumbUrl ? (
                  <img src={back.thumbUrl} alt="" className={styles.backThumb} />
                ) : (
                  <span className={styles.backThumb} />
                )}
                <span className={styles.backText}>
                  <span className={styles.backName}>{back.name}</span>
                  {back.missing ? (
                    <span className={styles.error}>
                      {t('settings.backMissing', { name: back.name })}
                    </span>
                  ) : (
                    <span className={styles.hint}>
                      {t('settings.backSize', { w: back.widthPx, h: back.heightPx })}
                    </span>
                  )}
                </span>
              </div>
            ) : (
              <p className={styles.hint}>{t('settings.backNone')}</p>
            )}
            <div className={styles.backActions}>
              <button
                type="button"
                className={styles.button}
                onClick={() => inputRef.current?.click()}
              >
                {back ? t('settings.backChange') : t('settings.backChoose')}
              </button>
              {back ? (
                <button
                  type="button"
                  className={styles.reset}
                  onClick={() => useCardsStore.getState().setBack(null)}
                >
                  {t('settings.backRemove')}
                </button>
              ) : null}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept={IMAGE_ACCEPT}
              hidden
              data-testid="back-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void choose(file);
                e.target.value = '';
              }}
            />
            {error ? (
              <p role="alert" className={styles.error}>
                {error}
              </p>
            ) : null}
            <p className={styles.hint}>{t('settings.backFit')}</p>
            <p className={styles.hint}>{t('settings.backPerCard')}</p>
          </div>
          <RadioGroup<BackFlip>
            legend={t('settings.flip')}
            value={backs.flip}
            onChange={(flip) => update({ backs: { ...backs, flip } })}
            options={[
              { value: 'long', label: t('settings.flipLong') },
              { value: 'short', label: t('settings.flipShort') },
            ]}
          />
          <div className={styles.printer}>
            <span className={styles.label}>{t('settings.printer')}</span>
            <p className={styles.hint}>{t('settings.printerHint')}</p>
            <button type="button" className={styles.button} onClick={() => void downloadSheet()}>
              {t('settings.testSheet')}
            </button>
            {sheetError ? (
              <p role="alert" className={styles.error}>
                {t('settings.testSheetFailed')}
              </p>
            ) : null}
            <NumberField
              label={t('settings.offsetX')}
              value={offset.x}
              min={-MAX_OFFSET_MM}
              max={MAX_OFFSET_MM}
              unit={mm}
              onChange={(x) => update({ backOffsetMm: { ...offset, x } })}
            />
            <NumberField
              label={t('settings.offsetY')}
              value={offset.y}
              min={-MAX_OFFSET_MM}
              max={MAX_OFFSET_MM}
              unit={mm}
              onChange={(y) => update({ backOffsetMm: { ...offset, y } })}
            />
            <p className={styles.hint}>{t('settings.offsetHint')}</p>
          </div>
        </FieldRow>
      ) : null}
    </Section>
  );
}
