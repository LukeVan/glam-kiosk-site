const DB_NAME = 'glam-kiosk-telemetry-v1';
export const MAX_PENDING = 500;
export const MAX_SNAPSHOT_BYTES = 8192;

async function transaction(action, mode = 'readonly') {
  const db = await new Promise((resolve, reject) => {
    let finished = false;
    const request = indexedDB.open(DB_NAME, 1);
    const timer = setTimeout(() => {
      finished = true;
      reject(new Error('idb_timeout'));
    }, 1000);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('outbox')) {
        request.result.createObjectStore('outbox', { keyPath: 'blob' });
      }
    };
    request.onerror = () => { clearTimeout(timer); reject(new Error('idb_open_failed')); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (finished) request.result.close();
      else resolve(request.result);
    };
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('outbox', mode);
      const timer = setTimeout(() => tx.abort(), 1000);
      let value;
      tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
      const failed = () => { clearTimeout(timer); reject(new Error('idb_transaction_failed')); };
      tx.onabort = failed;
      tx.onerror = failed;
      action(tx.objectStore('outbox'), (result) => { value = result; });
    });
  } finally { db.close(); }
}

export async function enqueueSnapshot(snapshot) {
  const body = JSON.stringify(snapshot);
  if (new TextEncoder().encode(body).length > MAX_SNAPSHOT_BYTES) throw new Error('snapshot_too_large');
  const prefix = `${snapshot.eventId}/telemetry/${snapshot.stationId}/${snapshot.journeyId}/`;
  const record = { blob: `${prefix}${snapshot.revision}.json`, body };
  return transaction((store, done) => {
    const request = store.getAll(undefined, MAX_PENDING + 1);
    request.onsuccess = () => {
      const previous = request.result.filter((item) => item.blob.startsWith(prefix));
      // An asynchronously delivered lower revision must never replace a newer snapshot.
      if (previous.some((item) => Number(item.blob.split('/').pop().replace('.json', '')) >= snapshot.revision)) { done(true); return; }
      if (request.result.length - previous.length >= MAX_PENDING) { done(false); return; }
      previous.forEach((item) => store.delete(item.blob));
      store.put(record);
      done(true);
    };
  }, 'readwrite');
}

export function pendingSnapshots(limit = 4, prefix = '') {
  return transaction((store, done) => {
    const range = prefix ? IDBKeyRange.bound(prefix, `${prefix}\uffff`) : undefined;
    const request = store.getAll(range, limit);
    request.onsuccess = () => done(request.result);
  });
}

export function pendingCount() {
  return transaction((store, done) => {
    const request = store.count();
    request.onsuccess = () => done(request.result);
  });
}

export function removeSnapshot(blob) {
  return transaction((store) => store.delete(blob), 'readwrite');
}
