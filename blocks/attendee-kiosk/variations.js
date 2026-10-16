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
}) {
  const make = (tag, value, className) => {
    const node = document.createElement(tag);
    node.className = className;
    if (value) node.textContent = value;
    return node;
  };
  const copy = make('div', '', 'kiosk-variations-copy');
  copy.append(make('h2', text.variationsHeading, ''));
  const notice = make('p', sample ? text.variationsSample
    : assets.length && `${assets.length} ${text.personalizedVariations}`, 'kiosk-variations-notice');
  copy.append(notice);
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
  const drawAssets = (items) => {
    grid.replaceChildren();
    items.forEach((asset, index) => {
      const tile = make('figure', '', 'kiosk-variation');
      const img = document.createElement('img');
      img.alt = asset.label;
      img.draggable = false;
      img.referrerPolicy = 'no-referrer';
      img.loading = index < 6 ? 'eager' : 'lazy';
      img.addEventListener('error', () => {
        tile.classList.add('kiosk-variation-failed');
        status.textContent = text.variationsImageFailed;
      }, { once: true, signal });
      img.src = asset.url;
      tile.append(img);
      grid.append(tile);
    });
  };
  drawAssets(assets);
  viewport.append(grid);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
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
      notice.textContent = images.length
        ? `${images.length} ${text.personalizedVariations}` : '';
      const previewUnavailable = result.assets.some((asset) => asset.status === 'unavailable');
      status.textContent = previewUnavailable ? text.bannerPreviewUnavailable
        : text[`banner_${result.status}`] || '';
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
    const bar = make('div', '', 'kiosk-workflow-bar');
    const close = make('button', '', 'kiosk-workflow-close');
    close.textContent = '×';
    close.setAttribute('aria-label', text.closeWorkflow);
    close.type = 'button';
    close.addEventListener('click', () => dialog.close());
    bar.append(make('h2', text.productionWorkflowTitle, ''), close);
    dialog.append(bar);
    if (workflow?.enabled) {
      const iframe = document.createElement('iframe');
      iframe.title = text.productionWorkflowTitle;
      iframe.referrerPolicy = 'no-referrer';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.src = workflow.url;
      dialog.append(iframe);
    } else dialog.append(make('p', text.workflowUnavailable, 'kiosk-workflow-unavailable'));
    const dispose = () => {
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
  if (loadResults) refreshResults();
  const scroll = (now) => {
    const elapsed = previous ? Math.min(now - previous, 64) : 0;
    previous = now;
    if (!reducedMotion.matches && !dragging && now >= resumeAt
      && !modalOpen && !document.hidden) {
      const end = viewport.scrollHeight - viewport.clientHeight;
      position += elapsed * 0.025;
      if (end > 0 && position > end + 70) position = 0;
      viewport.scrollTop = Math.min(position, Math.max(end, 0));
      autoTop = viewport.scrollTop;
    } else position = viewport.scrollTop;
    raf = requestAnimationFrame(scroll);
  };
  raf = requestAnimationFrame(scroll);
  signal.addEventListener('abort', () => {
    cancelAnimationFrame(raf);
    clearTimeout(pollTimer);
  }, { once: true });
}
