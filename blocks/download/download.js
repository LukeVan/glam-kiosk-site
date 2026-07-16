export default function decorate(block) {
  const params = new URLSearchParams(window.location.search);
  const imgUrl = params.get('img');
  const name = params.get('name') || '';

  if (!imgUrl) {
    block.innerHTML = '<p class="download-error">This download link is invalid or has expired.</p>';
    return;
  }

  const wrap = document.createElement('div');
  wrap.className = 'download-wrap';

  const banner = document.createElement('div');
  banner.className = 'download-banner';
  banner.innerHTML = `
    <img src="/blocks/download/banner-desktop.png"
      alt="Adobe x L'Oréal Groupe" class="download-banner-desk">
    <img src="/blocks/download/banner-mobile.png"
      alt="Adobe x L'Oréal Groupe" class="download-banner-mobile">
  `;

  const heading = document.createElement('h2');
  heading.className = 'download-heading';
  heading.textContent = 'Looking good!';

  const sub = document.createElement('p');
  sub.className = 'download-sub';
  sub.textContent = 'Why not share this on social media?';

  const preview = document.createElement('div');
  preview.className = 'download-preview';
  const img = document.createElement('img');
  img.src = imgUrl;
  img.alt = name ? `${name}'s personalized ad` : 'Your personalized ad';
  img.className = 'img-fluid';
  img.loading = 'eager';
  preview.append(img);

  const cta = document.createElement('p');
  cta.className = 'download-cta';
  cta.textContent = 'Use the button below to download and share your photos!';

  const btn = document.createElement('a');
  btn.className = 'download-btn';
  btn.href = imgUrl;
  btn.target = '_blank';
  btn.rel = 'noopener';
  const btnImg = document.createElement('img');
  btnImg.src = '/blocks/download/download-icon.png';
  btnImg.alt = 'Download & Share';
  btnImg.className = 'img-fluid';
  btn.append(btnImg);

  wrap.append(banner, heading, sub, preview, cta, btn);
  block.replaceChildren(wrap);
}
