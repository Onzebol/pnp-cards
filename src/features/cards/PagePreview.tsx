import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { HeaderPlacement } from '../../lib/header';
import { planDocument, PlanError, type DocumentPlan, type PlannedItem } from '../../lib/plan';
import { RULER_LABEL, rulerCells, type RulerPlacement } from '../../lib/ruler';
import { INK_SAVER_LIGHTEN } from '../../lib/settings';
import { slotLocalSize, slotSvgMatrix } from '../../lib/template';
import {
  printableBack,
  printableCards,
  useCardsStore,
  type CardImage,
  type NewImage,
} from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import styles from './PagePreview.module.css';

type PlanResult = { plan: DocumentPlan } | { error: PlanError } | null;

function usePlan(cards: CardImage[], back: NewImage | null): PlanResult {
  const settings = useSettingsStore((s) => s.settings);
  return useMemo(() => {
    if (cards.length === 0) return null;
    try {
      return {
        plan: planDocument(
          settings,
          cards.map((c) => ({ ...c, blank: c.blob === null })),
          back,
        ),
      };
    } catch (err) {
      if (err instanceof PlanError) return { error: err };
      throw err;
    }
  }, [cards, back, settings]);
}

type PreviewImage = Pick<NewImage, 'thumbUrl' | 'widthPx' | 'heightPx'>;

type Box = { x: number; y: number; width: number; height: number };

/**
 * Una carta (o su reverso) en la página, con la parte recortada oculta igual que en el PDF y,
 * si hay radio, las esquinas redondeadas.
 */
function PreviewCard({
  item,
  card,
  pageHeight,
  radius,
}: {
  item: PlannedItem;
  card: PreviewImage;
  pageHeight: number;
  radius: number;
}) {
  const clipId = useId();
  const { x, width, height } = item.placement;
  const y = pageHeight - item.placement.y - height;
  // Radio limitado a la mitad del lado menor, como en el PDF.
  const rx = (box: Box) => Math.min(radius, box.width / 2, box.height / 2);
  if (!card.thumbUrl) {
    const box = { x, y, width, height };
    return <rect {...box} rx={radius > 0 ? rx(box) : undefined} className={styles.blank} />;
  }
  // Recorte con las esquinas redondeadas, en las coordenadas en que se dibuja la carta.
  const rounded = (content: ReactNode, box: Box) =>
    radius > 0 ? (
      <>
        <clipPath id={clipId}>
          <rect {...box} rx={rx(box)} />
        </clipPath>
        <g clipPath={`url(#${clipId})`}>{content}</g>
      </>
    ) : (
      content
    );
  const crop = item.crop ?? { x: 0, y: 0, width: card.widthPx, height: card.heightPx };
  const picture = (w: number, h: number, px = 0, py = 0) => (
    <svg
      x={px}
      y={py}
      width={w}
      height={h}
      viewBox={`${crop.x} ${crop.y} ${crop.width} ${crop.height}`}
      preserveAspectRatio="none"
    >
      <image
        href={card.thumbUrl!}
        width={card.widthPx}
        height={card.heightPx}
        preserveAspectRatio="none"
      />
    </svg>
  );
  if (item.rotation === undefined) {
    return rounded(picture(width, height, x, y), { x, y, width, height });
  }
  // Carta girada: se dibuja sin girar y la matriz la lleva a su hueco, como en el PDF.
  const local = slotLocalSize(item.placement, item.rotation);
  const matrix = slotSvgMatrix(item.placement, item.rotation, pageHeight);
  return (
    <g transform={`matrix(${matrix.join(' ')})`}>
      {rounded(picture(local.width, local.height), { x: 0, y: 0, ...local })}
    </g>
  );
}

/**
 * Filtro que imita el ahorro de tinta del PDF: escala de grises y, encima, blanco con la misma
 * opacidad (cada canal pasa a `lighten + (1 - lighten) × valor`).
 */
function InkSaverFilter({ id }: { id: string }) {
  const slope = 1 - INK_SAVER_LIGHTEN;
  const channel = { type: 'linear', slope, intercept: INK_SAVER_LIGHTEN } as const;
  return (
    <defs>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncR {...channel} />
          <feFuncG {...channel} />
          <feFuncB {...channel} />
        </feComponentTransfer>
      </filter>
    </defs>
  );
}

/** Cabecera de la página, con la misma colocación que en el PDF (texto girado en el lateral). */
function PreviewHeader({
  header,
  name,
  label,
  pageHeight,
}: {
  header: HeaderPlacement;
  name: string;
  label: string;
  pageHeight: number;
}) {
  const { size, rotation, start, end } = header;
  const at = (p: { x: number; y: number }) =>
    `translate(${p.x} ${pageHeight - p.y}) rotate(${-rotation})`;
  return (
    <g fontSize={size} className={styles.header}>
      <text transform={at(start)}>{name}</text>
      <text transform={at(end)} textAnchor="end">
        {label}
      </text>
    </g>
  );
}

/** Regla de comprobación: contorno, casillas rellenas y rótulo, como en el PDF. */
function PreviewRuler({
  ruler,
  color,
  pageHeight,
}: {
  ruler: RulerPlacement;
  color: string;
  pageHeight: number;
}) {
  const { x, y, width, height, label } = ruler;
  return (
    <g fill={color} stroke={color} className={styles.ruler} data-testid="ruler">
      <rect x={x} y={pageHeight - y - height} width={width} height={height} fill="none" />
      {rulerCells(ruler).map((c, i) => (
        <rect key={i} x={c.x} y={pageHeight - c.y - c.height} width={c.width} height={c.height} />
      ))}
      <text x={label.x} y={pageHeight - label.y} fontSize={label.size} stroke="none">
        {RULER_LABEL}
      </text>
    </g>
  );
}

export function PagePreview() {
  const { t } = useTranslation();
  const all = useCardsStore((s) => s.cards);
  const projectName = useCardsStore((s) => s.name);
  const headerEnabled = useSettingsStore((s) => s.settings.header);
  const rulerEnabled = useSettingsStore((s) => s.settings.ruler.enabled);
  const inkSaver = useSettingsStore((s) => s.settings.inkSaver);
  const filterId = useId();
  const backsEnabled = useSettingsStore((s) => s.settings.backs.enabled);
  const cards = useMemo(() => printableCards(all), [all]);
  const back = printableBack(useCardsStore((s) => s.back));
  const result = usePlan(cards, back);
  const bleedColor = useSettingsStore((s) => s.settings.bleed.color);
  const lineColor = useSettingsStore((s) => s.settings.cutLines.color);
  const [requested, setRequested] = useState(0);

  if (!result) return <p className={styles.message}>{t('preview.empty')}</p>;
  if ('error' in result) {
    return (
      <p className={styles.message} role="alert">
        {t(
          result.error.code === 'empty'
            ? 'cards.errorEmpty'
            : result.error.code === 'no-template'
              ? 'cards.errorTemplate'
              : result.error.code === 'no-back'
                ? 'cards.errorNoBack'
                : 'cards.errorBlank',
        )}
      </p>
    );
  }

  const { plan } = result;
  const index = Math.min(requested, plan.pages.length - 1);
  const page = plan.pages[index];
  const { width: W, height: H } = page.size;
  const isBack = page.side === 'back';

  return (
    <div className={styles.preview}>
      <div className={styles.stage}>
        <svg
          className={styles.page}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t(isBack ? 'preview.labelBack' : 'preview.label', { page: page.number })}
          style={{ '--ratio': W / H } as CSSProperties}
        >
          <rect width={W} height={H} className={styles.paper} />
          {page.bleed.map((r, i) => (
            <rect
              key={i}
              x={r.x}
              y={H - r.y - r.height}
              width={r.width}
              height={r.height}
              fill={bleedColor}
            />
          ))}
          {inkSaver ? <InkSaverFilter id={filterId} /> : null}
          <g filter={inkSaver ? `url(#${filterId})` : undefined} data-testid="cards">
            {page.items.map((item, i) => (
              <PreviewCard
                key={i}
                item={item}
                card={isBack ? back! : cards[item.card]}
                pageHeight={H}
                radius={page.cornerRadius}
              />
            ))}
          </g>
          {page.header ? (
            <PreviewHeader
              header={page.header}
              name={projectName.trim() || t('cards.pdfTitle')}
              label={t(backsEnabled ? 'cards.headerSheet' : 'cards.headerPage', {
                n: page.sheet,
                total: plan.sheets,
              })}
              pageHeight={H}
            />
          ) : null}
          {page.ruler ? <PreviewRuler ruler={page.ruler} color={lineColor} pageHeight={H} /> : null}
          {page.cutLines ? (
            <g stroke={lineColor} className={styles.lines}>
              {page.cutLines.segments.map((s, i) => (
                <line key={i} x1={s.x1} y1={H - s.y1} x2={s.x2} y2={H - s.y2} />
              ))}
            </g>
          ) : null}
        </svg>
      </div>

      <div className={styles.nav}>
        <button
          type="button"
          aria-label={t('preview.prev')}
          disabled={index === 0}
          onClick={() => setRequested(index - 1)}
        >
          ‹
        </button>
        <span aria-live="polite">
          {t(isBack ? 'preview.pageBack' : 'preview.page', {
            page: index + 1,
            pages: plan.pages.length,
          })}
        </span>
        <button
          type="button"
          aria-label={t('preview.next')}
          disabled={index === plan.pages.length - 1}
          onClick={() => setRequested(index + 1)}
        >
          ›
        </button>
      </div>
      {plan.clampedCards.length > 0 ? (
        <p className={styles.warning}>
          {t('preview.clamped', { count: plan.clampedCards.length })}
        </p>
      ) : null}
      {headerEnabled && plan.pages.every((p) => p.header === null) ? (
        <p className={styles.warning}>{t('preview.headerMissing')}</p>
      ) : null}
      {rulerEnabled && plan.pages.every((p) => p.ruler === null) ? (
        <p className={styles.warning}>{t('preview.rulerMissing')}</p>
      ) : null}
    </div>
  );
}
