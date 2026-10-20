import { readConfig } from './config.js';
import {
  initialState, loadState, saveState, storageKey,
} from './state.js';
import { createAPI } from './api.js';
import createAzureAPI from './azure.js';
import createOfflineDemoAPI from './offline-demos.js';
import { demoPrintAssets } from './demo-print.js';
import {
  coworkerReady, navigation, send, storyBeat,
} from './integrations.js';
import copy from './copy.js';
import { createPrintRequest, createPreparation } from './fulfillment.js';
import { APPEARANCE_KEY, blobURL, loadAppearance } from '../../scripts/kiosk-settings.js';
import { loadCSS } from '../../scripts/aem.js';
import { darkLockup, darkNameLens } from './dark-artwork.js';
import playAdEngulf from './engulf.js';
import captureOpeningTransition from './opening-transitions.js';
import { readPublicDemo } from './public-demo.js';
import { BANNER_BRANDS } from './banner-assets.js';
import { markCompleted } from './completed.js';
import renderVariations, { sampleVariations } from './variations.js';

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
  let boothSettings;
  let appearance;
  try {
    api = createAzureAPI(createAPI({ ...config, mode: 'demo' }), window.localStorage)
      || (config.mode === 'demo' ? createOfflineDemoAPI() : createAPI(config));
    if (api.source === 'azure') boothSettings = api.settings();
    appearance = loadAppearance(window.localStorage, boothSettings?.appearance || 'light');
  } catch (error) {
    block.append(element('h2', 'Booth settings unavailable'), element('p', error.message));
    return;
  }
  if (api.source === 'azure') config.intakeEnabled = api.intakeEnabled;
  if (api.source === 'offline-demo') config.intakeEnabled = false;
  let key = storageKey(config);
  if (api.source === 'azure') key = `glam-attendee-v1:azure:${api.eventId}`;
  if (api.source === 'offline-demo') key = 'glam-attendee-v1:offline-demo';
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
  let graphPortrait = null;
  let publicDemo = null;
  let graphTimer;
  let frame;
  let currentStoryBeat = 'home';
  let currentContinuedBeat = 'simulate';
  const loadedFrames = new WeakSet();
  const readyFrames = new WeakSet();
  const homeFocusFrames = new WeakSet();
  const simulatedFrames = new WeakMap();
  let confirmRestart = false;
  let resetting = false;
  let cancelEngulf = () => {};
  const header = element('div', '', 'kiosk-header');
  await loadCSS('/blocks/attendee-kiosk/dark.css');
  const logo = picture('/blocks/attendee-kiosk/assets/lockup.png', 'Adobe × L’Oréal Groupe');
  logo.loading = 'eager';
  header.append(logo, darkLockup());
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
      const demoPortrait = item.demo
        || (variant === 'kiosk-portrait-grid' && item.id.startsWith('demo_'));
      if (demoPortrait) card.classList.add('kiosk-demo-card');
      if (demoPortrait && api.source !== 'azure') {
        card.append(element('strong', text().demoPortrait, 'kiosk-demo-label'));
      }
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
    sendCoworker({ type: 'KIOSK_SET_THEME', theme: appearance });
    let graphMode = 'portrait';
    if (portrait.demoCatalog) graphMode = publicDemo ? 'public-demo' : 'manual-demo';
    sendCoworker({
      type: 'KIOSK_SET_GRAPH_MODE',
      mode: graphMode,
      portraitId: state.portraitId,
      ...(publicDemo ? { demo: publicDemo } : {}),
    });
    sendCoworker({
      type: 'KIOSK_SET_NAME',
      portraitId: state.portraitId,
      name: state.name,
      portrait: new URL(portrait.thumbnailUrl, window.location.origin).href,
    });
    sendCoworker({
      type: 'KIOSK_SET_GRAPH_PORTRAIT',
      portraitId: state.portraitId,
      url: graphPortrait?.portraitId === state.portraitId
        && Date.parse(graphPortrait.expiresAt) > Date.now() ? graphPortrait.url : null,
      expiresAt: graphPortrait?.portraitId === state.portraitId
        ? graphPortrait.expiresAt : null,
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
          brand: ['roche', 'keratin', 'ysl', 'paris'][index],
          adUrl: new URL(manifest.ads[index].url, window.location.origin).href,
          autoAdvance: true,
        });
      }
    }
  }
  function applyAppearance() {
    appearance = loadAppearance(window.localStorage, boothSettings?.appearance || 'light');
    block.dataset.appearance = appearance;
    sendCoworker({ type: 'KIOSK_SET_THEME', theme: appearance });
  }
  applyAppearance();
  function loadGraphPortrait(signal, currentEpoch) {
    clearTimeout(graphTimer);
    graphPortrait = null;
    publicDemo = null;
    const id = state.portraitId;
    if (id.startsWith('demo_')) {
      if (portrait.demoCatalog && config.publicDemoOrigin) {
        const brandIndex = manifest?.ads.findIndex((ad) => ad.id === state.selectedAdId) ?? -1;
        readPublicDemo(config.publicDemoOrigin, {
          personId: id,
          templateSetId: portrait.templateSetId,
          version: portrait.demoVersion,
          brand: BANNER_BRANDS[brandIndex < 0 ? 3 : brandIndex],
        }, signal).then((result) => {
          if (signal.aborted || epoch !== currentEpoch) return;
          publicDemo = result;
          notifyCoworker();
        }).catch(() => {
          if (signal.aborted || epoch !== currentEpoch) return;
          // eslint-disable-next-line no-console
          console.warn('[kiosk] Public demo cutout unavailable; Graph will open without an image.');
        });
      }
      signal.addEventListener('abort', () => { publicDemo = null; }, { once: true });
      return;
    }
    if (!api.graphInput || id.startsWith('demo_')) return;
    const warning = element('p', '', 'kiosk-graph-input-status');
    warning.setAttribute('role', 'status');
    panel.querySelector('.kiosk-coworker-copy').append(warning);
    const diagnose = (reason) => {
      if (warning.dataset.graphInputReason !== reason && reason !== 'ready') {
        // Only fixed reason codes; never log the signed URL or attendee identity.
        // eslint-disable-next-line no-console
        console.warn(`[kiosk] Graph portrait: ${reason}.`);
      }
      warning.dataset.graphInputReason = reason;
    };
    const refresh = async () => {
      try {
        const result = await api.graphInput(id, signal);
        if (signal.aborted || epoch !== currentEpoch || state.portraitId !== id) return;
        graphPortrait = result.status === 'ready' ? result : null;
        warning.textContent = graphPortrait ? '' : text().graphPortraitUnavailable;
        diagnose(graphPortrait ? 'ready' : result.errorCode || result.status);
      } catch (error) {
        if (signal.aborted || epoch !== currentEpoch) return;
        graphPortrait = null;
        warning.textContent = text().graphPortraitReadFailed;
        diagnose(error.graphInputCode || 'manifest_read_failed');
      }
      notifyCoworker();
      graphTimer = setTimeout(refresh, 5000);
    };
    refresh();
    signal.addEventListener('abort', () => {
      clearTimeout(graphTimer);
      graphPortrait = null;
    }, { once: true });
  }
  async function clearCoworker() {
    currentStoryBeat = 'home';
    currentContinuedBeat = 'simulate';
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
    language.hidden = true;
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
      ? api.eventId : '';
    const settingsLink = element('a', text().settings);
    settingsLink.href = '/drafts/kiosk-settings.html';
    badge.replaceChildren(...(eventName ? [element('span', eventName)] : []), settingsLink);
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
    if (['pacing', 'ads', 'continued', 'banners', 'variations'].includes(snapshot.stage)) {
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
  async function confirmName(signal) {
    if (api.source === 'azure' && !state.portraitId.startsWith('demo_')) {
      if (!state.prepareRequest) {
        persist({ ...state, prepareRequest: createPreparation(state, api.settings()) });
      }
      if (!state.prepareSubmitted) {
        await api.prepare(state.prepareRequest, signal);
        if (signal.aborted) return;
        persist({ ...state, prepareSubmitted: true });
      }
    }
    await api.resume(state, signal);
    if (!signal.aborted) move('story');
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
    input.readOnly = Boolean(state.prepareRequest);
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
    let confirming = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (confirming) return;
      if (!input.value.trim()) { input.focus(); return; }
      confirming = true;
      next.disabled = true;
      const { signal } = controller;
      try {
        persist({
          ...state, name: input.value.trim(), sessionId: state.sessionId || crypto.randomUUID(),
        });
        await confirmName(signal);
      } catch (error) {
        if (!signal.aborted) fail(error);
      }
    });
    copyPane.append(form);
    const photo = picture(portrait.thumbnailUrl, portrait.label);
    photo.className = 'kiosk-name-photo';
    const artwork = element('div', '', 'kiosk-name-artwork');
    artwork.append(darkNameLens(), photo);
    panel.append(copyPane, artwork);
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
      const frameURL = new URL(config.coworker.url);
      if (config.coworker.packaged && frameURL.protocol === 'http:'
        && ['localhost', '127.0.0.1'].includes(frameURL.hostname)) {
        frameURL.searchParams.set('kiosk-preview', crypto.randomUUID());
      }
      frame.src = frameURL.href;
      frameSlot.append(frame);
    }
  }
  function updateStoryCopy(beat, animate = true) {
    const viewport = panel.querySelector('.kiosk-story-copy');
    const currentBeat = state.stage === 'continued' ? currentContinuedBeat : currentStoryBeat;
    if (!viewport || (animate && beat === currentBeat)) return;
    if (state.stage === 'continued') currentContinuedBeat = beat;
    else currentStoryBeat = beat;
    const next = element('div', '', 'kiosk-story-text');
    const beatCopy = text().storyBeats[beat];
    const heading = element('h2', beatCopy?.title || text().coworkerHeading);
    heading.tabIndex = -1;
    next.append(heading, element('p', beatCopy?.sub || text().coworkerSub, 'kiosk-story-subcopy'));
    viewport.querySelectorAll('[aria-hidden]').forEach((node) => node.remove());
    const previous = viewport.firstElementChild;
    previous?.getAnimations().forEach((animation) => animation.cancel());
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (animate && previous && !reducedMotion) {
      previous.setAttribute('aria-hidden', 'true');
      viewport.append(next);
      const timing = { duration: 450, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
      const exit = previous.animate([
        { transform: 'translateY(0)', opacity: 1 },
        { transform: 'translateY(-100%)', opacity: 0 },
      ], timing);
      exit.onfinish = () => previous.remove();
      next.animate([
        { transform: 'translateY(100%)', opacity: 0 },
        { transform: 'translateY(0)', opacity: 1 },
      ], timing);
    } else viewport.replaceChildren(next);
  }
  function story() {
    panel.classList.add('kiosk-panel-coworker');
    const content = element('div', '', 'kiosk-coworker-copy');
    const viewport = element('div', '', 'kiosk-story-copy');
    viewport.setAttribute('aria-live', 'polite');
    viewport.setAttribute('aria-atomic', 'true');
    content.append(viewport);
    if (state.stage === 'story') {
      const jump = button(text().jumpAds, () => move('ads'));
      jump.className = 'kiosk-coworker-jump';
      content.append(jump);
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
    updateStoryCopy(state.stage === 'story' ? currentStoryBeat : currentContinuedBeat, false);
    if (!config.coworker.packaged) content.querySelector('h2').focus();
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
          currentContinuedBeat = 'simulate';
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
    const sendIcon = element('span', '', 'kiosk-composer-icon kiosk-composer-send-icon');
    sendIcon.setAttribute('aria-hidden', 'true');
    next.replaceChildren(sendIcon);
    next.setAttribute('aria-label', text().simulateAudience);
    const dock = element('div', '', 'kiosk-composer');
    const halo = element('div', '', 'kiosk-composer-halo');
    const card = element('div', '', 'kiosk-composer-card');
    const content = element('div', '', 'kiosk-composer-content');
    const attachment = element('div', '', 'kiosk-composer-attachment');
    const row = element('div', '', 'kiosk-composer-text-row');
    const aiIcon = picture('/blocks/attendee-kiosk/assets/prompt-field/ai-icon.svg', '');
    aiIcon.className = 'kiosk-composer-ai';
    aiIcon.loading = 'eager';
    const prompt = element('div', text().selectAudienceAd, 'kiosk-composer-text');
    prompt.setAttribute('aria-live', 'polite');
    row.append(aiIcon, prompt);
    content.append(attachment, row);
    const icons = element('div', '', 'kiosk-composer-icons');
    const add = element('span', '', 'kiosk-composer-add');
    add.setAttribute('aria-hidden', 'true');
    add.append(element('span', '', 'kiosk-composer-icon kiosk-composer-add-icon'));
    icons.append(add, next);
    card.append(content, icons);
    halo.append(card);
    const disclaimer = element('p', text().verifyResponses, 'kiosk-composer-disclaimer');
    dock.append(halo, disclaimer);
    panel.append(dock);
    let updateDock;
    const deselect = () => {
      try {
        if (state.printRequest) throw new Error(text().selectionLocked);
        persist({ ...state, selectedAdId: null });
        panel.querySelectorAll('.kiosk-ad-grid .kiosk-card').forEach((tile) => {
          tile.setAttribute('aria-pressed', 'false');
        });
        next.disabled = true;
        updateDock();
      } catch (error) { fail(error); }
    };
    updateDock = () => {
      const selected = manifest.ads.find((ad) => ad.id === state.selectedAdId);
      attachment.replaceChildren();
      if (selected) {
        const thumbnail = element('div', '', 'kiosk-composer-thumbnail');
        const border = picture('/blocks/attendee-kiosk/assets/prompt-field/thumbnail-border.svg', '');
        border.className = 'kiosk-composer-thumbnail-border';
        const image = picture(selected.thumbnailUrl || selected.url, selected.label);
        image.className = 'kiosk-composer-thumbnail-image';
        thumbnail.append(image, border);
        const remove = button('', deselect);
        remove.className = 'kiosk-composer-remove';
        remove.setAttribute('aria-label', text().removeSelectedAd);
        const removeIcon = picture('/blocks/attendee-kiosk/assets/prompt-field/close.svg', '');
        removeIcon.className = 'kiosk-composer-remove-icon';
        remove.append(removeIcon);
        attachment.append(thumbnail, remove);
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
      if (submitting) return;
      try {
        if (state.printRequest && state.selectedAdId !== ad.id) {
          throw new Error(text().selectionLocked);
        }
        persist({ ...state, selectedAdId: ad.id });
        if (api.source === 'azure' && !state.portraitId.startsWith('demo_')) {
          markCompleted(window.localStorage, api.eventId, state.portraitId);
        }
        panel.querySelectorAll('.kiosk-ad-grid .kiosk-card').forEach((tile, index) => {
          tile.setAttribute('aria-pressed', String(manifest.ads[index].id === ad.id));
        });
        next.disabled = false;
        updateDock();
        next.click();
      } catch (error) { fail(error); }
    }, 'kiosk-ad-grid');
    updateDock();
  }
  function graphInterstitial() {
    panel.className = 'kiosk-panel kiosk-panel-ads kiosk-graph-interstitial';
    ads();
    const { signal } = controller;
    const copyPane = panel.querySelector('.kiosk-ad-copy');
    const selectionCopy = element('div', '', 'kiosk-ad-selection-copy');
    selectionCopy.append(...copyPane.childNodes);
    const introCopy = element('div', '', 'kiosk-ad-intro-copy');
    const introHeading = element('h2', text().graphReturnHeading);
    introHeading.tabIndex = -1;
    introCopy.append(introHeading, element('p', text().graphReturnSub));
    copyPane.classList.add('kiosk-ad-copy-viewport');
    copyPane.append(introCopy, selectionCopy);
    introHeading.focus({ preventScroll: true });
    const grid = panel.querySelector('.kiosk-ad-grid');
    const dock = panel.querySelector('.kiosk-composer');
    grid.inert = true;
    grid.style.visibility = 'hidden';
    selectionCopy.hidden = true;
    if (dock) { dock.style.visibility = 'hidden'; dock.inert = true; }
    const media = element('div', '', 'kiosk-graph-video-slot');
    const mediaArea = element('div', '', 'kiosk-graph-media');
    grid.before(mediaArea);
    mediaArea.append(grid, media);
    const video = element('video', '', 'kiosk-graph-video');
    video.src = '/blocks/attendee-kiosk/assets/graph-return.mp4';
    video.poster = '/blocks/attendee-kiosk/assets/graph-return-poster.jpg';
    video.muted = true;
    video.autoplay = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.setAttribute('aria-label', text().playGraphVideo);
    const status = element('div', '', 'kiosk-graph-video-status');
    status.setAttribute('role', 'status');
    media.append(video, status);
    let finished = false;
    const reveal = () => {
      if (finished || signal.aborted) return;
      try { persist({ ...state, stage: 'ads' }); } catch (error) { fail(error); return; }
      finished = true;
      video.pause();
      selectionCopy.hidden = false;
      grid.style.visibility = '';
      grid.inert = false;
      if (dock) { dock.style.visibility = ''; dock.inert = false; }
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (!reduced) {
        const timing = { duration: 450, easing: 'cubic-bezier(0.2, 0, 0, 1)' };
        introCopy.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: 'translateY(-100%)', opacity: 0 }], timing);
        selectionCopy.animate([{ transform: 'translateY(100%)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], timing);
        grid.animate([{ opacity: 0 }, { opacity: 1 }], timing);
        const exit = media.animate([{ opacity: 1 }, { opacity: 0 }], timing);
        exit.onfinish = () => { media.remove(); introCopy.remove(); };
      } else {
        media.remove();
        introCopy.remove();
      }
      introCopy.setAttribute('aria-hidden', 'true');
      selectionCopy.querySelector('h2').focus({ preventScroll: true });
    };
    let play;
    function failed() {
      if (finished || signal.aborted) return;
      status.replaceChildren(
        element('p', text().graphVideoFailed),
        button(text().retry, () => { video.load(); play(); }),
        button(text().continueToAds, reveal),
      );
    }
    play = () => {
      status.replaceChildren();
      video.play().catch((error) => {
        if (signal.aborted || finished || error.name === 'AbortError') return;
        status.replaceChildren(button(text().playGraphVideo, () => {
          video.play().then(() => status.replaceChildren()).catch(failed);
        }), button(text().continueToAds, reveal));
      });
    };
    video.addEventListener('ended', reveal, { once: true, signal });
    video.addEventListener('error', failed, { signal });
    signal.addEventListener('abort', () => {
      finished = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }, { once: true });
    play();
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
  function revealPrintPreview(media, previewURL, signal, firstRender, setPrintStatus) {
    const slot = media.querySelector('.kiosk-print-slot');
    const bar = media.querySelector('.kiosk-print-status');
    const preview = picture(previewURL, text().printPreview);
    preview.className = 'kiosk-print-preview';
    preview.loading = 'eager';
    preview.style.opacity = '0';
    let revealed = false;
    const reveal = () => {
      if (revealed || signal.aborted || !preview.isConnected) return;
      revealed = true;
      preview.style.opacity = '';
      if (media.dataset.printState === 'available') setPrintStatus(text().printTakeHome, true);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const animation = preview.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
        { transform: 'translateY(-100%)', opacity: 0.25 },
        { transform: 'translateY(0)', opacity: 1 },
      ], {
        duration: reduced ? 180 : 1500,
        delay: reduced || !firstRender ? 0 : 350,
        fill: 'backwards',
        easing: 'cubic-bezier(0.22, 0.75, 0.2, 1)',
      });
      signal.addEventListener('abort', () => animation.cancel(), { once: true });
    };
    preview.addEventListener('load', reveal, { once: true, signal });
    preview.addEventListener('error', () => {
      preview.hidden = true;
      delete media.dataset.preview;
      setPrintStatus(text().printPreviewFailed);
      bar.setAttribute('role', 'alert');
    }, { once: true, signal });
    slot.replaceChildren(preview);
    if (preview.complete && preview.naturalWidth > 0) queueMicrotask(reveal);
  }
  async function ending(signal, currentEpoch) {
    if (state.portraitId?.startsWith('demo_') && api.demoAssets) {
      const staticPrint = demoPrintAssets(state.portraitId, state.selectedAdId);
      const { portraitId, selectedAdId } = state;
      const assets = staticPrint || await api.demoAssets(portraitId, selectedAdId, signal);
      if (signal.aborted || epoch !== currentEpoch) return;
      if (assets) {
        const content = element('div', '', 'kiosk-ending-copy');
        const description = staticPrint ? text().demoPrintReady : text().demoPrintPreview;
        content.append(element('h2', text().thankYou), element('p', description));
        const actions = element('div', '', 'kiosk-ending-actions');
        const refresh = button(text().refreshShort, () => render());
        refresh.className = 'kiosk-ending-refresh';
        actions.append(button(text().startOver, reset), refresh);
        content.append(actions);
        const media = element('div', '', 'kiosk-ending-media kiosk-demo-print');
        media.dataset.printState = 'available';
        const bar = element('div', '', 'kiosk-print-status');
        bar.setAttribute('role', 'status');
        bar.setAttribute('aria-live', 'polite');
        media.append(bar, element('div', '', 'kiosk-print-slot'));
        const setPrintStatus = (value, complete = false, processing = false) => {
          bar.textContent = value;
          bar.classList.toggle('kiosk-print-status-ready', complete);
          bar.classList.toggle('kiosk-print-status-processing', processing);
        };
        setPrintStatus(text().printPreparing, false, true);
        panel.append(content, media);
        revealPrintPreview(media, assets.printPreview.url, signal, true, setPrintStatus);
        return;
      }
    }
    if (!panel.children.length) title(text().thankYou, text().printPreparing);
    if (!state.printRequest || !api.printStatus) {
      title(text().thankYou, text().printPickup);
      panel.append(element('p', text().unavailable));
      return;
    }
    const request = state.printRequest;
    let result;
    let readFailed = false;
    try {
      result = await api.printStatus(request, signal);
    } catch {
      readFailed = true;
    }
    if (signal.aborted || epoch !== currentEpoch) return;
    const previousMedia = panel.querySelector('.kiosk-ending-media');
    const firstRender = !previousMedia;
    panel.replaceChildren();
    const content = element('div', '', 'kiosk-ending-copy');
    const media = previousMedia || element('div', '', 'kiosk-ending-media');
    content.append(element('h2', text().thankYou));
    const ready = result?.render.status === 'ready';
    const submitted = result?.fulfillment.status === 'submitted';
    const failed = ['failed', 'error'].includes(result?.render.status)
      || result?.fulfillment.status === 'failed';
    const status = element('p', text().printPickup);
    content.append(status);
    let bar = media.querySelector('.kiosk-print-status');
    if (!bar) {
      bar = element('div', '', 'kiosk-print-status');
      bar.setAttribute('role', 'status');
      bar.setAttribute('aria-live', 'polite');
      media.append(bar, element('div', '', 'kiosk-print-slot'));
    }
    const slot = media.querySelector('.kiosk-print-slot');
    media.dataset.printState = failed ? 'failed' : 'available';
    if (readFailed) media.dataset.printState = 'read-error';
    bar.setAttribute('role', 'status');
    const setPrintStatus = (value, complete = false, processing = false) => {
      bar.textContent = value;
      bar.classList.toggle('kiosk-print-status-ready', complete);
      bar.classList.toggle('kiosk-print-status-processing', processing);
    };
    if (readFailed) setPrintStatus(text().printStatusRetrying);
    else if (failed) setPrintStatus(text().printFailed);
    else if (slot.querySelector('img')?.naturalWidth > 0) {
      setPrintStatus(text().printTakeHome, true);
    } else setPrintStatus(text().printPreparing, false, true);
    const selected = result?.render.brands?.[request.selectedBrand];
    if (selected?.status === 'ready' && media.dataset.preview !== selected.blob) {
      const previewURL = blobURL(api.settings().containerSAS, selected.blob);
      media.dataset.preview = selected.blob;
      revealPrintPreview(media, previewURL, signal, firstRender, setPrintStatus);
    }
    const loadedPreview = slot.querySelector('img');
    const imageReady = loadedPreview?.naturalWidth > 0 && !loadedPreview.hidden;
    clearTimeout(timer);
    if (readFailed || (!failed && (!ready || !submitted || !imageReady))) {
      timer = setTimeout(() => {
        if (epoch === currentEpoch) {
          ending(signal, currentEpoch).catch((error) => {
            if (!signal.aborted && epoch === currentEpoch) fail(error);
          });
        }
      }, 5000);
    }
    const actions = element('div', '', 'kiosk-ending-actions');
    const startOver = button(text().startOver, reset);
    const refresh = button(text().refreshShort, () => render());
    refresh.className = 'kiosk-ending-refresh';
    actions.append(startOver, refresh);
    content.append(actions);
    panel.append(content, media);
    if (firstRender) {
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      [content.querySelector('h2'), status, bar].forEach((node, index) => {
        const animation = node.animate(reduced ? [{ opacity: 0 }, { opacity: 1 }] : [
          { opacity: 0, transform: 'translateY(24px)' },
          { opacity: 1, transform: 'translateY(0)' },
        ], { duration: reduced ? 180 : 900, delay: reduced ? 0 : 150 + (index % 2) * 100, fill: 'backwards' });
        signal.addEventListener('abort', () => animation.cancel(), { once: true });
      });
      const animation = actions.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: reduced ? 180 : 500,
        delay: reduced ? 0 : 1100,
        fill: 'backwards',
      });
      signal.addEventListener('abort', () => animation.cancel(), { once: true });
    }
  }
  render = async () => {
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
    let playOpening = () => {};
    const preparePanel = () => {
      playOpening = captureOpeningTransition(block, panel, snapshot.stage, signal);
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
        let outgoing;
        if (panel.classList.contains('kiosk-panel-variations')) {
          outgoing = panel.cloneNode(true);
          outgoing.classList.add('kiosk-ending-outgoing');
          outgoing.inert = true;
          outgoing.setAttribute('aria-hidden', 'true');
          outgoing.style.zIndex = '3';
          outgoing.style.pointerEvents = 'none';
          outgoing.style.position = 'absolute';
          block.append(outgoing);
          signal.addEventListener('abort', () => outgoing.remove(), { once: true });
        }
        preparePanel();
        try {
          await ending(signal, currentEpoch);
        } catch (error) {
          outgoing?.remove();
          throw error;
        }
        if (outgoing) {
          if (signal.aborted) { outgoing.remove(); return; }
          const animation = outgoing.animate([
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(-28px)' },
          ], {
            duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 180 : 900,
            easing: 'ease-in-out',
            fill: 'forwards',
          });
          animation.finished.then(() => outgoing.remove(), () => outgoing.remove());
          signal.addEventListener('abort', () => animation.cancel(), { once: true });
        }
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
        if (api.source === 'azure' && api.warning) {
          const warning = element('p', text().azureUnavailable, 'kiosk-azure-notice');
          warning.setAttribute('role', 'alert');
          copyPane.append(warning);
        }
        if (!portraits.length) copyPane.append(element('p', text().empty));
        const next = button(
          text().next,
          () => move('name', {
            name: '',
            selectedAdId: null,
            sessionId: null,
            printRequest: null,
            prepareRequest: null,
            prepareSubmitted: false,
          }),
          !portraits.some((item) => item.id === state.portraitId),
        );
        next.className = 'kiosk-primary-action';
        cards(
          ['azure', 'offline-demo'].includes(api.source) ? portraits
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
                prepareRequest: null,
                prepareSubmitted: false,
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
        panel.replaceChildren(copyPane, gallery, refresh);
        playOpening(frameSlot);
        return;
      }
      if (snapshot.stage === 'name' && snapshot.prepareRequest) {
        await confirmName(signal);
        return;
      }
      const assets = await selectedAssets(snapshot, signal);
      if (snapshot.sessionId) await api.resume(snapshot, signal);
      if (signal.aborted || epoch !== currentEpoch) return;
      portrait = assets.selectedPortrait;
      manifest = assets.selectedManifest;
      const revealVariations = snapshot.stage === 'variations'
        && panel.classList.contains('kiosk-panel-continued') && !frameSlot.hidden;
      let initialResults;
      let finishRevealSetup = () => {};
      if (revealVariations) {
        if (api.bannerResults && (!snapshot.portraitId.startsWith('demo_') || manifest.demoCatalog)) {
          initialResults = await api.bannerResults(
            snapshot.portraitId,
            snapshot.selectedAdId,
            signal,
          );
        }
        let previews = manifest.banners.length ? manifest.banners : [];
        if (snapshot.portraitId.startsWith('demo_') && !manifest.demoCatalog
          && !previews.length) previews = sampleVariations();
        if (initialResults) {
          previews = initialResults.assets.filter((asset) => (
            asset.status === 'ready' && asset.mimeType?.startsWith('image/')
          ));
        }
        await Promise.all(previews.slice(0, 6).map((asset) => new Promise((resolve) => {
          const image = new Image();
          let timeout;
          const done = () => {
            clearTimeout(timeout);
            signal.removeEventListener('abort', done);
            image.onload = null;
            image.onerror = null;
            resolve();
          };
          timeout = setTimeout(done, 2000);
          signal.addEventListener('abort', done, { once: true });
          image.onload = done;
          image.onerror = done;
          image.referrerPolicy = 'no-referrer';
          image.src = asset.url;
        })));
        if (signal.aborted || epoch !== currentEpoch) return;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const outgoingCopy = panel.cloneNode(true);
        outgoingCopy.setAttribute('aria-hidden', 'true');
        outgoingCopy.inert = true;
        outgoingCopy.removeAttribute('aria-busy');
        outgoingCopy.style.zIndex = '3';
        outgoingCopy.style.pointerEvents = 'none';
        block.append(outgoingCopy);
        frameSlot.style.zIndex = '3';
        frameSlot.style.pointerEvents = 'none';
        const outgoing = [
          frameSlot.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
            { opacity: 1, transform: 'scale(1)' },
            { opacity: 0.7, transform: 'scale(0.99) translateY(-4px)', offset: 0.35 },
            { opacity: 0, transform: 'scale(0.975) translateY(-12px)' },
          ], { duration: reduced ? 180 : 1000, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }),
          outgoingCopy.animate(reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: 'translateY(-24px)' },
          ], { duration: reduced ? 180 : 650, easing: 'ease-in-out', fill: 'forwards' }),
        ];
        const cancel = () => {
          frameSlot.hidden = true;
          frameSlot.style.zIndex = '';
          frameSlot.style.pointerEvents = '';
          outgoingCopy.remove();
          outgoing.forEach((animation) => animation.cancel());
          signal.removeEventListener('abort', cancel);
        };
        signal.addEventListener('abort', cancel, { once: true });
        finishRevealSetup = () => {
          frameSlot.hidden = false;
          Promise.all(outgoing.map((animation) => animation.finished)).then(cancel, (error) => {
            if (error.name !== 'AbortError') {
              cancel();
              if (!signal.aborted && epoch === currentEpoch) fail(error);
            }
          });
        };
      }
      preparePanel();
      finishRevealSetup();
      if (snapshot.stage === 'name') nameEntry();
      if (['story', 'continued'].includes(snapshot.stage)) story();
      if (['name', 'story'].includes(snapshot.stage)) playOpening(frameSlot);
      if (['story', 'continued'].includes(snapshot.stage)) loadGraphPortrait(signal, currentEpoch);
      if (snapshot.stage === 'graph') graph();
      if (snapshot.stage === 'pacing') graphInterstitial();
      if (snapshot.stage === 'ads') ads();
      if (snapshot.stage === 'banners') banners();
      if (snapshot.stage === 'variations') {
        const demo = snapshot.portraitId.startsWith('demo_');
        const sample = demo && !manifest.demoCatalog
          && !manifest.banners.length;
        let onFinish = null;
        if (demo) onFinish = () => move('ending');
        else if (state.printRequest) onFinish = () => move('ending');
        let variationAssets = sample ? sampleVariations() : manifest.banners;
        if (initialResults) {
          variationAssets = initialResults.assets.filter((asset) => (
            asset.status === 'ready' && asset.mimeType?.startsWith('image/')
          ));
        }
        renderVariations({
          panel,
          block,
          assets: variationAssets,
          sample,
          loadResults: api.bannerResults && (!snapshot.portraitId.startsWith('demo_')
            || manifest.demoCatalog)
            ? () => {
              if (initialResults) {
                const result = initialResults;
                initialResults = null;
                return Promise.resolve(result);
              }
              return api.bannerResults(snapshot.portraitId, snapshot.selectedAdId, signal);
            } : null,
          text: text(),
          signal,
          workflow: config.productionWorkflow,
          portraitId: snapshot.portraitId,
          loadWorkflowPortrait: async (workflowSignal) => {
            if (snapshot.portraitId.startsWith('demo_')) {
              if (manifest.demoCatalog) {
                const { portraitId, selectedAdId } = snapshot;
                const fixtures = await api.demoAssets(portraitId, selectedAdId, workflowSignal);
                return fixtures.cutout.url;
              }
              return new URL(portrait.thumbnailUrl, window.location.origin).href;
            }
            const result = await api.graphInput(snapshot.portraitId, workflowSignal);
            return result.status === 'ready' ? result.url : null;
          },
          animateEntrance: revealVariations,
          onFinish,
        });
      }
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
    const beat = storyBeat(event, frame?.contentWindow, config.coworker, state.stage);
    if (beat) {
      updateStoryCopy(beat);
      return;
    }
    const stage = navigation(event, frame?.contentWindow, config.coworker, state.stage);
    if (stage) move(stage === 'banners' && state.printRequest ? 'ending' : stage);
  });
  window.addEventListener('storage', (event) => {
    if (event.key === APPEARANCE_KEY || (event.key === null && api.source !== 'azure')) {
      try {
        applyAppearance();
      } catch (error) { fail(error); }
      return;
    }
    if (api.source !== 'azure' || (event.key !== 'glam-kiosk-booth-v1' && event.key !== null)) return;
    try {
      const updated = api.settings();
      const sameSetup = Object.keys(updated).every((field) => (
        field === 'appearance' || updated[field] === boothSettings[field]
      ));
      if (sameSetup) {
        boothSettings = updated;
        applyAppearance();
        return;
      }
    } catch {
      // Clearing or invalidating settings still blocks the current attendee.
    }
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
