import {
  SETTINGS_KEY, parseContainerSAS, listEvents, loadSettings, saveSettings, clearSettings,
} from '../../scripts/kiosk-settings.js';

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
  const open = node('a', 'Open kiosk window', 'kiosk-settings-open');
  open.href = '/drafts/attendee-kiosk.html';
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  header.append(heading, open);
  const help = node('p', 'Staff setup only. Generate “Kiosk/EDS Access” in Glam Creator, paste the read + list container SAS below, then test and choose your event.');
  const warning = node('p', 'This credential permits reading the entire container, including other events and hidden infrastructure folders. It is saved only in this browser on this origin. Do not share it or paste it into page content.', 'kiosk-settings-warning');
  const form = node('form');
  const status = node('p', '', 'kiosk-settings-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  let testedSAS = '';
  let testing = false;
  let controller;
  let savedEvent = '';
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
  form.append(test);
  const event = field('Event', node('select'));
  event.required = true;
  event.disabled = true;
  event.append(new Option('Test connection to discover events', ''));
  const experience = field('Kiosk experience', node('select'));
  experience.append(new Option('Adobe MAX 2026', 'max'));
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
  const details = node('details', '', 'kiosk-settings-wide');
  details.append(
    node('summary', 'Access and processing notes'),
    warning,
    node('p', 'Glam Creator always renders all four personalized templates for download. Only the chosen print files enter fulfillment. Request access permits creation anywhere in its dedicated container; keep it private. Saving validates its format, not live write permissions. Leave it empty to disable submission. Marketo still requires its approved integration. Open kiosk window uses saved settings, not unsaved edits.'),
  );
  form.append(details);
  const actions = node('div', '', 'kiosk-settings-actions');
  const save = node('button', 'Save booth settings');
  save.type = 'submit';
  save.disabled = true;
  const clear = node('button', 'Clear SAS and settings');
  clear.type = 'button';
  clear.className = 'kiosk-settings-clear';
  actions.append(save, clear);
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
  function invalidate() {
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
  event.addEventListener('change', () => { save.disabled = !event.value || !testedSAS; });
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
    try {
      if (!testedSAS || testedSAS !== sas.value.trim() || !event.value) {
        throw new Error('Test the connection and choose an event before saving.');
      }
      saveSettings(window.localStorage, {
        version: 1,
        containerSAS: testedSAS,
        eventId: event.value,
        activationProfile: experience.value,
        formType: intake.value,
        requestSAS: requests.value.trim(),
        printScope: scope.value,
        showFinalQR: qr.value === 'qr',
      });
      savedEvent = event.value;
      report('Booth settings saved on this browser. Reload the kiosk to apply them. Glam Creator must be running to process print requests.');
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
      savedEvent = saved.eventId;
      intake.value = saved.formType;
      requests.value = saved.requestSAS;
      scope.value = saved.printScope;
      qr.value = saved.showFinalQR ? 'qr' : 'pickup';
      report(`Saved event: ${saved.eventId}. Access expires ${new Date(saved.expiresAt).toLocaleString()}. Test again to verify access.`);
    } else report('This kiosk is unconfigured.');
  } catch (error) { report(error.message, true); }
}
