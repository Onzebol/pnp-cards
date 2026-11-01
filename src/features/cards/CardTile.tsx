import { memo, useId, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { useCardsStore, type CardImage } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { fixedSize, lowResolution, MIN_PRINT_DPI, printedDpi } from '../../lib/cardInfo';
import { IMAGE_ACCEPT } from '../../lib/imageFormat';
import type { Rotation } from '../../lib/template';
import { CardInfo } from './CardInfo';
import { rotationLabel } from './rotations';
import { loadImage } from './loadImages';
import styles from './CardTile.module.css';

/**
 * Número de copias: botones − y + y un campo que deja escribir libremente (solo guarda enteros
 * positivos).
 */
function CopiesInput({ id, copies, name }: { id: string; copies: number; name: string }) {
  const { t } = useTranslation();
  const inputId = useId();
  const [text, setText] = useState(String(copies));
  const [last, setLast] = useState(copies);
  if (copies !== last) {
    setLast(copies);
    setText(String(copies));
  }
  const set = (n: number) => useCardsStore.getState().setCopies(id, n);

  return (
    <div className={styles.copies}>
      <label htmlFor={inputId} className={styles.copiesLabel}>
        {t('cards.copies')}
      </label>
      <div className={styles.stepper}>
        <button
          type="button"
          aria-label={t('cards.copiesLess', { name })}
          disabled={copies <= 1}
          onClick={() => set(copies - 1)}
        >
          −
        </button>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          aria-label={t('cards.copiesOf', { name })}
          onChange={(e) => {
            setText(e.target.value);
            const n = Number(e.target.value);
            if (Number.isInteger(n) && n >= 1) {
              setLast(n);
              set(n);
            }
          }}
          onBlur={() => setText(String(copies))}
        />
        <button
          type="button"
          aria-label={t('cards.copiesMore', { name })}
          onClick={() => set(copies + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}

export const CardTile = memo(function CardTile({
  card,
  position,
  total,
  rotation = 0,
  autoRotated = false,
}: {
  card: CardImage;
  position: number;
  total: number;
  /** Giro con el que sale la carta en la página (elegido o automático). */
  rotation?: Rotation;
  /** Si ese giro se lo da el giro automático. */
  autoRotated?: boolean;
}) {
  const { t } = useTranslation();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });
  const name = card.blob || card.missing ? card.name : t('cards.blankName');
  const settings = useSettingsStore((s) => s.settings);
  const withoutBack = settings.backs.enabled && card.noBack;
  // Reverso propio de la carta (solo con los reversos activados y si no va sin reverso).
  const own = useCardsStore((s) =>
    card.backId ? s.backs.find((b) => b.id === card.backId) : undefined,
  );
  const showOwn = settings.backs.enabled && !card.noBack && own;
  // Ppp con los que saldrá impresa; sin ppp y sin fijar el tamaño, la etiqueta avisa con «?».
  const dpi = card.blob ? printedDpi(card, settings, rotation) : null;
  const low = card.blob ? lowResolution(card, settings, rotation) : false;
  const unknownDpi = !card.dpi && !fixedSize(settings);
  const badge = unknownDpi ? '?' : (dpi ?? card.dpi?.x ?? '?');

  return (
    <li
      ref={setNodeRef}
      className={styles.tile}
      data-dragging={isDragging || undefined}
      data-low={low || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        className={styles.handle}
        aria-label={t('cards.drag', { name })}
        {...attributes}
        {...listeners}
      >
        {card.missing ? (
          <span className={styles.missing} title={card.path}>
            {t('cards.missing')}
          </span>
        ) : card.thumbUrl ? (
          <img
            src={card.thumbUrl}
            alt=""
            width={card.widthPx}
            height={card.heightPx}
            loading="lazy"
            draggable={false}
          />
        ) : (
          <span className={styles.blank} />
        )}
      </button>
      <div className={styles.meta}>
        <span className={styles.name} title={name}>
          {name}
        </span>
        {card.missing ? (
          <label className={styles.find}>
            {t('cards.find')}
            <input
              type="file"
              accept={IMAGE_ACCEPT}
              className="visually-hidden"
              aria-label={t('cards.findNamed', { name })}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file)
                  void loadImage(file)
                    .then((img) => useCardsStore.getState().replaceImage(card.id, img))
                    .catch(() => {});
              }}
            />
          </label>
        ) : null}
        {card.blob ? (
          <span
            className={styles.dpi}
            data-missing={unknownDpi || undefined}
            data-low={low || undefined}
            data-ok={(!low && dpi !== null && dpi >= MIN_PRINT_DPI) || undefined}
          >
            {low ? (
              <>
                <span aria-hidden="true">⚠ </span>
                {t('cards.dpiPrinted', { dpi })}
              </>
            ) : (
              t('cards.dpiBadge', { dpi: badge })
            )}
          </span>
        ) : null}
      </div>
      {withoutBack ? <span className={styles.noBack}>{t('cardInfo.noBack')}</span> : null}
      {showOwn && own.missing ? (
        <span className={styles.noBack} data-missing>
          {t('cards.ownBackMissing')}
        </span>
      ) : null}
      {showOwn && !own.missing ? (
        <span className={styles.ownBack} title={t('cards.ownBackTitle', { name: own.name })}>
          {own.thumbUrl ? <img src={own.thumbUrl} alt="" /> : null}
          {t('cards.ownBack')}
        </span>
      ) : null}
      {card.blob && rotation !== 0 ? (
        <span className={styles.rotated}>
          {t('cards.rotated', { rotation: rotationLabel(t, rotation) })}
        </span>
      ) : null}
      {/* Información y quitar, sobre la esquina de la miniatura. */}
      <div className={styles.tools}>
        <CardInfo
          card={card}
          name={name}
          position={position}
          total={total}
          rotation={rotation}
          autoRotated={autoRotated}
        />
        <button
          type="button"
          className={styles.remove}
          aria-label={t('cards.remove', { name })}
          title={t('cards.remove', { name })}
          onClick={() => useCardsStore.getState().remove(card.id)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <CopiesInput id={card.id} copies={card.copies} name={name} />
    </li>
  );
});
