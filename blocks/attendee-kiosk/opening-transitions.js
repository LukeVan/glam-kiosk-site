const NEXT = { welcome: 'portraits', portraits: 'name', name: 'story' };
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export default function captureOpeningTransition(block, panel, stage, signal) {
  const from = Object.keys(NEXT).find((value) => panel.classList.contains(`kiosk-panel-${value}`));
  if (NEXT[from] !== stage) return () => {};
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const animations = new Set();
  const overlays = new Set();
  const outgoing = panel.cloneNode(true);
  outgoing.classList.add('kiosk-opening-outgoing');
  outgoing.inert = true;
  outgoing.setAttribute('aria-hidden', 'true');
  outgoing.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  outgoing.querySelectorAll('video').forEach((video) => {
    const poster = document.createElement('img');
    poster.className = video.className;
    poster.src = video.poster;
    poster.alt = '';
    video.replaceWith(poster);
  });
  overlays.add(outgoing);
  let ghost;
  const source = panel.querySelector('.kiosk-portrait-grid [aria-pressed="true"] img');
  const localBox = (node) => {
    const bounds = block.getBoundingClientRect();
    const scale = bounds.width / block.offsetWidth;
    const box = node.getBoundingClientRect();
    return {
      left: (box.left - bounds.left) / scale,
      top: (box.top - bounds.top) / scale,
      width: box.width / scale,
      height: box.height / scale,
    };
  };
  if (source && !reduced) {
    ghost = source.cloneNode();
    ghost.className = 'kiosk-opening-portrait';
    ghost.alt = '';
    ghost.setAttribute('aria-hidden', 'true');
    Object.entries(localBox(source)).forEach(([key, value]) => { ghost.style[key] = `${value}px`; });
    overlays.add(ghost);
  }
  const cleanup = () => {
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    overlays.forEach((node) => node.remove());
    signal.removeEventListener('abort', cleanup);
  };
  signal.addEventListener('abort', cleanup, { once: true });
  return (frameSlot) => {
    if (signal.aborted) { cleanup(); return; }
    block.append(outgoing);
    if (ghost) block.append(ghost);
    const run = (node, frames, duration = 600, delay = 0) => {
      if (!node) return Promise.resolve();
      const animation = node.animate(frames, {
        duration, delay, easing: EASING, fill: 'backwards',
      });
      animations.add(animation);
      return animation.finished.then(
        () => { animations.delete(animation); },
        () => { animations.delete(animation); },
      );
    };
    const enter = (node, delay = 0) => run(node, [
      { opacity: 0, transform: 'translateY(28px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], 550, delay);
    const work = [run(outgoing, reduced ? [{ opacity: 1 }, { opacity: 0 }] : [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-24px)' },
    ], reduced ? 160 : 300).then(() => outgoing.remove())];
    if (reduced) {
      work.push(run(panel, [{ opacity: 0 }, { opacity: 1 }], 160));
      if (stage === 'story') work.push(run(frameSlot, [{ opacity: 0 }, { opacity: 1 }], 160));
    } else if (stage === 'portraits') {
      work.push(enter(panel.querySelector('.kiosk-portrait-copy'), 80));
      panel.querySelectorAll('.kiosk-portrait-grid .kiosk-card').forEach((card, index) => {
        work.push(enter(card, 100 + Math.min(index, 8) * 25));
      });
    } else if (stage === 'name') {
      work.push(enter(panel.querySelector('.kiosk-name-copy'), 120));
      work.push(run(panel.querySelector('.kiosk-name-lens'), [
        { opacity: 0, transform: 'scale(0.94) rotate(-3deg)' },
        { opacity: 1, transform: 'scale(1) rotate(0)' },
      ], 650, 40));
      const target = panel.querySelector('.kiosk-name-photo');
      if (ghost && target) {
        const destination = localBox(target);
        work.push(run(ghost, [
          { ...Object.fromEntries(['left', 'top', 'width', 'height'].map((key) => [key, ghost.style[key]])), borderRadius: '12px' },
          { ...Object.fromEntries(Object.entries(destination).map(([key, value]) => [key, `${value}px`])), borderRadius: getComputedStyle(target).borderRadius },
        ], 650).then(() => ghost.remove()));
        work.push(run(target, [{ opacity: 0 }, { opacity: 0 }], 650));
      } else work.push(enter(target));
    } else {
      work.push(run(frameSlot, [
        { opacity: 0, transform: 'translateX(64px) scale(0.97)' },
        { opacity: 1, transform: 'translateX(0) scale(1)' },
      ], 650));
      work.push(enter(panel.querySelector('.kiosk-coworker-copy'), 120));
    }
    Promise.all(work).then(cleanup);
  };
}
