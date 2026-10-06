import { readConfig } from './config.js';
import {
  initialState, loadState, saveState, storageKey,
} from './state.js';
import { createAPI } from './api.js';
import createAzureAPI from './azure.js';
import { coworkerReady, navigation, send } from './integrations.js';
import copy from './copy.js';
import { createPrintRequest } from './fulfillment.js';
import { blobURL } from '../../scripts/kiosk-settings.js';
import playAdEngulf from './engulf.js';

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function picture(url, label) {
  const image = element('img');
  image.src = url;
  image.alt = label;
  image.loading = 'lazy';
  image.draggable = false;
  image.referrerPolicy = 'no-referrer';
  return image;
}

function appendLinkedText(container, value, urlText) {
  const parts = value.split(urlText);
  parts.forEach((part, index) => {
    if (part) container.append(document.createTextNode(part));
    if (index < parts.length - 1) {
      const link = element('a', urlText);
      link.href = 'https://www.adobe.com/privacy/policy.html';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      container.append(link);
    }
  });
}

export default async function decorate(block) {
  const authoredMode = [...block.children].find((row) => (
    row.children[0]?.textContent.trim().toLowerCase() === 'mode'
  ))?.children[1]?.textContent.trim();
  block.replaceChildren();
  let config;
  try {
    config = readConfig(authoredMode, window.GLAM_KIOSK_CONFIG);
  } catch (error) {
    block.append(
      element('h2', 'Kiosk configuration unavailable / Configuration indisponible'),
      element('p', error.message),
    );
    return;
  }
  let api;
  try {
    api = createAzureAPI(createAPI({ ...config, mode: 'demo' }), window.localStorage)
      || createAPI(config);
  } catch (error) {
    block.append(element('h2', 'Booth settings unavailable'), element('p', error.message));
    return;
  }
  if (api.source === 'azure') config.intakeEnabled = api.intakeEnabled;
  const key = api.source === 'azure'
    ? `glam-attendee-v1:azure:${api.eventId}` : storageKey(config);
  let state = initialState();
  let storageError;
  try {
    state = loadState(window.sessionStorage, key);
  } catch (error) {
    storageError = error;
  }
  let controller;
  let render;
  let timer;
  let epoch = 0;
  let manifest;
  let portrait;
  let frame;
  const loadedFrames = new WeakSet();
  const readyFrames = new WeakSet();
  const homeFocusFrames = new WeakSet();
  const simulatedFrames = new WeakMap();
  let confirmRestart = false;
  let resetting = false;
  let cancelEngulf = () => {};
  const header = element('div', '', 'kiosk-header');
  const logo = picture('/blocks/attendee-kiosk/assets/lockup.png', 'Adobe × L’Oréal Groupe');
  logo.loading = 'eager';
  header.append(logo);
  const tools = element('div', '', 'kiosk-tools');
  const badge = element('div', '', 'kiosk-badge');
  const panel = element('div', '', 'kiosk-panel');
  const frameSlot = element('div', '', 'kiosk-frame-slot');
  block.append(header, tools, badge, panel, frameSlot);

  const text = () => copy[state.language];
  function button(label, action, disabled = false) {
    const node = element('button', label);
    node.type = 'button';
    node.disabled = disabled;
    node.addEventListener('click', action);
    return node;
  }
  function persist(next) {
    saveState(window.sessionStorage, key, next);
    state = next;
  }
  function fail(error) {
    cancelEngulf();
    panel.inert = false;
    panel.removeAttribute('aria-busy');
    frameSlot.hidden = true;
    panel.replaceChildren(
      element('h2', text().error),
      element('p', error.message),
      button(text().retry, () => render()),
    );
    panel.setAttribute('role', 'alert');
  }
  function move(stage, fields = {}) {
    try {
      persist({ ...state, ...fields, stage });
      render();
    } catch (error) {
      fail(error);
    }
  }
  function title(heading, sub) {
    const h = element('h2', heading);
    h.tabIndex = -1;
    panel.append(h);
    if (sub) panel.append(element('p', sub));
    h.focus();
  }
  function cards(items, selectedId, onSelect, variant = '', target = panel) {
    const grid = element('div', '', `kiosk-grid ${variant}`);
    items.forEach((item) => {
      const card = onSelect ? button('', () => onSelect(item)) : element('figure');
      card.className = 'kiosk-card';
      card.dataset.assetId = item.id;
      if (onSelect) {
        card.setAttribute('aria-label', item.label);
        card.setAttribute('aria-pressed', String(item.id === selectedId));
      }
      if (item.demo) card.classList.add('kiosk-demo-card');
      if (item.demo) card.append(element('strong', text().demoPortrait, 'kiosk-demo-label'));
      card.append(
        picture(item.thumbnailUrl || item.url, onSelect ? '' : item.label),
        element('span', item.label),
      );
      grid.append(card);
    });
    target.append(grid);
  }
  function sendCoworker(message) {
    if (frame && (config.coworker.packaged ? readyFrames.has(frame) : loadedFrames.has(frame))) {
      send(frame, config.coworker, message);
    }
  }
  function notifyCoworker() {
    if (resetting || !frame || !portrait) return;
    sendCoworker({
      type: 'KIOSK_SET_NAME',
      name: state.name,
      portrait: new URL(portrait.thumbnailUrl, window.location.origin).href,
    });
    if (state.stage === 'story' && config.coworker.packaged
      && readyFrames.has(frame) && !homeFocusFrames.has(frame)) {
      homeFocusFrames.add(frame);
      sendCoworker({ type: 'KIOSK_FOCUS_HOME_SEND' });
    }
    if (state.stage === 'continued' && manifest) {
      const index = manifest.ads.findIndex((ad) => ad.id === state.selectedAdId);
      const canSend = config.coworker.packaged ? readyFrames.has(frame) : loadedFrames.has(frame);
      if (index >= 0 && canSend && simulatedFrames.get(frame) !== state.selectedAdId) {
        simulatedFrames.set(frame, state.selectedAdId);
        sendCoworker({
          type: 'KIOSK_SIMULATE',
          adIndex: index + 1,
          adUrl: new URL(manifest.ads[index].url, window.location.origin).href,
        });
        if (config.coworker.packaged) {
          sendCoworker({ type: 'KIOSK_FOCUS_SIMULATION_COMPOSER' });
        }
      }
    }
  }
  async function clearCoworker() {
    if (!frame) return;
    const resettingFrame = frame;
    if (config.coworker.packaged && readyFrames.has(resettingFrame)) {
      await new Promise((resolve, reject) => {
        let timeout;
        const acknowledge = (event) => {
          if (event.source !== resettingFrame.contentWindow
            || event.origin !== config.coworker.origin
            || event.data?.type !== 'KIOSK_RESET_DONE') return;
          clearTimeout(timeout);
          window.removeEventListener('message', acknowledge);
          resolve();
        };
        window.addEventListener('message', acknowledge);
        timeout = setTimeout(() => {
          window.removeEventListener('message', acknowledge);
          reject(new Error(text().coworkerResetFailed));
        }, 5000);
        sendCoworker({ type: 'KIOSK_RESET' });
      });
    } else {
      sendCoworker({ type: 'KIOSK_RESET' });
    }
    resettingFrame.remove();
    if (frame === resettingFrame) frame = null;
  }
  async function reset() {
    if (resetting) return;
    cancelEngulf();
    resetting = true;
    controller?.abort();
    clearTimeout(timer);
    epoch += 1;
    try {
      await clearCoworker();
      window.sessionStorage.removeItem(key);
      manifest = null;
      portrait = null;
      storageError = null;
      state = initialState();
      confirmRestart = false;
      render();
    } catch (error) {
      fail(error);
    } finally {
      resetting = false;
    }
  }
  function renderTools() {
    tools.replaceChildren();
    const language = element('div', '', 'kiosk-language');
    [['en', 'Switch to English'], ['fr', 'Passer en français']]
      .forEach(([languageCode, label]) => {
        const toggle = button('', () => {
          try {
            persist({ ...state, language: languageCode });
            render();
          } catch (error) { fail(error); }
        });
        toggle.className = 'kiosk-language-option';
        toggle.setAttribute('aria-label', label);
        toggle.setAttribute('aria-pressed', String(state.language === languageCode));
        toggle.title = label;
        const flag = picture(
          `/blocks/attendee-kiosk/assets/flag-${languageCode}.png`,
          label,
        );
        flag.classList.add('kiosk-language-flag');
        toggle.append(flag);
        language.append(toggle);
      });
    if (state.stage === 'welcome') tools.append(language);

    const eventName = api.source === 'azure' && api.eventId !== 'invalid-settings'
      ? api.eventId : text().demoContent;
    const settingsLink = element('a', text().settings);
    settingsLink.href = '/drafts/kiosk-settings.html';
    badge.replaceChildren(element('span', eventName), settingsLink);
    if (confirmRestart) {
      badge.append(
        element('span', text().confirm),
        button(text().reset, reset),
        button(text().cancel, () => { confirmRestart = false; render(); }),
      );
    } else {
      badge.append(button(text().reset, () => {
        confirmRestart = true;
        render();
      }));
    }
    if (config.mode === 'demo' && !config.coworker.enabled) {
      badge.append(button(text().connectCoworker, () => {
        const dialog = element('dialog', '', 'kiosk-connection-dialog');
        dialog.setAttribute('aria-label', text().connectCoworker);
        const form = element('form');
        const label = element('label', text().coworkerURL);
        const input = element('input');
        input.type = 'password';
        input.required = true;
        input.autocomplete = 'off';
        label.append(input);
        const connect = button(text().connectCoworker, () => {});
        connect.type = 'submit';
        const cancel = button(text().cancel, () => dialog.close());
        form.append(label, connect, cancel);
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          const url = input.value.trim();
          input.value = '';
          dialog.close();
          block.dispatchEvent(new CustomEvent('glam-kiosk-configure-coworker', {
            detail: { enabled: true, allowInDemo: true, url },
          }));
        });
        dialog.addEventListener('close', () => {
          input.value = '';
          dialog.remove();
        });
        dialog.append(form);
        block.append(dialog);
        dialog.showModal();
      }));
    }
  }
  async function selectedAssets(snapshot, signal) {
    const selectedPortrait = api.selectedPortrait
      ? await api.selectedPortrait(snapshot.portraitId, signal)
      : (await api.portraits(signal)).find((item) => item.id === snapshot.portraitId);
    if (!selectedPortrait) throw new Error(text().changed);
    let selectedManifest;
    if (['pacing', 'ads', 'continued', 'banners'].includes(snapshot.stage)) {
      selectedManifest = await api.manifest(snapshot.portraitId, signal);
      if (snapshot.selectedAdId
        && !selectedManifest.ads.some((ad) => ad.id === snapshot.selectedAdId)) {
        throw new Error(text().changed);
      }
    }
    return { selectedPortrait, selectedManifest };
  }
  function welcome() {
    const hero = element('video');
    hero.className = 'kiosk-hero';
    hero.src = '/blocks/attendee-kiosk/assets/welcome-collage.webm';
    hero.poster = '/blocks/attendee-kiosk/assets/welcome-poster.webp';
    hero.autoplay = true;
    hero.loop = true;
    hero.muted = true;
    hero.playsInline = true;
    hero.preload = 'auto';
    hero.setAttribute('aria-hidden', 'true');
    const content = element('div', '', 'kiosk-welcome-content');
    const heading = element('h2', text().welcome);
    heading.tabIndex = -1;
    content.append(heading, element('p', text().intro));
    heading.focus();
    const consentItems = element('ul', '', 'kiosk-consent-items');
    const legal = element('dialog', '', 'kiosk-release-dialog');
    legal.id = 'photo-release';
    legal.setAttribute('aria-labelledby', 'kiosk-release-title');
    const legalHeader = element('div', '', 'kiosk-release-header');
    const legalTitle = element('h2', text().legal);
    legalTitle.id = 'kiosk-release-title';
    const closeLegal = button('×', () => legal.close());
    closeLegal.className = 'kiosk-release-close';
    closeLegal.setAttribute('aria-label', text().closeRelease);
    legalHeader.append(legalTitle, closeLegal);
    const legalBody = element('div', '', 'kiosk-release-body');
    const releaseCopy = copy[state.language];
    legalBody.append(element('h3', releaseCopy.releaseTitle, 'kiosk-release-document-title'));
    releaseCopy.releaseParagraphs.slice(0, 1).forEach((item) => {
      const paragraph = element('p');
      appendLinkedText(paragraph, item, 'www.adobe.com/fr/privacy/policy.html');
      legalBody.append(paragraph);
    });
    if (releaseCopy.releaseBulletIntro) {
      legalBody.append(element('p', releaseCopy.releaseBulletIntro));
    }
    const releaseBullets = element('ul');
    releaseCopy.releaseBullets.forEach((item) => {
      const listItem = element('li');
      appendLinkedText(listItem, item, 'www.adobe.com/fr/privacy/policy.html');
      releaseBullets.append(listItem);
    });
    legalBody.append(releaseBullets);
    releaseCopy.releaseParagraphs.slice(1).forEach((item) => {
      const paragraph = element('p');
      appendLinkedText(paragraph, item, 'www.adobe.com/fr/privacy/policy.html');
      legalBody.append(paragraph);
    });
    legal.append(legalHeader, legalBody);
    legal.addEventListener('click', (event) => {
      if (event.target === legal) legal.close();
    });
    text().releaseItems.forEach((item) => {
      const listItem = element('li');
      if (typeof item === 'string') {
        listItem.textContent = item;
      } else {
        listItem.append(document.createTextNode(item.before));
        const external = Boolean(item.url);
        const link = element('a', external ? item.linkText : text().legal);
        link.href = external ? item.url : '#photo-release';
        link.className = 'kiosk-release-link';
        if (external) {
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        } else {
          link.addEventListener('click', (event) => {
            event.preventDefault();
            legal.showModal();
          });
        }
        listItem.append(link, document.createTextNode(item.after));
      }
      consentItems.append(listItem);
    });
    const label = element('label', '', 'kiosk-consent');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.consent;
    checkbox.required = true;
    const print = button(text().startWorkflow, () => {
      if (!checkbox.reportValidity() || config.intakeEnabled) return;
      move('portraits');
    }, !state.consent || config.intakeEnabled);
    print.className = 'kiosk-print';
    checkbox.addEventListener('change', () => {
      try {
        persist({ ...state, consent: checkbox.checked });
        print.disabled = !checkbox.checked || config.intakeEnabled;
        if (!print.disabled) print.focus();
      } catch (error) { fail(error); }
    });
    label.append(checkbox, element('span', text().consent));
    const actions = element('div', '', 'kiosk-intro-actions');
    actions.append(print);
    content.append(
      consentItems,
      legal,
      label,
      actions,
    );
    if (config.intakeEnabled) {
      content.append(element('p', text().intakeBlocked, 'kiosk-intake-note'));
    }
    panel.append(hero, content);
  }
  function nameEntry() {
    const copyPane = element('div', '', 'kiosk-name-copy');
    const heading = element('h2', text().name);
    heading.tabIndex = -1;
    copyPane.append(heading, element('p', text().nameSub));
    const form = element('form', '', 'kiosk-name');
    const label = element('label', text().nameLabel);
    const input = element('input');
    input.type = 'text';
    input.maxLength = 80;
    input.required = true;
    input.autocomplete = 'off';
    input.autofocus = true;
    input.value = state.name;
    input.placeholder = text().namePlaceholder
      || (state.language === 'fr' ? 'Saisissez votre nom ici' : 'Enter your name here');
    label.append(input);
    const next = button(text().next, () => {});
    next.className = 'kiosk-primary-action';
    next.type = 'submit';
    next.disabled = !input.value.trim();
    input.addEventListener('input', () => {
      next.disabled = !input.value.trim();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.isComposing) event.preventDefault();
    });
    form.append(label, next);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      next.disabled = true;
      const { signal } = controller;
      try {
        persist({
          ...state, name: input.value.trim(), sessionId: state.sessionId || crypto.randomUUID(),
        });
        await api.resume(state, signal);
        if (!signal.aborted) move('story');
      } catch (error) {
        if (!signal.aborted) fail(error);
      }
    });
    copyPane.append(form);
    panel.append(copyPane, picture(portrait.thumbnailUrl, portrait.label));
    input.focus();
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => requestAnimationFrame(() => {
        if (input.isConnected && document.activeElement === document.body) input.focus();
      }), { once: true });
    }
  }
  function ensureCoworker() {
    if (config.coworker.enabled && !frame) {
      frame = element('iframe');
      frame.title = 'AI Coworker';
      frame.referrerPolicy = 'no-referrer';
      frame.allow = 'camera; microphone';
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
      const loadingFrame = frame;
      frame.addEventListener('load', () => {
        loadedFrames.add(loadingFrame);
        if (frame === loadingFrame) notifyCoworker();
      });
      frame.src = config.coworker.url;
      frameSlot.append(frame);
    }
  }
  function story() {
    panel.classList.add('kiosk-panel-coworker');
    const content = element('div', '', 'kiosk-coworker-copy');
    const heading = element('h2', state.stage === 'story' ? text().coworkerHeading : text().continued);
    heading.tabIndex = -1;
    content.append(heading, element('p', text().coworkerSub));
    if (state.stage === 'story') {
      const jump = button(text().jumpAds, () => move('ads'));
      jump.className = 'kiosk-coworker-exit';
      content.append(jump);
    } else {
      if (state.printRequest) {
        const finish = button(text().finish, () => move('ending'));
        finish.className = 'kiosk-primary-action';
        content.append(finish);
      }
      const exit = button(text().exit, reset);
      exit.className = 'kiosk-coworker-exit';
      content.append(exit);
    }
    if (config.coworker.enabled && !config.coworker.packaged) {
      const authentication = element('a', text().coworkerAuthenticate, 'kiosk-coworker-auth');
      authentication.href = config.coworker.url;
      authentication.target = '_blank';
      authentication.rel = 'noopener noreferrer';
      authentication.referrerPolicy = 'no-referrer';
      const retry = button(text().coworkerRetry, () => {
        frame?.remove();
        frame = null;
        render();
      });
      retry.className = 'kiosk-coworker-auth';
      content.append(
        element('p', text().coworkerAuthHelp, 'kiosk-coworker-auth-help'),
        authentication,
        retry,
      );
    }
    panel.append(content);
    if (!config.coworker.packaged) heading.focus();
    if (!config.coworker.enabled) {
      panel.append(element('p', text().unavailable, 'kiosk-coworker-unavailable'));
    } else {
      ensureCoworker();
      frameSlot.hidden = false;
      notifyCoworker();
    }
  }
  function graph() {
    title(text().graph);
    if (config.mode === 'demo') panel.append(element('p', text().demoGraph));
    else if (!config.graph.enabled) {
      panel.append(element('p', text().unavailable));
    } else {
      const link = element('a', text().openGraph);
      link.href = config.graph.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      panel.append(link);
    }
    panel.append(button(text().returnGraph, () => move('ads')));
  }
  function ads() {
    ensureCoworker();
    const copyPane = element('div', '', 'kiosk-ad-copy');
    const heading = element('h2', text().ads);
    heading.tabIndex = -1;
    copyPane.append(heading, element('p', text().adsSub));
    panel.append(copyPane);
    heading.focus();
    if (manifest.status !== 'ready') {
      copyPane.append(
        element('p', text()[manifest.status]),
        button(text().refresh, () => render()),
      );
      cards(manifest.ads, null, null, 'kiosk-ad-grid');
      return;
    }
    let submitting = false;
    const transition = new AbortController();
    const next = button(text().simulateAudience, async () => {
      if (submitting || !state.selectedAdId) return;
      submitting = true;
      const { signal } = controller;
      panel.querySelectorAll('button').forEach((control) => { control.disabled = true; });
      try {
        if (api.source === 'azure' && !state.portraitId.startsWith('demo_')
          && !state.printRequest) {
          persist({ ...state, printRequest: createPrintRequest(state, api.settings()) });
        }
        await api.select(state, signal);
        if (!signal.aborted) {
          persist({ ...state, stage: 'continued' });
          notifyCoworker();
          frameSlot.hidden = !frame;
          const selectedId = state.selectedAdId;
          if (frame) {
            cancelEngulf = playAdEngulf(block, panel, frameSlot, selectedId, transition.signal);
          }
          render();
        }
      } catch (error) {
        if (!signal.aborted) fail(error);
      }
    }, !state.selectedAdId);
    next.className = 'kiosk-primary-action kiosk-composer-send';
    next.textContent = '\u2191';
    next.setAttribute('aria-label', text().simulateAudience);
    const dock = element('div', '', 'kiosk-composer');
    const halo = element('div', '', 'kiosk-composer-halo');
    const card = element('div', '', 'kiosk-composer-card');
    const row = element('div', '', 'kiosk-composer-text-row');
    const attachment = element('div', '', 'kiosk-composer-attachment');
    const prompt = element('div', text().selectAudienceAd, 'kiosk-composer-text');
    prompt.setAttribute('aria-live', 'polite');
    row.append(attachment, prompt);
    const icons = element('div', '', 'kiosk-composer-icons');
    const add = element('span', '+', 'kiosk-composer-add');
    add.setAttribute('aria-hidden', 'true');
    icons.append(add, next);
    card.append(row, icons);
    halo.append(card);
    const disclaimer = element('p', text().verifyResponses, 'kiosk-composer-disclaimer');
    dock.append(halo, disclaimer);
    panel.append(dock);
    const updateDock = () => {
      const selected = manifest.ads.find((ad) => ad.id === state.selectedAdId);
      attachment.replaceChildren();
      if (selected) {
        attachment.append(picture(selected.thumbnailUrl || selected.url, selected.label));
      }
      dock.classList.toggle('has-selection', !!selected);
      prompt.textContent = selected ? text().audiencePrompt : text().selectAudienceAd;
    };
    dock.addEventListener('click', (event) => {
      if (!event.target.closest('button') && !next.disabled) next.click();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.isComposing || event.altKey || event.ctrlKey
        || event.metaKey || event.shiftKey || next.disabled) return;
      event.preventDefault();
      if (!event.repeat) next.click();
    }, { signal: controller.signal });
    cards(manifest.ads, state.selectedAdId, (ad) => {
      try {
        if (state.printRequest) {
          throw new Error(text().selectionLocked);
        }
        persist({ ...state, selectedAdId: ad.id });
        panel.querySelectorAll('.kiosk-ad-grid .kiosk-card').forEach((tile, index) => {
          tile.setAttribute('aria-pressed', String(manifest.ads[index].id === ad.id));
        });
        next.disabled = false;
        updateDock();
      } catch (error) { fail(error); }
    }, 'kiosk-ad-grid');
    updateDock();
  }
  function banners() {
    title(text().banners, text().bannersSub);
    cards(manifest.ads.filter((ad) => ad.id === state.selectedAdId));
    if (state.portraitId.startsWith('demo_')) {
      panel.append(element('p', text().demoBanners));
      const ad = manifest.ads.find((item) => item.id === state.selectedAdId);
      cards(['Wide', 'Square', 'Portrait'].map((label) => ({ ...ad, label })), null, null, 'kiosk-formats');
    } else if (manifest.status === 'failed') panel.append(element('p', text().failed));
    else if (manifest.banners.length) cards(manifest.banners);
    else panel.append(element('p', text().bannerPending));
    panel.append(element('p', text().endings), button(text().refresh, () => render()));
  }
  async function ending(signal, currentEpoch) {
    if (!panel.children.length) title(text().thankYou, text().printWaiting);
    if (!state.printRequest || !api.printStatus) {
      panel.append(element('p', text().unavailable));
      return;
    }
    const request = state.printRequest;
    const result = await api.printStatus(request, signal);
    if (signal.aborted || epoch !== currentEpoch) return;
    panel.replaceChildren();
    const content = element('div', '', 'kiosk-ending-copy');
    const media = element('div', '', 'kiosk-ending-media');
    content.append(element('h2', text().thankYou));
    const ready = result?.render.status === 'ready';
    const submitted = result?.fulfillment.status === 'submitted';
    const failed = ['failed', 'error'].includes(result?.render.status)
      || result?.fulfillment.status === 'failed';
    content.append(element('p', failed ? text().printFailed
      : text()[submitted ? 'printPickup' : 'printWaiting']));
    const selected = result?.render.brands?.[request.selectedBrand];
    if (selected?.status === 'ready') {
      const previewURL = blobURL(api.settings().containerSAS, selected.blob);
      const preview = picture(previewURL, text().printPreview);
      preview.className = 'kiosk-print-preview';
      media.append(preview);
    }
    if (request.showFinalQR && result?.share?.downloadPageUrl && result.share.qrBlob) {
      const qrURL = blobURL(api.settings().containerSAS, result.share.qrBlob);
      const qr = picture(qrURL, text().scanQR);
      qr.className = 'kiosk-share-qr';
      const link = element('a', '', 'kiosk-qr-link');
      link.setAttribute('aria-label', text().scanQR);
      link.href = result.share.downloadPageUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.append(qr);
      media.append(link);
    } else if (request.showFinalQR && !failed) {
      content.append(element('p', text().shareWaiting));
    }
    if (!failed && (!ready || !submitted)) {
      timer = setTimeout(() => {
        if (epoch === currentEpoch) {
          ending(signal, currentEpoch).catch((error) => {
            if (!signal.aborted && epoch === currentEpoch) fail(error);
          });
        }
      }, 5000);
    }
    const actions = element('div', '', 'kiosk-ending-actions');
    actions.append(button(text().refreshShort, () => render()), button(text().exit, reset));
    content.append(actions);
    panel.append(content, media);
  }
  render = async () => {
    if (state.stage === 'pacing') persist({ ...state, stage: 'ads' });
    if (state.stage !== 'continued') cancelEngulf();
    epoch += 1;
    const currentEpoch = epoch;
    controller?.abort();
    clearTimeout(timer);
    const operation = new AbortController();
    controller = operation;
    const { signal } = operation;
    const snapshot = { ...state };
    block.lang = state.language;
    renderTools();
    panel.removeAttribute('role');
    const preparePanel = () => {
      panel.inert = false;
      panel.removeAttribute('aria-busy');
      panel.className = `kiosk-panel kiosk-panel-${snapshot.stage}`;
      panel.replaceChildren();
      frameSlot.hidden = true;
    };
    if (storageError) { fail(new Error(`${text().storage} ${storageError.message}`)); return; }
    try {
      if (snapshot.stage === 'welcome') { preparePanel(); welcome(); return; }
      if (snapshot.stage === 'ending') {
        preparePanel();
        await ending(signal, currentEpoch);
        return;
      }
      panel.inert = true;
      panel.setAttribute('aria-busy', 'true');
      if (snapshot.stage === 'portraits') {
        const portraits = await api.portraits(signal);
        if (signal.aborted || epoch !== currentEpoch) return;
        preparePanel();
        const copyPane = element('div', '', 'kiosk-portrait-copy');
        const heading = element('h2', text().portraits);
        heading.tabIndex = -1;
        const subtitle = element('p', text().portraitsSub);
        copyPane.append(heading, subtitle);
        if (api.source === 'azure') {
          copyPane.append(element('p', text().demoChoices, 'kiosk-azure-notice'));
          if (api.warning) {
            const warning = element('p', `${text().azureUnavailable} ${api.warning}`, 'kiosk-azure-notice');
            warning.setAttribute('role', 'alert');
            copyPane.append(warning);
          }
        }
        if (!portraits.length) copyPane.append(element('p', text().empty));
        const next = button(
          text().next,
          () => move('name', {
            name: '', selectedAdId: null, sessionId: null, printRequest: null,
          }),
          !portraits.some((item) => item.id === state.portraitId),
        );
        next.className = 'kiosk-primary-action';
        cards(
          api.source === 'azure' ? portraits
            : [...portraits].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
          state.portraitId,
          (item) => {
            try {
              persist({
                ...state,
                portraitId: item.id,
                name: '',
                selectedAdId: null,
                sessionId: null,
                printRequest: null,
              });
              panel.querySelectorAll('.kiosk-portrait-grid .kiosk-card').forEach((card) => {
                card.setAttribute('aria-pressed', String(card.dataset.assetId === item.id));
              });
              next.disabled = false;
              renderTools();
            } catch (error) { fail(error); }
          },
          'kiosk-portrait-grid',
          panel,
        );
        const portraitActions = element('div', '', 'kiosk-portrait-actions');
        portraitActions.append(next);
        const refresh = button(text().refresh, () => render());
        refresh.className = 'kiosk-refresh-assets';
        portraitActions.append(refresh);
        copyPane.append(portraitActions);
        const gallery = panel.querySelector('.kiosk-portrait-grid');
        gallery.addEventListener('keydown', (event) => {
          const card = event.target.closest('.kiosk-card');
          if (event.key !== 'Enter' || !card || card.dataset.assetId !== state.portraitId
            || event.isComposing || event.altKey || event.ctrlKey || event.metaKey
            || event.shiftKey || next.disabled) return;
          event.preventDefault();
          if (!event.repeat) next.click();
        });
        panel.replaceChildren(copyPane, gallery);
        return;
      }
      const assets = await selectedAssets(snapshot, signal);
      if (snapshot.sessionId) await api.resume(snapshot, signal);
      if (signal.aborted || epoch !== currentEpoch) return;
      portrait = assets.selectedPortrait;
      manifest = assets.selectedManifest;
      preparePanel();
      if (snapshot.stage === 'name') nameEntry();
      if (['story', 'continued'].includes(snapshot.stage)) story();
      if (snapshot.stage === 'graph') graph();
      if (snapshot.stage === 'ads') ads();
      if (snapshot.stage === 'banners') banners();
    } catch (error) {
      if (epoch === currentEpoch) fail(signal.aborted ? new Error(text().error) : error);
    }
  };
  window.addEventListener('message', (event) => {
    if (resetting) return;
    if (coworkerReady(event, frame?.contentWindow, config.coworker)) {
      readyFrames.add(frame);
      notifyCoworker();
      return;
    }
    const stage = navigation(event, frame?.contentWindow, config.coworker, state.stage);
    if (stage) move(stage === 'banners' && state.printRequest ? 'ending' : stage);
  });
  window.addEventListener('storage', (event) => {
    if (api.source !== 'azure' || (event.key !== 'glam-kiosk-booth-v1' && event.key !== null)) return;
    controller?.abort();
    clearTimeout(timer);
    fail(new Error(text().boothChanged));
  });
  window.addEventListener('scroll', () => {
    if (block.isConnected && window.innerWidth >= 900 && window.innerHeight > 800
      && document.querySelector('main > .section:only-child .attendee-kiosk') === block
      && (window.scrollX !== 0 || window.scrollY !== 0)) window.scrollTo(0, 0);
  }, { passive: true });
  block.addEventListener('glam-kiosk-configure-coworker', async (event) => {
    try {
      const updated = readConfig(config.mode, {
        ...window.GLAM_KIOSK_CONFIG,
        mode: config.mode,
        coworker: event.detail,
      });
      await clearCoworker();
      config.coworker = updated.coworker;
      render();
    } catch (error) {
      fail(error);
    }
  });
  await render();
}
