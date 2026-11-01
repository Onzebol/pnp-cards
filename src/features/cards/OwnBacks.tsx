import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { IMAGE_ACCEPT } from '../../lib/imageFormat';
import { useCardsStore } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { loadImage } from './loadImages';
import styles from './OwnBacks.module.css';

/**
 * Tira con los reversos propios del proyecto: cada imagen una vez, con cuántas cartas la usan, y
 * «Buscar…» en las que no se han encontrado al abrir el proyecto.
 */
export function OwnBacks() {
  const { t } = useTranslation();
  const enabled = useSettingsStore((s) => s.settings.backs.enabled);
  const backs = useCardsStore((s) => s.backs);
  const cards = useCardsStore((s) => s.cards);
  const titleId = useId();
  if (!enabled || backs.length === 0) return null;

  return (
    <section className={styles.strip} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.title}>
        {t('cards.ownBacks')}
      </h3>
      <ul className={styles.list}>
        {backs.map((back) => (
          <li key={back.id} className={styles.item} data-missing={back.missing || undefined}>
            {back.thumbUrl ? (
              <img src={back.thumbUrl} alt="" className={styles.thumb} />
            ) : (
              <span className={styles.thumb} />
            )}
            <span className={styles.text}>
              <span className={styles.name} title={back.path}>
                {back.name}
              </span>
              {back.missing ? (
                <label className={styles.find}>
                  {t('cards.find')}
                  <input
                    type="file"
                    accept={IMAGE_ACCEPT}
                    className="visually-hidden"
                    aria-label={t('cards.findNamed', { name: back.name })}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      e.target.value = '';
                      if (file)
                        void loadImage(file)
                          .then((img) => useCardsStore.getState().replaceBack(back.id, img))
                          .catch(() => {});
                    }}
                  />
                </label>
              ) : (
                <span className={styles.uses}>
                  {t('cards.ownBackUses', {
                    count: cards.filter((c) => c.backId === back.id).length,
                  })}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
