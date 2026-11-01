import { useCardsStore } from '../../store/cardsStore';
import { useSettingsStore } from '../../store/settingsStore';

/**
 * Activa o desactiva los reversos. Sin reversos, los reversos propios vuelven a la lista como
 * cartas normales; al activarlos, las cartas con nombre de reverso vuelven a emparejarse.
 */
export function setBacksEnabled(enabled: boolean) {
  const { settings, update } = useSettingsStore.getState();
  update({ backs: { ...settings.backs, enabled } });
  if (enabled) useCardsStore.getState().cardsToBacks();
  else useCardsStore.getState().backsToCards();
}
