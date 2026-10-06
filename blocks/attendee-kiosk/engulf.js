export default function playAdEngulf(block, panel, frameSlot, selectedId, signal) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches
    || window.innerWidth <= 800) return () => {};
  const selected = [...panel.querySelectorAll('.kiosk-ad-grid .kiosk-card')]
    .find((card) => card.dataset.assetId === selectedId);
  const image = selected?.querySelector('img');
  if (!image) return () => {};
  const from = selected.getBoundingClientRect();
  const overlay = panel.cloneNode(true);
  overlay.classList.add('kiosk-engulf-overlay');
  overlay.inert = true;
  overlay.setAttribute('aria-hidden', 'true');
  const ghost = document.createElement('div');
  ghost.className = 'kiosk-engulf-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  ghost.append(image.cloneNode());
  Object.assign(ghost.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
  });
  const overlayCards = [...overlay.querySelectorAll('.kiosk-ad-grid .kiosk-card')];
  let delay = 0;
  overlayCards.forEach((card) => {
    if (card.dataset.assetId === selectedId) card.style.visibility = 'hidden';
    else {
      card.style.transitionDelay = `${delay}ms`;
      delay += 91;
    }
  });
  block.append(overlay, ghost);
  panel.classList.add('kiosk-engulf-underlay');
  frameSlot.classList.add('kiosk-engulf-frame');
  let firstFrame;
  let nextFrame;
  let timeout;
  const cleanup = () => {
    cancelAnimationFrame(firstFrame);
    cancelAnimationFrame(nextFrame);
    clearTimeout(timeout);
    overlay.remove();
    ghost.remove();
    panel.classList.remove('kiosk-engulf-underlay');
    frameSlot.classList.remove('kiosk-engulf-frame');
    signal.removeEventListener('abort', cleanup);
  };
  firstFrame = requestAnimationFrame(() => {
    nextFrame = requestAnimationFrame(() => {
      const target = frameSlot.getBoundingClientRect();
      // Match the prototype's conversation attachment inside the resized EDS iframe.
      Object.assign(ghost.style, {
        left: `${target.left + target.width * 0.6232 - 100}px`,
        top: `${target.top + target.height * 0.5244 - 100}px`,
        width: '200px',
        height: '200px',
      });
      ghost.classList.add('kiosk-engulf-settle');
      overlay.classList.add('kiosk-engulf-exit');
      overlayCards.forEach((card) => {
        if (card.dataset.assetId !== selectedId) card.classList.add('kiosk-engulf-tile-exit');
      });
      timeout = setTimeout(cleanup, 850);
    });
  });
  signal.addEventListener('abort', cleanup, { once: true });
  return cleanup;
}
