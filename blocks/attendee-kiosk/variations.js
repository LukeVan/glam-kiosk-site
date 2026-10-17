const ROOT = '/blocks/attendee-kiosk/assets/variations/';
const FORMATS = ['1080_1080', '1200_628', '160_600', '1920_1080', '970_250',
  '1200_1500', '728_90', '1200_1200', '970_90'];

export function sampleVariations() {
  return [false, true].flatMap((alternate) => FORMATS.map((format) => ({
    id: `sample_${format}${alternate ? '_2' : ''}`,
    label: `L'Oréal Paris ${format.replace('_', ' × ')}${alternate ? ' / 2' : ''}`,
    url: `${ROOT}Loreal-ads-atscale-simple_${format}${alternate ? '-2' : ''}.jpg`,
  })));
}

export default function renderVariations({
  panel, block, assets, sample, text, signal, onFinish, workflow, loadResults,
  portraitId, loadWorkflowPortrait, animateEntrance = false,
}) {
  const make = (tag, value, className) => {
    const node = document.createElement(tag);
    node.className = className;
    if (value) node.textContent = value;
    return node;
  };
  const copy = make('div', '', 'kiosk-variations-copy');
  const copyViewport = make('div', '', 'kiosk-story-copy');
  const copyText = make('div', '', 'kiosk-story-text kiosk-variations-intro');
  copyText.append(make('h2', text.variationsHeading, ''), make('p', text.variationsSub, ''));
  copyViewport.append(copyText);
  copy.append(copyViewport);
  if (sample) copy.append(make('p', text.variationsSample, 'kiosk-variations-notice'));
  let currentAssets = assets;
  let syncWorkflow = () => {};
  const controls = make('div', '', 'kiosk-variations-controls');
  const button = (label, action) => {
    const node = make('button', label, '');
    node.type = 'button';
    node.addEventListener('click', action, { signal });
    return node;
  };
  const viewport = make('div', '', 'kiosk-variations-viewport');
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', text.variationsGallery);
  const grid = make('div', '', 'kiosk-variations-grid');
  const status = make('p', '', 'kiosk-variations-status');
  status.setAttribute('role', 'status');
  let columns = [];
  let distance = 0;
  let columnCount = 0;
  const entranceStarted = performance.now();
  const entranceAnimations = [];
  let animateColumns = animateEntrance;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const drawAssets = (items) => {
    grid.replaceChildren();
    columns = [];
    const count = Math.min(items.length, window.matchMedia('(min-width: 900px)').matches ? 3 : 2);
    columnCount = count;
    grid.style.gridTemplateColumns = `repeat(${Math.max(1, count)}, minmax(0, 1fr))`;
    const createTile = (asset, repeated) => {
      const tile = make('figure', '', 'kiosk-variation');
      if (repeated) {
        tile.className = 'kiosk-variation-repeat';
        tile.setAttribute('aria-hidden', 'true');
      }
      const img = document.createElement('img');
      img.alt = repeated ? '' : asset.label;
      img.draggable = false;
      img.referrerPolicy = 'no-referrer';
      img.loading = 'eager';
      img.addEventListener('error', () => {
        tile.classList.add('kiosk-variation-failed');
        status.textContent = text.variationsImageFailed;
      }, { once: true, signal });
      img.src = asset.url;
      tile.append(img);
      return tile;
    };
    Array.from({ length: count }, (_, columnIndex) => {
      const column = make('div', '', 'kiosk-variations-column');
      const track = make('div', '', 'kiosk-variations-track');
      const sequence = make('div', '', 'kiosk-variations-sequence');
      const assigned = items.filter((item, index) => index % count === columnIndex);
      if (columnIndex % 2) assigned.reverse();
      assigned.forEach((asset) => sequence.append(createTile(asset, false)));
      const reordered = [...assigned].reverse();
      if (reordered.length > 1) reordered.push(reordered.shift());
      reordered.forEach((asset) => sequence.append(createTile(asset, true)));
      track.append(sequence);
      // Repeat each column independently so different aspect ratios have no shared end.
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const duplicate = sequence.cloneNode(true);
        duplicate.setAttribute('aria-hidden', 'true');
        duplicate.querySelectorAll('.kiosk-variation').forEach((tile) => {
          tile.className = 'kiosk-variation-repeat';
          tile.setAttribute('aria-hidden', 'true');
          tile.querySelector('img').alt = '';
        });
        track.append(duplicate);
      }
      column.append(track);
      grid.append(column);
      if (animateColumns) {
        const duration = reducedMotion.matches ? 180 : 1200;
        const delay = reducedMotion.matches ? 0 : 250 + columnIndex * 140;
        entranceAnimations.push(column.animate(
          reducedMotion.matches
            ? [{ opacity: 0 }, { opacity: 1 }]
            : [{ opacity: 0, transform: 'translateY(56px)' }, { opacity: 1, transform: 'translateY(0)' }],
          {
            duration, delay, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards',
          },
        ));
      }
      columns.push({ track, sequence });
      return column;
    });
    animateColumns = false;
    distance = 0;
    viewport.scrollTop = 0;
  };
  drawAssets(assets);
  window.addEventListener('resize', () => {
    const count = Math.min(currentAssets.length, window.matchMedia('(min-width: 900px)').matches ? 3 : 2);
    if (count !== columnCount) drawAssets(currentAssets);
  }, { signal });
  viewport.append(grid);
  let resumeAt = 0;
  let dragging = false;
  let modalOpen = false;
  let raf;
  let previous = 0;
  let position = 0;
  let autoTop = 0;
  let pollTimer;
  let assetSignature = '';
  const download = make('a', text.downloadBannerPDF, 'kiosk-banner-download');
  download.target = '_blank';
  download.rel = 'noopener noreferrer';
  download.referrerPolicy = 'no-referrer';
  async function refreshResults() {
    try {
      const result = await loadResults();
      if (signal.aborted) return;
      const images = result.assets.filter((asset) => (
        asset.status === 'ready' && asset.mimeType?.startsWith('image/')
      ));
      const pdf = result.assets.find((asset) => (
        asset.status === 'ready' && asset.mimeType === 'application/pdf'
      ));
      if (pdf) {
        download.href = pdf.url;
        if (!download.isConnected) controls.append(download);
      } else download.remove();
      const signature = JSON.stringify(images);
      if (signature !== assetSignature) {
        drawAssets(images);
        assetSignature = signature;
        position = viewport.scrollTop;
        autoTop = position;
      }
      currentAssets = images;
      syncWorkflow();
      const previewUnavailable = result.assets.some((asset) => asset.status === 'unavailable');
      status.textContent = result.status === 'ready' ? '' : text[`banner_${result.status}`] || '';
      if (previewUnavailable || (result.status === 'ready' && !images.length)) {
        status.textContent = text.bannerPreviewUnavailable;
      }
      if (!['ready', 'failed'].includes(result.status)) {
        pollTimer = setTimeout(refreshResults, 5000);
      }
    } catch (error) {
      if (!signal.aborted) {
        status.textContent = `${text.bannerReadFailed} ${error.message}`;
        pollTimer = setTimeout(refreshResults, 5000);
      }
    }
  }
  const pauseForInteraction = () => {
    resumeAt = performance.now() + 1000;
  };
  ['wheel', 'keydown', 'touchmove'].forEach((event) => {
    viewport.addEventListener(event, pauseForInteraction, { passive: true, signal });
  });
  viewport.addEventListener('pointerdown', () => {
    dragging = true;
    pauseForInteraction();
  }, { passive: true, signal });
  const release = () => {
    if (!dragging) return;
    dragging = false;
    pauseForInteraction();
  };
  window.addEventListener('pointerup', release, { passive: true, signal });
  window.addEventListener('pointercancel', release, { passive: true, signal });
  viewport.addEventListener('scroll', () => {
    if (Math.abs(viewport.scrollTop - autoTop) > 1) pauseForInteraction();
  }, { passive: true, signal });
  const openWorkflow = button(text.viewProduction, () => {
    const dialog = make('dialog', '', 'kiosk-workflow-dialog');
    dialog.setAttribute('aria-label', text.productionWorkflowTitle);
    const outside = (event) => {
      const bounds = dialog.getBoundingClientRect();
      return event.target === dialog && (event.clientX < bounds.left
        || event.clientX > bounds.right || event.clientY < bounds.top
        || event.clientY > bounds.bottom);
    };
    let backdropPress = false;
    dialog.addEventListener('pointerdown', (event) => {
      backdropPress = outside(event);
    });
    dialog.addEventListener('click', (event) => {
      if (backdropPress && outside(event)) dialog.close();
      backdropPress = false;
    });
    const bar = make('div', '', 'kiosk-workflow-bar');
    const close = make('button', '', 'kiosk-workflow-close');
    close.textContent = '×';
    close.setAttribute('aria-label', text.closeWorkflow);
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    bar.append(make('h2', text.productionWorkflowTitle, ''), close);
    dialog.append(bar);
    const operation = new AbortController();
    let iframe;
    let ready = false;
    let workflowPortrait = null;
    const notify = () => {
      if (!ready || operation.signal.aborted) return;
      iframe.contentWindow.postMessage({
        type: 'KIOSK_WORKFLOW_ASSETS',
        portraitId,
        portraitUrl: workflowPortrait,
        previewUrl: sample ? null : currentAssets[0]?.url || null,
      }, window.location.origin);
    };
    syncWorkflow = notify;
    const receive = (event) => {
      if (!iframe || event.source !== iframe.contentWindow
        || event.origin !== window.location.origin || !event.data
        || typeof event.data !== 'object' || Array.isArray(event.data)
        || event.data.type !== 'KIOSK_WORKFLOW_READY') return;
      ready = true;
      notify();
    };
    window.addEventListener('message', receive, { signal: operation.signal });
    if (workflow?.enabled) {
      iframe = document.createElement('iframe');
      iframe.title = text.productionWorkflowTitle;
      iframe.referrerPolicy = 'no-referrer';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.src = workflow.url;
      dialog.append(iframe);
      const message = make('p', text.workflowAssetsLoading, 'kiosk-workflow-asset-status');
      message.setAttribute('role', 'status');
      dialog.append(message);
      loadWorkflowPortrait(operation.signal).then((url) => {
        if (operation.signal.aborted) return;
        workflowPortrait = url;
        message.textContent = url ? '' : text.workflowPortraitUnavailable;
        notify();
      }).catch(() => {
        if (operation.signal.aborted) return;
        message.textContent = text.workflowPortraitUnavailable;
        notify();
      });
    } else dialog.append(make('p', text.workflowUnavailable, 'kiosk-workflow-unavailable'));
    const dispose = () => {
      operation.abort();
      syncWorkflow = () => {};
      modalOpen = false;
      dialog.remove();
      signal.removeEventListener('abort', dispose);
      if (!signal.aborted && openWorkflow.isConnected) openWorkflow.focus({ preventScroll: true });
    };
    dialog.addEventListener('close', dispose, { once: true });
    signal.addEventListener('abort', dispose, { once: true });
    block.append(dialog);
    modalOpen = true;
    dialog.showModal();
    close.focus();
  });
  openWorkflow.className = 'kiosk-variations-workflow';
  if (onFinish) controls.append(button(text.finishVariations, onFinish));
  copy.append(status, controls);
  panel.append(copy, viewport, openWorkflow);
  if (animateEntrance) {
    copyText.style.animation = 'none';
    entranceAnimations.push(copyText.animate(
      reducedMotion.matches ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translateY(32px)' }, { opacity: 1, transform: 'translateY(0)' }],
      {
        duration: reducedMotion.matches ? 180 : 900,
        delay: reducedMotion.matches ? 0 : 350,
        easing: 'cubic-bezier(0.2, 0, 0.2, 1)',
        fill: 'backwards',
      },
    ));
    [controls, openWorkflow].forEach((node) => entranceAnimations.push(node.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: reducedMotion.matches ? 180 : 500, delay: reducedMotion.matches ? 0 : 1100, fill: 'backwards' },
    )));
  }
  if (loadResults) refreshResults();
  const scroll = (now) => {
    const elapsed = previous ? Math.min(now - previous, 64) : 0;
    previous = now;
    if (!reducedMotion.matches && !dragging && now >= resumeAt
      && !modalOpen && !document.hidden) {
      const speed = animateEntrance ? Math.min(1, (now - entranceStarted) / 1200) : 1;
      distance += elapsed * 0.025 * speed;
    }
    distance += viewport.scrollTop - position;
    position = viewport.scrollTop;
    columns.forEach(({ track, sequence }) => {
      if (reducedMotion.matches) {
        track.style.transform = '';
        return;
      }
      const { height } = sequence.getBoundingClientRect();
      if (height > 0) {
        while (track.getBoundingClientRect().height < height + viewport.clientHeight + 32) {
          track.append(track.lastElementChild.cloneNode(true));
        }
      }
      const looping = height > 0;
      const offset = looping ? ((distance % height) + height) % height : 0;
      track.style.transform = `translateY(${viewport.scrollTop - offset}px)`;
    });
    autoTop = viewport.scrollTop;
    raf = requestAnimationFrame(scroll);
  };
  raf = requestAnimationFrame(scroll);
  signal.addEventListener('abort', () => {
    entranceAnimations.forEach((animation) => animation.cancel());
    cancelAnimationFrame(raf);
    clearTimeout(pollTimer);
  }, { once: true });
}
