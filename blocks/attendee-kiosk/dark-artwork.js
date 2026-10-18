const ROOT = '/blocks/attendee-kiosk/assets/';

export function darkLockup() {
  const logo = document.createElement('span');
  logo.className = 'kiosk-dark-lockup';
  logo.setAttribute('role', 'img');
  logo.setAttribute('aria-label', 'Adobe × L’Oréal Groupe');
  [
    ['adobe', 0, 4.95, 223.917, 54.106],
    ['cross', 243.857, 19.69, 24.332, 24.592],
    ['loreal', 289.247, 0, 248.328, 64],
  ].forEach(([name, x, y, width, height]) => {
    const part = document.createElement('span');
    Object.assign(part.style, {
      left: `${(x / 538) * 100}%`,
      top: `${(y / 64) * 100}%`,
      width: `${(width / 538) * 100}%`,
      height: `${(height / 64) * 100}%`,
      backgroundImage: `url("${ROOT}dark-logo-${name}.svg")`,
    });
    logo.append(part);
  });
  return logo;
}

export function darkNameLens() {
  const lens = document.createElement('div');
  lens.className = 'kiosk-name-lens';
  lens.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('div');
  canvas.className = 'kiosk-lens-canvas';
  // Insets from the Figma MAX Lens in its 1136 × 920 trailing-artwork frame.
  [
    [2.93, 0, 85.39, 33.48],
    [15.04, 0, 2.93, 90.54],
    [85.37, 28.48, 2.93, 62.04],
    [26.8, 66.4, 61.5, 24.19],
    [38.5, 66.4, 49.8, 24.12],
    [85.37, 37.96, 2.93, 52.63],
    [61.89, 66.4, 26.41, 24.12],
    [85.37, 47.44, 2.93, 43.08],
    [85.37, 56.92, 2.93, 33.6],
    [3.41, 66.4, 84.89, 24.12],
    [50.2, 66.4, 38.11, 24.12],
    [85.37, 9.69, 2.93, 80.83],
    [15.11, 66.35, 73.2, 24.36],
    [76.14, 68.49, 17.26, 26.27],
    [84.69, 66.33, 3.53, 24.26],
    [85.37, 19.3, 3.15, 71.41],
  ].forEach((insets, index) => {
    const piece = document.createElement('span');
    const image = document.createElement('span');
    piece.style.inset = insets.map((value) => `${value}%`).join(' ');
    piece.className = index === 1 ? 'kiosk-lens-piece kiosk-lens-rotated' : 'kiosk-lens-piece';
    image.style.backgroundImage = `url("${ROOT}dark-lens-${String(index + 1).padStart(2, '0')}.svg")`;
    piece.append(image);
    canvas.append(piece);
  });
  lens.append(canvas);
  return lens;
}
