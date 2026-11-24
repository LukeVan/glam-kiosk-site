import { loadSettings, SETTINGS_KEY } from '../../scripts/kiosk-settings.js';

// This public verifier is a casual access deterrent, not an authorization boundary.
export const ACCESS_VERIFIER = '199d0cd15309bb5804b0a2a6c3bbb19ff4d72f2e8036f7fe57a4034f4e12bef8';
const SESSION_KEY = 'glam-kiosk-access-v1';

export default function requestKioskAccess(block) {
  if (window.sessionStorage.getItem(SESSION_KEY) === ACCESS_VERIFIER) return null;

  let settingsError;
  try {
    if (loadSettings(window.localStorage)) return null;
  } catch (error) {
    settingsError = error.message;
  }

  return new Promise((resolve) => {
    const form = document.createElement('form');
    form.className = 'kiosk-access-gate';
    const heading = document.createElement('h2');
    heading.textContent = 'Kiosk access';
    const description = document.createElement('p');
    description.textContent = 'Contact the event organizer for the password.';
    const label = document.createElement('label');
    label.textContent = 'Password';
    const input = document.createElement('input');
    input.type = 'password';
    input.autocomplete = 'current-password';
    input.required = true;
    label.append(input);
    const status = document.createElement('p');
    status.setAttribute('role', 'alert');
    if (settingsError) status.textContent = `Saved booth access is unavailable: ${settingsError}`;
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Continue';
    const settings = document.createElement('a');
    settings.href = '/drafts/kiosk-settings.html';
    settings.textContent = 'Configure booth access';
    form.append(heading, description, label, status, submit, settings);
    block.append(form);
    requestAnimationFrame(() => { if (form.isConnected) input.focus(); });

    let settingsChanged;
    function finish() {
      window.removeEventListener('storage', settingsChanged);
      form.remove();
      resolve();
    }
    settingsChanged = (event) => {
      if (event.key !== SETTINGS_KEY) return;
      try {
        if (loadSettings(window.localStorage)) finish();
      } catch (error) {
        status.textContent = `Saved booth access is unavailable: ${error.message}`;
      }
    };
    window.addEventListener('storage', settingsChanged);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input.value));
        const verifier = [...new Uint8Array(digest)]
          .map((byte) => byte.toString(16).padStart(2, '0')).join('');
        if (verifier !== ACCESS_VERIFIER) {
          status.textContent = 'Incorrect password. Please try again.';
          input.value = '';
          input.focus();
          return;
        }
        window.sessionStorage.setItem(SESSION_KEY, ACCESS_VERIFIER);
        input.value = '';
        finish();
      } catch {
        status.textContent = 'Password check unavailable. Check browser storage and use a secure connection.';
      } finally {
        submit.disabled = false;
      }
    });
  });
}
