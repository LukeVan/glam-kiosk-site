const PREFIX = 'glam-kiosk-completed-v1:';
const PORTRAIT = /^azure_[0-9a-f]{64}$/;

export function completedPortraits(storage, eventId) {
  const raw = storage.getItem(`${PREFIX}${eventId}`);
  if (!raw) return [];
  let ids;
  try { ids = JSON.parse(raw); } catch {
    throw new Error('Completed portrait history cannot be read. Ask booth staff.');
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !PORTRAIT.test(id))) {
    throw new Error('Completed portrait history is invalid. Ask booth staff.');
  }
  return [...new Set(ids)];
}

export function markCompleted(storage, eventId, portraitId) {
  if (!PORTRAIT.test(portraitId)) throw new Error('Cannot hide an invalid event portrait.');
  const ids = completedPortraits(storage, eventId);
  if (!ids.includes(portraitId)) ids.push(portraitId);
  storage.setItem(`${PREFIX}${eventId}`, JSON.stringify(ids));
}
