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
  img.referrerPolicy = 'no-referrer';
  preview.append(img);

  const cta = document.createElement('p');
  cta.className = 'download-cta';
  cta.textContent = 'Use the button below to download and share your photos!';

  const btn = document.createElement('a');
  btn.className = 'download-btn';
  btn.href = imgUrl;
  btn.target = '_blank';
  btn.rel = 'noopener';
  btn.referrerPolicy = 'no-referrer';
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

  const controller = new AbortController();
  let timer;
  let polls = 0;
  window.addEventListener('pagehide', () => {
    controller.abort();
    clearTimeout(timer);
  }, { once: true });
  function renderImage(item, i, sessionName) {
    const card = document.createElement('div');
    card.className = 'download-gallery-item';

    const img = document.createElement('img');
    img.src = item.url;
    img.alt = sessionName ? `${sessionName}'s personalized ad ${i + 1}` : `Personalized ad ${i + 1}`;
    img.loading = i === 0 ? 'eager' : 'lazy';
    img.referrerPolicy = 'no-referrer';

    const btn = document.createElement('a');
    btn.className = 'download-gallery-btn';
    btn.href = item.url;
    btn.download = item.filename || `ad-${i + 1}.jpg`;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.referrerPolicy = 'no-referrer';
    const btnImg = document.createElement('img');
    btnImg.src = '/blocks/download/download-icon.png';
    btnImg.alt = 'Download & Share';
    btn.append(btnImg);

    card.append(img, btn);
    gallery.append(card);
  }
  async function load() {
    clearTimeout(timer);
    let session;
    let failure = 'Could not reach your ads. Check your connection and reload to try again.';
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(sessionUrl, {
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal,
      });
      if (!res.ok) {
        failure = res.status === 403
          ? 'Access to your ads was denied or has expired.'
          : `Could not load your ads (HTTP ${res.status}).`;
        throw new Error('Download request failed.');
      }
      failure = 'The download manifest could not be read. Please contact booth staff.';
      session = await res.json();
      if (!session || !Array.isArray(session.images)) throw new Error('Invalid download manifest.');
      if (session.schemaVersion !== undefined) {
        failure = 'The download manifest does not match its image links. Please contact booth staff.';
        if (!(Date.parse(session.expiresAt) > Date.now())) {
          failure = 'Your download link has expired.';
        }
        // eslint-disable-next-line no-use-before-define
        validateShareManifest(session, sessionUrl);
      }
    } catch {
      gallery.textContent = failure;
      return;
    } finally { clearTimeout(timeout); }
    if (!block.isConnected || controller.signal.aborted) return;
    gallery.replaceChildren();
    const images = session.images.filter((item) => (
      session.schemaVersion === undefined || item.status === 'ready'
    ));
    images.forEach((item, i) => renderImage(item, i, name || session.name || ''));
    if (session.status === 'pending' || session.status === 'partial') {
      const message = document.createElement('p');
      message.textContent = session.status === 'partial'
        ? 'Some ads are ready. The remaining personalized ads are still being prepared.'
        : 'Your four personalized ads are being prepared. This page will update automatically.';
      gallery.append(message);
      polls += 1;
      if (polls < 60) timer = setTimeout(load, 5000);
      else message.textContent += ' Reload to check again.';
    } else if (session.status === 'failed') {
      const message = document.createElement('p');
      message.textContent = 'Some or all ads could not be prepared. Please contact booth staff.';
      gallery.append(message);
    } else if (!images.length) gallery.textContent = 'No ads found in this session.';
  }
  await load();
}

function validateShareManifest(session, sessionUrl) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const brands = ['larocheposay', 'lorealprofessionnel', 'yslbeauty', 'lorealparis'];
  const manifest = new URL(sessionUrl);
  const prefix = manifest.pathname.slice(0, -'session.json'.length);
  const validURL = (value, path) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'ffservices24.blob.core.windows.net'
      && !url.port && !url.username && !url.password && !url.hash
      && url.pathname === path && url.searchParams.get('sr') === 'b'
      && url.searchParams.get('sp') === 'r' && !!url.searchParams.get('sig')
      && Date.parse(url.searchParams.get('se')) === Date.parse(session.expiresAt);
  };
  if (session.schemaVersion !== 1 || !uuid.test(session.requestId)
    || !/^azure_[0-9a-f]{64}$/.test(session.portraitId)
    || typeof session.name !== 'string' || session.name.length > 80
    || !['pending', 'partial', 'ready', 'failed'].includes(session.status)
    || !(Date.parse(session.expiresAt) > Date.now())
    || !prefix.endsWith(`/7-Share-Output/${session.requestId}/`)
    || !validURL(sessionUrl, `${prefix}session.json`)
    || session.images.length !== 4
    || new Set(session.images.map((item) => item.brand)).size !== 4) {
    throw new Error('Invalid or expired attendee share manifest.');
  }
  session.images.forEach((item) => {
    if (!brands.includes(item.brand) || !['pending', 'ready', 'failed'].includes(item.status)
      || item.filename !== `${item.brand}.jpg`
      || (item.status === 'ready' ? !validURL(item.url, `${prefix}${item.brand}.jpg`) : item.url !== null)) {
      throw new Error('Invalid attendee image link.');
    }
  });
  if (session.status === 'ready' && session.images.some((item) => item.status !== 'ready')) {
    throw new Error('The share manifest is incomplete.');
  }
}

export default function decorate(block) {
  const params = new URLSearchParams(window.location.search);
  const imgUrl = params.get('img');
  const sessionUrl = params.get('session');
  const name = params.get('name') || '';

  if (sessionUrl) {
    renderSession(block, sessionUrl, name);
  } else if (imgUrl) {
    renderSingle(block, imgUrl, name);
  } else {
    block.innerHTML = '<p class="download-error">This download link is invalid or has expired.</p>';
  }
}
