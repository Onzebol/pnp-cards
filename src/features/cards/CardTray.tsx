import { useMemo, useRef, useState, type DragEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { confirmAction } from '../../components/confirmAction';
import type { FolderFile } from '../../lib/imageMatch';
import { pickFolder as defaultPickFolder, type PickedFolder } from '../../project/folder';
import { track } from '../../analytics/track';
import { isProjectFile } from '../../project/useProjectActions';
import { totalCards, useCardsStore, type PairingResult } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';
import { IMAGE_ACCEPT } from '../../lib/imageFormat';
import { CardTile } from './CardTile';
import { OwnBacks } from './OwnBacks';
import { autoRotatedOf, rotationsOf } from './rotations';
import { loadImages as defaultLoadImages, looseFiles, type LoadResult } from './loadImages';
import styles from './CardTray.module.css';

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

/** Aviso de lo emparejado por nombre: los reversos propios, el común y si se han activado. */
function pairingText(t: TFunction, paired: PairingResult, enabledBacks: boolean) {
  const parts: string[] = [];
  if (paired.backs > 0) {
    parts.push(
      t('cards.paired', {
        count: paired.backs,
        name: paired.first,
        cards: t('cards.pairedCards', { count: paired.cards }),
      }),
    );
  }
  if (paired.common) parts.push(t('cards.pairedCommon', { name: paired.common }));
  if (enabledBacks) parts.push(t('cards.pairedEnabled'));
  return parts.join(' ');
}

export function CardTray({
  loadImages = defaultLoadImages,
  pickFolder = defaultPickFolder,
  onProjectFile,
}: {
  loadImages?: (entries: FolderFile[]) => Promise<LoadResult>;
  pickFolder?: () => Promise<PickedFolder | null>;
  /** Se llama si entre los archivos soltados hay un proyecto (.pnpcards o .bsk). */
  onProjectFile?: (file: File) => void;
}) {
  const { t } = useTranslation();
  const cards = useCardsStore((s) => s.cards);
  const settings = useSettingsStore((s) => s.settings);
  // Giro con el que sale cada carta, y si se lo da el giro automático.
  const rotations = useMemo(() => rotationsOf(settings, cards), [settings, cards]);
  const autoRotated = useMemo(() => autoRotatedOf(settings, cards), [settings, cards]);
  const lastRemoved = useCardsStore((s) => s.lastRemoved);
  const missingCount = cards.filter((c) => c.missing).length;
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(0);
  const [failed, setFailed] = useState<string[]>([]);
  const [heicOffline, setHeicOffline] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [notice, setNotice] = useState('');
  // Aviso del último emparejamiento de reversos por nombre (mientras se pueda deshacer).
  const lastPairing = useCardsStore((s) => s.lastPairing);
  const [pairing, setPairing] = useState<{ text: string; enabledBacks: boolean } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function add(entries: FolderFile[]) {
    if (entries.length === 0) return;
    setLoading(entries.length);
    setFailed([]);
    setHeicOffline(false);
    setNotice('');
    try {
      const result = await loadImages(entries);
      const paired = useCardsStore.getState().addImagesPairingBacks(result.images);
      if (paired) {
        // Si se han encontrado reversos, los reversos se activan: si no, no se verían.
        const { settings, update } = useSettingsStore.getState();
        const enabledBacks = !settings.backs.enabled;
        if (enabledBacks) update({ backs: { ...settings.backs, enabled: true } });
        setPairing({ text: pairingText(t, paired, enabledBacks), enabledBacks });
      }
      setFailed(result.failed);
      setHeicOffline(!!result.heicOffline);
    } finally {
      setLoading(0);
    }
  }

  async function addFolder() {
    const picked = await pickFolder().catch(() => null);
    if (!picked) return;
    // La carpeta añadida pasa a ser la del proyecto: es la que se pedirá al reabrirlo.
    useCardsStore.getState().setFolder(picked.folder);
    track({ name: 'carpeta-añadida' });
    await add(picked.files);
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over && active.id !== over.id) {
      useCardsStore.getState().move(String(active.id), String(over.id));
    }
  }

  const total = totalCards(cards);

  return (
    <section
      className={styles.tray}
      data-dropping={dropping || undefined}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDropping(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDropping(false);
        const files = [...e.dataTransfer.files];
        const project = files.find(isProjectFile);
        if (project && onProjectFile) {
          const others = files.length - 1;
          setNotice(others > 0 ? t('cards.ignoredWithProject', { count: others }) : '');
          onProjectFile(project);
        } else {
          void add(looseFiles(files));
        }
      }}
    >
      <div className={styles.toolbar}>
        <button
          type="button"
          className={styles.primary}
          onClick={() => inputRef.current?.click()}
          disabled={loading > 0}
        >
          {t('cards.add')}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => {
            void add(looseFiles([...(e.target.files ?? [])]));
            e.target.value = '';
          }}
        />
        <button
          type="button"
          className={styles.secondary}
          onClick={() => void addFolder()}
          disabled={loading > 0}
        >
          {t('cards.addFolder')}
        </button>
        <button
          type="button"
          className={styles.secondary}
          onClick={() => useCardsStore.getState().addBlank()}
          disabled={cards.length === 0}
        >
          {t('cards.blank')}
        </button>
        {cards.length > 0 ? (
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              void confirmAction({
                title: t('cards.clearTitle'),
                message: t('cards.clearMessage'),
                confirmLabel: t('cards.clear'),
                danger: true,
              }).then((ok) => ok && useCardsStore.getState().clear());
            }}
          >
            {t('cards.clear')}
          </button>
        ) : null}
        <p className={styles.count} aria-live="polite">
          {cards.length > 0
            ? `${t('cards.files', { count: cards.length })} / ${t('cards.total', { count: total })}`
            : null}
        </p>
      </div>

      {pairing && lastPairing ? (
        <p className={styles.undo} role="status">
          {pairing.text}
          <button
            type="button"
            className={styles.link}
            onClick={() => {
              useCardsStore.getState().undoPairing();
              if (pairing.enabledBacks) {
                const { settings, update } = useSettingsStore.getState();
                update({ backs: { ...settings.backs, enabled: false } });
              }
              setPairing(null);
            }}
          >
            {t('cards.undo')}
          </button>
        </p>
      ) : null}
      {lastRemoved ? (
        <p className={styles.undo} role="status">
          {t('cards.removed', { name: lastRemoved.card.name || t('cards.blankName') })}
          <button
            type="button"
            className={styles.link}
            onClick={() => useCardsStore.getState().undoRemove()}
          >
            {t('cards.undo')}
          </button>
        </p>
      ) : null}
      {notice ? <p className={styles.status}>{notice}</p> : null}
      {missingCount > 0 ? (
        <p className={styles.error} role="status">
          {t('cards.missingWarning', { count: missingCount })}
        </p>
      ) : null}
      {loading > 0 ? (
        <p className={styles.status} role="status">
          {t('cards.loading', { count: loading })}
        </p>
      ) : null}
      {failed.length > 0 ? (
        <p className={styles.error} role="alert">
          {t('cards.failed', { names: failed.join(', ') })}
          {heicOffline ? ` ${t('cards.heicOffline')}` : null}
        </p>
      ) : null}

      <OwnBacks />
      {cards.length === 0 ? (
        <div className={styles.empty}>
          <p>{t('cards.empty')}</p>
          <p className={styles.hint}>{t('cards.emptyHint')}</p>
          <p className={styles.hint}>
            {t('cards.emptyHelp')}{' '}
            <Link to="/help/getting-started">{t('help.topics.getting-started')}</Link>.
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={cards.map((c) => c.id)} strategy={rectSortingStrategy}>
            <ul className={styles.grid}>
              {cards.map((card, i) => (
                <CardTile
                  key={card.id}
                  card={card}
                  position={i + 1}
                  total={cards.length}
                  rotation={rotations[i]}
                  autoRotated={autoRotated[i]}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {dropping ? (
        <div className={styles.dropOverlay} aria-hidden="true">
          {t('cards.dropHere')}
        </div>
      ) : null}
    </section>
  );
}
