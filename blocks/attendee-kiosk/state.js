export const STAGES = ['welcome', 'portraits', 'name', 'story', 'graph', 'pacing', 'ads', 'continued', 'banners'];
export const ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export function initialState() {
  return {
    version: 1,
    language: 'en',
    stage: 'welcome',
    consent: false,
    portraitId: null,
    name: '',
    selectedAdId: null,
    sessionId: null,
  };
}

export function validState(state) {
  if (!state || state.version !== 1 || !['en', 'fr'].includes(state.language)
    || !STAGES.includes(state.stage) || typeof state.consent !== 'boolean'
    || typeof state.name !== 'string' || state.name.length > 80) return false;
  if (['portraitId', 'selectedAdId', 'sessionId'].some((key) => (
    state[key] !== null && (typeof state[key] !== 'string' || !ID_PATTERN.test(state[key]))
  ))) return false;
  const index = STAGES.indexOf(state.stage);
  return !(index > 0 && !state.consent)
    && !(index > 1 && !state.portraitId)
    && !(index > 2 && !state.name.trim())
    && !(index > 2 && !state.sessionId)
    && !(index >= 7 && !state.selectedAdId);
}

export function storageKey(config) {
  return `glam-attendee-v1:${config.mode}:${config.apiBase}`;
}

export function loadState(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return initialState();
  const state = JSON.parse(raw);
  if (!validState(state)) throw new Error('Saved attendee state is invalid. Restart to clear it.');
  return state;
}

export function saveState(storage, key, state) {
  if (!validState(state)) throw new Error('Cannot save invalid attendee state.');
  storage.setItem(key, JSON.stringify(state));
}
