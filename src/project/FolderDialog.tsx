import { useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import styles from '../components/Dialog.module.css';
import { useModalDialog } from '../components/useModalDialog';
import { looseFiles } from '../features/cards/loadImages';
import { IMAGE_ACCEPT } from '../lib/imageFormat';
import { projectImageCount } from '../lib/project';
import type { useProjectActions } from './useProjectActions';

type Actions = ReturnType<typeof useProjectActions>;

/** Pide la carpeta de las imágenes de un proyecto (o de la última sesión) para abrirlo. */
export function FolderDialog({ actions }: { actions: Actions }) {
  const { t } = useTranslation();
  const { pending, busy } = actions;
  const ref = useModalDialog(pending !== null);
  const titleId = useId();
  const filesRef = useRef<HTMLInputElement>(null);
  const count = pending ? projectImageCount(pending.project) : 0;
  const name = pending?.project.name ?? '';
  const known = pending?.knownFolder;

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      onClose={actions.cancelPending}
      aria-labelledby={titleId}
    >
      <div className={styles.header}>
        <h2 id={titleId}>
          {pending?.restoring ? t('folder.restoreTitle') : t('folder.title', { name })}
        </h2>
      </div>
      <div className={styles.body}>
        <p>
          {pending?.restoring
            ? t('folder.restoreIntro', { name, count })
            : t('folder.intro', { count })}
        </p>
        <div className={styles.actions}>
          {known?.handle ? (
            <button
              type="button"
              className={styles.primary}
              disabled={busy}
              onClick={() => void actions.useKnownFolder()}
            >
              {t('folder.useKnown', { name: known.name })}
            </button>
          ) : null}
          <button
            type="button"
            className={known?.handle ? styles.secondary : styles.primary}
            disabled={busy}
            onClick={() => void actions.chooseFolder()}
          >
            {t('folder.pickFolder')}
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={() => filesRef.current?.click()}
          >
            {t('folder.pickFiles')}
          </button>
          <button
            type="button"
            className={styles.secondary}
            disabled={busy}
            onClick={actions.cancelPending}
          >
            {pending?.restoring ? t('folder.discard') : t('folder.cancel')}
          </button>
        </div>
        {known && !known.handle ? (
          <p className={styles.muted}>{t('folder.hint', { name: known.name })}</p>
        ) : null}
        {busy ? <p role="status">{t('folder.loading')}</p> : null}
        <input
          ref={filesRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          data-testid="project-images"
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length > 0) void actions.chooseFiles(looseFiles(files));
          }}
        />
      </div>
    </dialog>
  );
}
