import { validateSettings, parseContainerSAS } from './kiosk-settings.js';

export const MAX_ACCESS_FILE_BYTES = 16384;

export function parseAccessFile(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Access file is not valid JSON. Export a new .txt file from Glam Creator.');
  }
  const keys = [
    'schemaVersion', 'type', 'eventPrefix', 'assetContainerSasUrl',
    'requestContainerSasUrl', 'expiresAt',
  ];
  if (!data || Array.isArray(data) || data.schemaVersion !== 1
    || data.type !== 'glam-kiosk-access'
    || Object.keys(data).length !== keys.length
    || !keys.every((key) => Object.hasOwn(data, key))
    || !['eventPrefix', 'assetContainerSasUrl', 'requestContainerSasUrl', 'expiresAt']
      .every((key) => typeof data[key] === 'string' && data[key].length > 0)
    || ['.', '..'].includes(data.eventPrefix)
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(data.expiresAt)) {
    throw new Error('Access file format is invalid. Export a new .txt file from Glam Creator.');
  }
  const settings = validateSettings({
    version: 1,
    containerSAS: data.assetContainerSasUrl,
    requestSAS: data.requestContainerSasUrl,
    eventId: data.eventPrefix,
    activationProfile: 'max',
    formType: 'none',
  });
  const request = parseContainerSAS(settings.requestSAS, Date.now(), 'create');
  if (Date.parse(data.expiresAt) !== Date.parse(settings.expiresAt)
    || Date.parse(data.expiresAt) !== Date.parse(request.expiresAt)) {
    throw new Error('Access file expiry does not match both credentials. Export a new file.');
  }
  return settings;
}

export async function readAccessFile(file) {
  if (!file || !/\.txt$/i.test(file.name)
    || file.size === 0 || file.size > MAX_ACCESS_FILE_BYTES) {
    throw new Error('Choose one nonempty Glam Creator .txt access file, no larger than 16 KB.');
  }
  let text;
  try {
    text = await file.text();
  } catch {
    throw new Error('Access file could not be read. Choose the file again.');
  }
  return parseAccessFile(text);
}
