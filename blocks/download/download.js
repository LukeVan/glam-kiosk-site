export default function decorate(block) {
  const params     = new URLSearchParams(window.location.search);
  const imgUrl     = params.get('img');
  const sessionUrl = params.get('session');
  const name       = params.get('name') || '';

  if (sessionUrl) {
    renderSession(block, sessionUrl, name);
  } else if (imgUrl) {
    renderSingle(block, imgUrl, name);
  } else {
    block.innerHTML = '<p class="download-error">This download link is invalid or has expired.</p>';
  }
}

function buildBanner() {
  const banner = document.createElement('div');
  banner.className = 'download-banner';
  banner.innerHTML = `
    <img src="/blocks/download/banner-desktop.png"
      alt="Adobe x L'Oréal Groupe" class="download-banner-desk">
    <img src="/blocks/download/banner-mobile.png"
      alt="Adobe x L'Oréal Groupe" class="download-banner-mobile">
  `;
  return banner;
}

function buildLinks() {
  const links = document.createElement('div');
  links.className = 'download-links';
  links.innerHTML = `
    <p class="download-links-heading">Learn more about Adobe solutions</p>
    <ul>
      <li><a href="https://business.adobe.com/solutions/content-supply-chain.html"
        target="_blank" rel="noopener">Content Supply Chain</a></li>
      <li><a href="https://business.adobe.com/products/firefly-business.html"
        target="_blank" rel="noopener">Adobe Firefly for Business</a></li>
    </ul>
  `;
  return links;
}

function renderSingle(block, imgUrl, name) {
  const wrap = document.createElement('div');
  wrap.className = 'download-wrap';

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

  wrap.append(buildBanner(), heading, sub, preview, cta, btn, buildLinks());
  block.replaceChildren(wrap);
}

async function renderSession(block, sessionUrl, name) {
  const wrap = document.createElement('div');
  wrap.className = 'download-wrap';

  const heading = document.createElement('h2');
  heading.className = 'download-heading';
  heading.textContent = 'Looking good!';

  const sub = document.createElement('p');
  sub.className = 'download-sub';
  sub.textContent = 'Download and share your personalized ads below.';

  const gallery = document.createElement('div');
  gallery.className = 'download-gallery';
  gallery.textContent = 'Loading your ads…';

  wrap.append(buildBanner(), heading, sub, gallery, buildLinks());
  block.replaceChildren(wrap);

  let images = [];
  let sessionName = name;
  try {
    const res = await fetch(sessionUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const session = await res.json();
    images = session.images || [];
    if (session.name && !sessionName) sessionName = session.name;
  } catch {
    gallery.textContent = 'Could not load your ads — the link may have expired.';
    return;
  }

  if (!images.length) {
    gallery.textContent = 'No ads found in this session.';
    return;
  }

  gallery.textContent = '';
  images.forEach((item, i) => {
    const card = document.createElement('div');
    card.className = 'download-gallery-item';

    const img = document.createElement('img');
    img.src = item.url;
    img.alt = sessionName ? `${sessionName}'s personalized ad ${i + 1}` : `Personalized ad ${i + 1}`;
    img.loading = i === 0 ? 'eager' : 'lazy';

    const btn = document.createElement('a');
    btn.className = 'download-gallery-btn';
    btn.href = item.url;
    btn.download = item.filename || `ad-${i + 1}.jpg`;
    btn.target = '_blank';
    btn.rel = 'noopener';
    const btnImg = document.createElement('img');
    btnImg.src = '/blocks/download/download-icon.png';
    btnImg.alt = 'Download & Share';
    btn.append(btnImg);

    card.append(img, btn);
    gallery.append(card);
  });
}
