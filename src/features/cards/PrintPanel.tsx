import { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { track } from '../../analytics/track';
import { downloadUrl as download } from '../../components/download';
import { formatSize } from '../../components/formatSize';
import { lowResolution } from '../../lib/cardInfo';
import { safeFileName } from '../../lib/filename';
import { resolveGrid } from '../../lib/layout';
import { printableBack, printableCards, totalCards, useCardsStore } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import {
  generatePdf as defaultGeneratePdf,
  TaskError,
  type GeneratePdf,
} from '../../workers/pdfClient';
import { PagePreview } from './PagePreview';
import { rotationsOf } from './rotations';
import styles from './CardsPage.module.css';

type Status =
  | { kind: 'idle' }
  | { kind: 'running'; done: number; total: number }
  | { kind: 'ready'; url: string; fileName: string; bytes: number; pages: number }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string };

export function PrintPanel({ generatePdf = defaultGeneratePdf }: { generatePdf?: GeneratePdf }) {
  const { t, i18n } = useTranslation();
  const total = useCardsStore((s) => totalCards(printableCards(s.cards)));
  const perPage = useSettingsStore((s) => resolveGrid(s.settings).perPage);
  // Con reversos, cada página de cartas lleva detrás otra de reversos.
  const sides = useSettingsStore((s) => (s.settings.backs.enabled ? 2 : 1));
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const pages = Math.ceil(total / perPage) * sides;
  const readyUrl = status.kind === 'ready' ? status.url : null;

  // Libera el PDF anterior al generar otro o al salir de la pantalla.
  useEffect(() => {
    return () => {
      if (readyUrl) URL.revokeObjectURL(readyUrl);
    };
  }, [readyUrl]);

  async function generate() {
    const cards = printableCards(useCardsStore.getState().cards);
    const back = printableBack(useCardsStore.getState().back);
    const { settings, openAfter } = useSettingsStore.getState();
    const rotations = rotationsOf(settings, cards);
    const projectName = useCardsStore.getState().name.trim();
    const fileName = projectName ? `${safeFileName(projectName)}.pdf` : t('cards.fileName');
    // La pestaña se abre ya, durante el clic, para que el navegador no la bloquee.
    const tab = openAfter ? window.open('', '_blank') : null;
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ kind: 'running', done: 0, total: totalCards(cards) });

    try {
      const pdf = await generatePdf(
        {
          settings,
          title: projectName || t('cards.pdfTitle'),
          header: {
            name: projectName || t('cards.pdfTitle'),
            // «{{n}}» y «{{total}}» se dejan tal cual: el worker los rellena en cada página.
            pageLabel: t(settings.backs.enabled ? 'cards.headerSheet' : 'cards.headerPage', {
              n: '{{n}}',
              total: '{{total}}',
            }),
          },
          cards: cards.map((c) => ({
            data: c.blob,
            format: c.format,
            widthPx: c.widthPx,
            heightPx: c.heightPx,
            dpi: c.dpi,
            copies: c.copies,
            noBack: c.noBack,
            rotation: c.rotation,
          })),
          back: back && {
            data: back.blob,
            format: back.format,
            widthPx: back.widthPx,
            heightPx: back.heightPx,
          },
        },
        {
          signal: controller.signal,
          onProgress: (done, all) => setStatus({ kind: 'running', done, total: all }),
        },
      );
      const url = URL.createObjectURL(
        new Blob([pdf as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }),
      );
      download(url, fileName);
      if (tab) tab.location.href = url;
      const pages =
        Math.ceil(totalCards(cards) / resolveGrid(settings).perPage) *
        (settings.backs.enabled ? 2 : 1);
      track({
        name: 'pdf-generado',
        pages,
        cards: totalCards(cards),
        layout: settings.mode,
        crop: settings.crop.enabled,
        cutLines: settings.cutLines.enabled,
        bleed: settings.bleed.enabled,
        backs: settings.backs.enabled,
        inkSaver: settings.inkSaver,
        roundedCorners: settings.corners.rounded,
        lowDpi: cards.filter((c, i) => c.blob && lowResolution(c, settings, rotations[i])).length,
      });
      setStatus({
        kind: 'ready',
        url,
        fileName,
        bytes: pdf.byteLength,
        pages,
      });
    } catch (err) {
      tab?.close();
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        track({ name: 'pdf-error', code: err instanceof TaskError ? err.code : 'unknown' });
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        track({ name: 'pdf-cancelado' });
        setStatus({ kind: 'cancelled' });
      } else if (err instanceof TaskError && err.code === 'blank-without-size') {
        setStatus({ kind: 'error', message: t('cards.errorBlank') });
      } else if (err instanceof TaskError && err.code === 'no-template') {
        setStatus({ kind: 'error', message: t('cards.errorTemplate') });
      } else if (err instanceof TaskError && err.code === 'no-back') {
        setStatus({ kind: 'error', message: t('cards.errorNoBack') });
      } else if (err instanceof TaskError && err.code === 'empty') {
        setStatus({ kind: 'error', message: t('cards.errorEmpty') });
      } else {
        setStatus({
          kind: 'error',
          message: t('cards.errorUnknown', {
            message: err instanceof Error ? err.message : String(err),
          }),
        });
      }
    } finally {
      abortRef.current = null;
    }
  }

  const size = (bytes: number) => formatSize(bytes, i18n.resolvedLanguage);

  const running = status.kind === 'running';

  return (
    <div className={styles.print}>
      <div className={styles.mat}>
        <PagePreview />
      </div>
      <div className={styles.printArea}>
        <div aria-live="polite" className={styles.status}>
          {status.kind === 'running' ? (
            <>
              <progress max={status.total} value={status.done} className={styles.progress} />
              <span>{t('cards.generating', { done: status.done, total: status.total })}</span>
            </>
          ) : null}
          {status.kind === 'ready' ? (
            <>
              <span>
                {t('cards.ready', {
                  pages: t('cards.pages', { count: status.pages }),
                  size: size(status.bytes),
                })}
              </span>
              <span className={styles.links}>
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => download(status.url, status.fileName)}
                >
                  {t('cards.downloadAgain')}
                </button>
                <a href={status.url} target="_blank" rel="noopener">
                  {t('cards.openPdf')}
                </a>
              </span>
            </>
          ) : null}
          {status.kind === 'cancelled' ? <span>{t('cards.cancelled')}</span> : null}
          {status.kind === 'error' ? (
            <span role="alert" className={styles.error}>
              {status.message}
            </span>
          ) : null}
        </div>
        <div className={styles.printBar}>
          <span className={styles.pages}>
            {total > 0 ? t('cards.pages', { count: pages }) : null}
          </span>
          {running ? (
            <button
              type="button"
              className={styles.cancel}
              onClick={() => abortRef.current?.abort()}
            >
              {t('cards.cancel')}
            </button>
          ) : (
            <button
              type="button"
              className={styles.generate}
              disabled={total === 0}
              onClick={() => void generate()}
            >
              {t('cards.generate')}
            </button>
          )}
        </div>
        <p className={styles.printNote}>
          <Trans i18nKey="cards.printNote" components={{ strong: <strong /> }} />
        </p>
      </div>
    </div>
  );
}
