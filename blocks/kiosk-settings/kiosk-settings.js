import {
  SETTINGS_KEY, parseContainerSAS, listEvents, loadSettings, saveSettings, clearSettings,
  loadAppearance, saveAppearance, loadGraphView, saveGraphView,
} from '../../scripts/kiosk-settings.js';
import { readAccessFile } from '../../scripts/kiosk-access-import.js';
import {
  TELEMETRY_FIELDS, TELEMETRY_PREFS_KEY, telemetryCredentials, telemetryPreferences,
  validateTelemetryPreferences, telemetryFetch,
} from '../../scripts/kiosk-telemetry-config.js';

function node(tag, text, className) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
}

export default function decorate(block) {
  block.replaceChildren();
  const heading = node('h1', 'Kiosk booth settings');
  const header = node('div', '', 'kiosk-settings-header');
  const open = node('a', 'Open kiosk', 'kiosk-settings-open');
  open.href = '/max2026.html';
  header.append(heading, open);
  const help = node('p', 'Staff setup only. Import the access .txt file exported by Glam Creator, or paste the SAS URLs manually. Then test the connection and save.');
  const warning = node('p', 'This credential permits reading the entire container, including other events and hidden infrastructure folders. It is saved only in this browser on this origin. Do not share it or paste it into page content.', 'kiosk-settings-warning');
  const form = node('form');
  const status = node('p', '', 'kiosk-settings-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  let testedSAS = '';
  let testing = false;
  let controller;
  let savedEvent = '';
  let importRevision = 0;
  const importer = node('div', '', 'kiosk-settings-import kiosk-settings-wide');
  const importHelp = node('p', 'Drop a Glam Creator access .txt file here, or choose a file. Do not paste the complete file into Container SAS URL.');
  importHelp.id = 'kiosk-access-import-help';
  const accessFile = node('input');
  accessFile.type = 'file';
  accessFile.accept = '.txt,text/plain';
  accessFile.id = 'kiosk-access-import-file';
  accessFile.setAttribute('aria-describedby', importHelp.id);
  const importLabel = node('label', 'Import kiosk access file');
  importLabel.htmlFor = accessFile.id;
  importer.append(
    importLabel,
    importHelp,
    accessFile,
    node('p', 'Contains private access credentials. AirDrop only to authorized booth Macs. After saving, delete the file from Downloads and empty Trash. Import does not save settings or contact Azure.'),
  );
  form.append(importer);
  let fieldIndex = 0;
  function field(labelText, input) {
    fieldIndex += 1;
    input.id = `kiosk-settings-${fieldIndex}`;
    const label = node('label', labelText);
    label.htmlFor = input.id;
    const group = node('div', '', 'kiosk-settings-field');
    if (input.tagName === 'INPUT') group.classList.add('kiosk-settings-wide');
    group.append(label, input);
    form.append(group);
    return input;
  }
  const sas = node('input');
  sas.type = 'password';
  sas.autocomplete = 'off';
  sas.spellcheck = false;
  sas.required = true;
  field('Container SAS URL', sas);
  const test = node('button', 'Test connection');
  test.type = 'button';
  test.className = 'kiosk-settings-test';
  const save = node('button', 'Save booth settings');
  save.type = 'submit';
  save.disabled = true;
  const connectionActions = node('div', '', 'kiosk-settings-actions');
  connectionActions.append(test, save);
  form.append(connectionActions);
  const event = field('Event', node('select'));
  event.required = true;
  event.disabled = true;
  event.append(new Option('Test connection to discover events', ''));
  const experience = field('Kiosk experience', node('select'));
  experience.append(new Option('Adobe MAX 2026', 'max'));
  const appearance = field('Activation appearance', node('select'));
  appearance.append(new Option('Light', 'light'));
  appearance.append(new Option('Dark', 'dark'));
  appearance.value = 'dark';
  const graphView = field('Firefly Graph view', node('select'));
  graphView.append(new Option('Current editor', 'editor'));
  graphView.append(new Option('New capsule', 'capsule'));
  const intake = field('Lead capture', node('select'));
  intake.append(new Option('None / separate handheld scanners', 'none'));
  intake.append(new Option('Marketo (integration requires owner validation)', 'marketo'));
  const requests = field('Request container SAS URL (create only)', node('input'));
  requests.type = 'password';
  requests.autocomplete = 'off';
  requests.spellcheck = false;
  const scope = field('Print files', node('select'));
  scope.append(new Option('Selected ad only (MAX default)', 'selected'));
  scope.append(new Option('All four ads', 'all'));
  const qr = field('Final screen', node('select'));
  qr.append(new Option('Show QR code and download link', 'qr'));
  qr.append(new Option('Print pickup instructions', 'pickup'));
  const completed = field('Show completed portraits', node('select'));
  completed.append(new Option('Off — hide completed attendees on this browser', 'hide'));
  completed.append(new Option('On — include completed attendees', 'show'));
  const telemetryHeading = node('div', '', 'kiosk-settings-section-heading kiosk-settings-wide');
  telemetryHeading.append(
    node('h2', 'Telemetry settings'),
    node('p', 'Optional staff reporting. Save booth settings saves these preferences too.'),
  );
  form.append(telemetryHeading);
  const telemetryInputs = TELEMETRY_FIELDS.map((key, index) => {
    const input = field(index === 0 ? 'Telemetry upload SAS URL (optional, create only)'
      : 'Telemetry report SAS URL (optional, read/list)', node('input'));
    input.type = 'password';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.addEventListener('input', () => { importRevision += 1; });
    input.dataset.telemetryField = key;
    return input;
  });
  const station = field('Telemetry station ID', node('select'));
  station.append(new Option('Not configured', ''));
  for (let index = 1; index <= 12; index += 1) {
    const id = `MAX-${String(index).padStart(2, '0')}`;
    station.append(new Option(id, id));
  }
  const zone = field('Event timezone (IANA)', node('input'));
  zone.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const testJourney = field('Telemetry journeys', node('select'));
  testJourney.append(new Option('Attendee journeys', 'attendee'), new Option('Setup/test journeys', 'test'));
  const telemetryStatus = node('p', 'Telemetry is optional and cannot block attendee setup.', 'kiosk-settings-wide');
  telemetryStatus.setAttribute('role', 'status');
  const telemetryTest = node('button', 'Test');
  telemetryTest.type = 'button';
  const telemetryValues = () => Object.fromEntries(TELEMETRY_FIELDS
    .map((key, index) => [key, telemetryInputs[index].value.trim()]));
  telemetryTest.addEventListener('click', async () => {
    telemetryTest.disabled = true;
    try {
      const credentials = telemetryCredentials(telemetryValues());
      if (credentials.status !== 'ready') throw new Error(credentials.error || 'Telemetry access is not configured.');
      const url = new URL(credentials.read);
      url.searchParams.set('restype', 'container');
      url.searchParams.set('comp', 'list');
      url.searchParams.set('maxresults', '1');
      const response = await telemetryFetch(url.href, { maxBytes: 65536 });
      if (!response.ok) throw new Error('Telemetry read access test failed. Kiosk asset access is unaffected.');
      const doc = new DOMParser().parseFromString(await response.text(), 'application/xml');
      if (doc.documentElement.tagName !== 'EnumerationResults') throw new Error('Telemetry returned an invalid listing.');
      telemetryStatus.textContent = 'Telemetry read access works. Upload permissions are format-checked only; no test blob was created.';
    } catch {
      telemetryStatus.textContent = 'Telemetry access test failed or timed out. Check private container, credentials and CORS. Attendee setup is unaffected.';
    } finally { telemetryTest.disabled = false; }
  });
  const dashboard = node('a', 'Open Event Analytics');
  dashboard.href = '/telemetry.html';
  const diagnostics = node('button', 'Refresh');
  diagnostics.type = 'button';
  diagnostics.addEventListener('click', async () => {
    try {
      const { telemetryDiagnostics } = await import('../../scripts/kiosk-telemetry.js');
      const counts = await telemetryDiagnostics();
      const access = telemetryCredentials(telemetryValues());
      telemetryStatus.textContent = `Access: ${access.status}. Pending: ${counts.pending ?? 'storage unavailable'}. Persistence failures: ${counts.persistenceFailures || 0}. Upload failures: ${counts.uploadFailures || 0}. Dropped snapshots: ${counts.dropped || 0}.`;
    } catch { telemetryStatus.textContent = 'Telemetry diagnostics unavailable. Attendee setup is unaffected.'; }
  });
  const telemetryActions = node('div', '', 'kiosk-settings-telemetry-actions kiosk-settings-wide');
  telemetryActions.append(telemetryTest, diagnostics, dashboard);
  form.append(telemetryActions, telemetryStatus);
  const details = node('details', '', 'kiosk-settings-wide');
  details.append(
    node('summary', 'Access and processing notes'),
    warning,
    node('p', 'Glam Creator always renders all four personalized templates for download. Only the chosen print files enter fulfillment. Request access permits creation anywhere in its dedicated container; keep it private. Saving validates its format, not live write permissions. Leave it empty to disable submission. Marketo still requires its approved integration. Open kiosk uses saved settings, not unsaved edits.'),
  );
  form.append(details);
  const actions = node('div', '', 'kiosk-settings-actions');
  const clear = node('button', 'Clear SAS and settings');
  clear.type = 'button';
  clear.className = 'kiosk-settings-clear';
  actions.append(clear);
  form.append(actions);
  const clearConfirmation = node('div', '', 'kiosk-settings-confirm');
  clearConfirmation.hidden = true;
  clearConfirmation.append(node('p', 'Clear the saved SAS and all booth settings on this browser? This does not delete Azure files or revoke the SAS.'));
  const confirm = node('button', 'Confirm clear');
  confirm.type = 'button';
  const cancel = node('button', 'Cancel');
  cancel.type = 'button';
  clearConfirmation.append(confirm, cancel);
  form.append(clearConfirmation);
  block.append(header, help, form, status);
  function report(message, failed = false) {
    status.textContent = message;
    status.setAttribute('role', failed ? 'alert' : 'status');
  }
  appearance.addEventListener('change', () => {
    try {
      saveAppearance(window.localStorage, appearance.value);
      report('Appearance saved. Open kiosk tabs update immediately. No connection test or booth-settings save is needed.');
    } catch (error) { report(error.message, true); }
  });
  graphView.addEventListener('change', () => {
    try {
      saveGraphView(window.localStorage, graphView.value);
      report('Graph view saved. Open kiosk tabs update immediately. Reopen Graph from Coworker to use the selected view.');
    } catch (error) { report(error.message, true); }
  });
  function invalidate() {
    importRevision += 1;
    controller?.abort();
    testedSAS = '';
    event.replaceChildren(new Option('Test connection to discover events', ''));
    event.disabled = true;
    save.disabled = true;
  }
  sas.addEventListener('input', () => {
    invalidate();
    report('SAS changed. Test the connection before saving.');
  });
  requests.addEventListener('input', () => { importRevision += 1; });
  async function importFiles(files) {
    if (testing) {
      report('Wait for the connection test to finish before importing a file.', true);
      return;
    }
    importRevision += 1;
    const revision = importRevision;
    if (files.length !== 1) {
      report('Choose exactly one Glam Creator .txt access file.', true);
      return;
    }
    report('Reading access file…');
    try {
      const imported = await readAccessFile(files[0]);
      if (revision !== importRevision) return;
      invalidate();
      sas.value = imported.containerSAS;
      requests.value = imported.requestSAS;
      telemetryInputs.forEach((input, index) => { input.value = imported[TELEMETRY_FIELDS[index]] || ''; });
      savedEvent = imported.eventId;
      event.replaceChildren(new Option(imported.eventId, imported.eventId));
      report('Access file imported. Nothing saved yet. Click Test connection to verify the event, then Save booth settings.');
      test.focus();
    } catch (error) {
      if (revision === importRevision) report(error.message, true);
    } finally {
      accessFile.value = '';
    }
  }
  accessFile.addEventListener('change', () => importFiles([...accessFile.files]));
  importer.addEventListener('dragover', (dragEvent) => {
    dragEvent.preventDefault();
    dragEvent.dataTransfer.dropEffect = 'copy';
    importer.classList.add('kiosk-settings-dragging');
  });
  importer.addEventListener('dragleave', (dragEvent) => {
    if (!importer.contains(dragEvent.relatedTarget)) {
      importer.classList.remove('kiosk-settings-dragging');
    }
  });
  importer.addEventListener('drop', (dropEvent) => {
    dropEvent.preventDefault();
    importer.classList.remove('kiosk-settings-dragging');
    importFiles([...dropEvent.dataTransfer.files]);
  });
  event.addEventListener('change', () => {
    importRevision += 1;
    save.disabled = !event.value || !testedSAS;
  });
  test.addEventListener('click', async () => {
    if (testing) return;
    invalidate();
    const candidate = sas.value.trim();
    controller = new AbortController();
    const operation = controller;
    testing = true;
    test.disabled = true;
    sas.readOnly = true;
    report('Testing Azure access and listing available events…');
    try {
      const { expiresAt } = parseContainerSAS(candidate);
      const events = await listEvents(candidate, { signal: operation.signal });
      if (operation.signal.aborted) return;
      if (!events.length) throw new Error('Connection succeeded, but no event folders were found.');
      testedSAS = candidate;
      event.replaceChildren(new Option('Choose an event', ''));
      events.forEach((name) => event.append(new Option(name, name)));
      if (events.includes(savedEvent)) event.value = savedEvent;
      event.disabled = false;
      save.disabled = !event.value;
      report(`Connected. Found ${events.length} event(s). Access expires ${new Date(expiresAt).toLocaleString()}.`);
    } catch (error) {
      if (!operation.signal.aborted) report(error.message, true);
    } finally {
      testing = false;
      test.disabled = false;
      sas.readOnly = false;
    }
  });
  form.addEventListener('submit', (submitEvent) => {
    submitEvent.preventDefault();
    importRevision += 1;
    try {
      if (!testedSAS || testedSAS !== sas.value.trim() || !event.value) {
        throw new Error('Test the connection and choose an event before saving.');
      }
      saveSettings(window.localStorage, {
        version: 1,
        containerSAS: testedSAS,
        eventId: event.value,
        activationProfile: experience.value,
        appearance: appearance.value,
        formType: intake.value,
        requestSAS: requests.value.trim(),
        printScope: scope.value,
        showFinalQR: qr.value === 'qr',
        showCompletedPortraits: completed.value === 'show',
        ...telemetryValues(),
      });
      savedEvent = event.value;
      try {
        if (station.value) {
          const prefs = validateTelemetryPreferences({
            stationId: station.value,
            timeZone: zone.value.trim(),
            isTest: testJourney.value === 'test',
          });
          window.localStorage.setItem(TELEMETRY_PREFS_KEY, JSON.stringify(prefs));
          telemetryStatus.textContent = 'Telemetry preferences saved. Reload the kiosk before the next attendee.';
        } else {
          window.localStorage.removeItem(TELEMETRY_PREFS_KEY);
          telemetryStatus.textContent = 'Telemetry station is not configured; collection is disabled.';
        }
        const access = telemetryCredentials(telemetryValues());
        if (access.status === 'invalid') telemetryStatus.textContent += ` ${access.error}`;
      } catch (error) {
        telemetryStatus.textContent = `Booth settings saved, but telemetry preferences were not saved. ${error.message}`;
      }
      report('Booth settings saved on this browser. Appearance updates open kiosk tabs immediately; reload for other changes. Glam Creator must be running to process print requests.');
    } catch (error) { report(error.message, true); }
  });
  clear.addEventListener('click', () => {
    clearConfirmation.hidden = false;
    confirm.focus();
  });
  cancel.addEventListener('click', () => {
    clearConfirmation.hidden = true;
    clear.focus();
  });
  confirm.addEventListener('click', () => {
    try {
      clearSettings(window.localStorage);
      invalidate();
      form.reset();
      savedEvent = '';
      clearConfirmation.hidden = true;
      report('SAS and booth settings cleared. Azure files are unchanged. This kiosk is unconfigured.');
      sas.focus();
    } catch {
      report('Browser storage could not be cleared. Ask booth staff to clear this site’s browser data.', true);
    }
  });
  window.addEventListener('storage', (change) => {
    if (change.key !== SETTINGS_KEY && change.key !== null) return;
    invalidate();
    form.reset();
    savedEvent = '';
    report('Booth settings changed in another tab. Reload this settings page.', true);
  });
  try {
    const saved = loadSettings(window.localStorage);
    if (saved) {
      sas.value = saved.containerSAS;
      testedSAS = saved.containerSAS;
      savedEvent = saved.eventId;
      event.replaceChildren(new Option(saved.eventId, saved.eventId));
      event.disabled = false;
      save.disabled = false;
      intake.value = saved.formType;
      appearance.value = saved.appearance;
      requests.value = saved.requestSAS;
      telemetryInputs.forEach((input, index) => { input.value = saved[TELEMETRY_FIELDS[index]] || ''; });
      scope.value = saved.printScope;
      qr.value = saved.showFinalQR ? 'qr' : 'pickup';
      completed.value = saved.showCompletedPortraits ? 'show' : 'hide';
      report(`Saved event: ${saved.eventId}. Access expires ${new Date(saved.expiresAt).toLocaleString()}. You can save changes using this connection. Test again to verify access or discover other events.`);
    } else report('This kiosk is unconfigured.');
  } catch (error) { report(error.message, true); }
  try {
    const prefs = telemetryPreferences(window.localStorage);
    if (prefs) {
      station.value = prefs.stationId;
      zone.value = prefs.timeZone;
      testJourney.value = prefs.isTest ? 'test' : 'attendee';
    }
    const access = telemetryCredentials(telemetryValues());
    if (access.status === 'invalid') telemetryStatus.textContent = access.error;
  } catch { telemetryStatus.textContent = 'Saved telemetry preferences are invalid. Choose station and timezone again; attendee setup is unaffected.'; }
  try {
    appearance.value = loadAppearance(window.localStorage, appearance.value);
    graphView.value = loadGraphView(window.localStorage);
  } catch (error) { report(error.message, true); }
}
