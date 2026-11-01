import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { formatSize } from '../../components/formatSize';
import { cardFit, fixedSize, lowResolution, printedDpi } from '../../lib/cardInfo';
import { IMAGE_ACCEPT } from '../../lib/imageFormat';
import { combineRotations, type Rotation } from '../../lib/template';
import { useCardsStore, type CardImage } from '../../store/cardsStore';
import { HeicOfflineError, loadImage } from './loadImages';
import { rotationLabel } from './rotations';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './CardTile.module.css';

const FORMAT_NAMES: Record<string, string> = {
  jpeg: 'JPG',
  png: 'PNG',
  webp: 'WebP',
  tiff: 'TIFF',
  gif: 'GIF',
  bmp: 'BMP',
  avif: 'AVIF',
  heic: 'HEIC',
};

/**
 * Qué reverso lleva la carta: el común, uno propio (un archivo nuevo o uno que ya usan otras
 * cartas) o ninguno.
 */
function BackChoice({ card }: { card: CardImage }) {
  const { t } = useTranslation();
  const backs = useCardsStore((s) => s.backs);
  const users = useCardsStore((s) =>
    card.backId ? s.cards.filter((c) => c.backId === card.backId).length : 0,
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const group = useId();
  const own = card.backId ? backs.find((b) => b.id === card.backId) : undefined;
  const mode = card.noBack ? 'none' : own || picking ? 'own' : 'common';
  const store = useCardsStore.getState;

  const choose = (backId: string) => {
    store().setOwnBack(card.id, backId);
    setPicking(false);
    setError(null);
  };
  async function load(file: File) {
    try {
      choose(store().addBack(await loadImage(file)));
    } catch (err) {
      const offline = err instanceof HeicOfflineError ? ` ${t('cards.heicOffline')}` : '';
      setError(t('settings.backFailed', { name: file.name }) + offline);
    }
  }

  const radio = (value: typeof mode, label: string, select: () => void) => (
    <label className={styles.infoCheck}>
      <input type="radio" name={group} checked={mode === value} onChange={select} />
      {label}
    </label>
  );

  return (
    <fieldset className={styles.infoBack}>
      <legend>{t('cardInfo.back')}</legend>
      {radio('common', t('cardInfo.backCommon'), () => {
        setPicking(false);
        store().setNoBack(card.id, false);
        store().setOwnBack(card.id, null);
      })}
      {radio('own', t('cardInfo.backOwn'), () => {
        store().setNoBack(card.id, false);
        setPicking(true);
      })}
      {mode === 'own' && own && !picking ? (
        <div className={styles.infoBackPicked}>
          {own.thumbUrl ? (
            <img src={own.thumbUrl} alt="" />
          ) : (
            <span className={styles.infoBackEmpty} />
          )}
          <span>
            <span className={styles.infoBackName}>{own.name}</span>
            {own.missing ? (
              <span className={styles.infoWarning}>{t('cardInfo.backMissing')}</span>
            ) : (
              <span className={styles.infoBackUsers}>
                {t('cardInfo.backUsers', { count: users })}
              </span>
            )}
            <button type="button" className={styles.infoLink} onClick={() => setPicking(true)}>
              {t('cardInfo.backChange')}
            </button>
          </span>
        </div>
      ) : null}
      {mode === 'own' && (!own || picking) ? (
        <div className={styles.infoBackPicker}>
          {backs
            .filter((b) => b.id !== card.backId)
            .map((b) => (
              <button
                key={b.id}
                type="button"
                className={styles.infoBackOption}
                onClick={() => choose(b.id)}
              >
                {b.thumbUrl ? (
                  <img src={b.thumbUrl} alt="" />
                ) : (
                  <span className={styles.infoBackEmpty} />
                )}
                <span>{b.name}</span>
              </button>
            ))}
          <label className={styles.infoLink}>
            {t('cardInfo.backFile')}
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              className="visually-hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void load(file);
              }}
            />
          </label>
          {own ? (
            <button type="button" className={styles.infoLink} onClick={() => setPicking(false)}>
              {t('cardInfo.backCancel')}
            </button>
          ) : null}
        </div>
      ) : null}
      {radio('none', t('cardInfo.noBack'), () => {
        setPicking(false);
        store().setNoBack(card.id, true);
      })}
      {error ? <p className={styles.infoWarning}>{error}</p> : null}
    </fieldset>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

interface InfoProps {
  card: CardImage;
  name: string;
  position: number;
  total: number;
  /** Giro con el que sale la carta en la página (elegido o automático). */
  rotation?: Rotation;
  /** Si ese giro se lo da el giro automático. */
  autoRotated?: boolean;
}

/**
 * Datos de la carta en un panel junto a ella: formato, píxeles, ppp, tamaño y cómo sale en el PDF,
 * con los botones para girarla.
 */
function InfoContent({
  card,
  name,
  position,
  total,
  rotation = 0,
  autoRotated = false,
}: InfoProps) {
  const { t, i18n } = useTranslation();
  const settings = useSettingsStore((s) => s.settings);
  const mm = new Intl.NumberFormat(i18n.resolvedLanguage, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const size = (m: { width: number; height: number }) =>
    t('cardInfo.mmValue', { w: mm.format(m.width), h: mm.format(m.height) });

  if (!card.blob && !card.missing) return <p>{t('cardInfo.blank')}</p>;

  const fit = card.blob ? cardFit(card, settings, rotation) : null;
  const printed = card.blob ? printedDpi(card, settings, rotation) : null;
  const low = card.blob ? lowResolution(card, settings, rotation) : false;
  const own = card.rotation ?? 0;
  const rotate = (by: Rotation) =>
    useCardsStore.getState().setRotation(card.id, combineRotations(own, by));
  const format = card.sourceFormat
    ? (FORMAT_NAMES[card.sourceFormat] ?? card.sourceFormat.toUpperCase())
    : null;
  const converted = card.sourceFormat && card.sourceFormat !== card.format;

  return (
    <>
      {card.missing ? <p className={styles.infoWarning}>{t('cardInfo.missing')}</p> : null}
      <dl className={styles.infoList}>
        <Row label={t('cardInfo.file')}>{name}</Row>
        {card.path && card.path !== card.name ? (
          <Row label={t('cardInfo.path')}>{card.path}</Row>
        ) : null}
        {format ? (
          <Row label={t('cardInfo.format')}>
            {converted ? t('cardInfo.converted', { format }) : format}
          </Row>
        ) : null}
        {fit ? (
          <>
            <Row label={t('cardInfo.pixels')}>
              {t('cardInfo.pixelsValue', { w: card.widthPx, h: card.heightPx })}
            </Row>
            <Row label={t('cardInfo.resolution')}>
              {card.dpi ? (
                t('cardInfo.dpiValue', { dpi: card.dpi.x })
              ) : (
                <span className={styles.infoWarning}>{t('cardInfo.noDpi')}</span>
              )}
            </Row>
            {printed !== null && (low || fixedSize(settings)) ? (
              <Row label={t('cardInfo.printed')}>
                {low ? (
                  <span className={styles.infoWarning}>
                    {t('cardInfo.printedLow', { dpi: printed })}
                  </span>
                ) : (
                  t('cardInfo.dpiValue', { dpi: printed })
                )}
              </Row>
            ) : null}
            <Row label={t('cardInfo.physical')}>{size(fit.physicalMm)}</Row>
            <Row label={t('cardInfo.pdf')}>
              {fit.result.kind === 'same'
                ? t('cardInfo.same')
                : fit.result.kind === 'scaled'
                  ? t('cardInfo.scaled', {
                      w: mm.format(fit.result.printedMm.width),
                      h: mm.format(fit.result.printedMm.height),
                      percent: fit.result.percent,
                    })
                  : fit.result.kind === 'distorted'
                    ? t('cardInfo.distorted', {
                        w: mm.format(fit.result.printedMm.width),
                        h: mm.format(fit.result.printedMm.height),
                        px: fit.result.percentX,
                        py: fit.result.percentY,
                      })
                    : fit.result.kind === 'cropped'
                      ? t('cardInfo.cropped', {
                          w: mm.format(fit.result.cropMm.width),
                          h: mm.format(fit.result.cropMm.height),
                        })
                      : t('cardInfo.slot')}
            </Row>
          </>
        ) : null}
        {card.fileBytes ? (
          <Row label={t('cardInfo.weight')}>
            {formatSize(card.fileBytes, i18n.resolvedLanguage)}
          </Row>
        ) : null}
        <Row label={t('cardInfo.copies')}>{card.copies}</Row>
        {card.blob ? (
          <Row label={t('cardInfo.rotation')}>
            {autoRotated
              ? t('cardInfo.rotationAuto', { rotation: rotationLabel(t, rotation) })
              : rotationLabel(t, own)}
          </Row>
        ) : null}
      </dl>
      {card.blob ? (
        <div className={styles.infoRotate} role="group" aria-label={t('cardInfo.rotation')}>
          <button
            type="button"
            title={t('cardInfo.rotateLeft')}
            aria-label={t('cardInfo.rotateLeft')}
            onClick={() => rotate(90)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M3.2 6.2A5 5 0 1 1 3 9" />
              <path d="M2.5 2.5v4h4" />
            </svg>
            90°
          </button>
          <button
            type="button"
            title={t('cardInfo.rotateRight')}
            aria-label={t('cardInfo.rotateRight')}
            onClick={() => rotate(270)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M12.8 6.2A5 5 0 1 0 13 9" />
              <path d="M13.5 2.5v4h-4" />
            </svg>
            90°
          </button>
        </div>
      ) : null}
      {settings.backs.enabled ? <BackChoice card={card} /> : null}
      <p className={styles.infoPosition}>{t('cardInfo.title', { position, total })}</p>
    </>
  );
}

const PANEL_WIDTH = 300;
const MARGIN = 16;
const GAP = 4;
const NARROW = '(max-width: 560px)';

/**
 * Dónde va el panel respecto al botón: debajo si cabe; si no, encima; y si no cabe en ninguno
 * de los dos lados, en el que tenga más hueco, limitando su altura para que se desplace dentro.
 */
function panelPosition(
  button: { top: number; bottom: number; right: number },
  panelHeight: number,
  viewport: { width: number; height: number },
): CSSProperties {
  const left = Math.min(
    Math.max(MARGIN, button.right - PANEL_WIDTH),
    viewport.width - PANEL_WIDTH - MARGIN,
  );
  const below = viewport.height - MARGIN - (button.bottom + GAP);
  const above = button.top - GAP - MARGIN;
  if (panelHeight <= below) return { top: button.bottom + GAP, left };
  if (panelHeight <= above) return { top: button.top - GAP - panelHeight, left };
  if (below >= above) return { top: button.bottom + GAP, left, maxHeight: below };
  return { top: MARGIN, left, maxHeight: above };
}

/** Botón «i» que abre la información de la carta; se cierra con Esc o al pulsar fuera. */
export function CardInfo(props: InfoProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [position, setPosition] = useState<CSSProperties>({});

  // Junto al botón y dentro de la ventana (en pantallas estrechas, el CSS lo pone abajo).
  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !panelRef.current || window.matchMedia(NARROW).matches) {
      return;
    }
    setPosition(
      panelPosition(
        buttonRef.current.getBoundingClientRect(),
        panelRef.current.getBoundingClientRect().height,
        { width: window.innerWidth, height: window.innerHeight },
      ),
    );
  }, [open]);

  // Si la lista se desplaza o cambia la ventana, el panel se cierra en vez de quedarse suelto.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (
        !panelRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    panelRef.current?.focus();
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const closeAndFocus = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={styles.infoButton}
        aria-label={t('cardInfo.info', { name: props.name })}
        title={t('cardInfo.info', { name: props.name })}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7v4.5M8 4.6v.1" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="dialog"
              aria-label={t('cardInfo.info', { name: props.name })}
              tabIndex={-1}
              className={styles.infoPanel}
              style={position}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  closeAndFocus();
                }
              }}
            >
              <InfoContent {...props} />
              <button type="button" className={styles.infoClose} onClick={closeAndFocus}>
                {t('cardInfo.close')}
              </button>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
