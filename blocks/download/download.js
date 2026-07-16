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

  const brand = document.createElement('div');
  brand.className = 'download-brand';
  brand.innerHTML = '<span class="download-brand-adobe">Adobe</span> <span class="download-brand-x">×</span> <span class="download-brand-loreal">L\'Oréal Groupe</span>';

  const heading = document.createElement('h1');
  heading.className = 'download-heading';
  heading.textContent = name ? `Looking good, ${name}!` : 'Looking good!';

  const sub = document.createElement('p');
  sub.className = 'download-sub';
  sub.textContent = 'Why not share this on social media?';

  const preview = document.createElement('div');
  preview.className = 'download-preview';
  const img = document.createElement('img');
  img.src = imgUrl;
  img.alt = 'Your personalized ad';
  img.loading = 'eager';
  preview.append(img);

  const btn = document.createElement('a');
  btn.className = 'download-btn';
  btn.href = imgUrl;
  btn.textContent = 'Download & Share';
  // Content-Disposition: attachment on the blob triggers a native download on navigate
  btn.target = '_blank';
  btn.rel = 'noopener';

  const footer = document.createElement('p');
  footer.className = 'download-footer';
  footer.innerHTML = 'Made by you. Created with <strong>Adobe Firefly</strong>';

  wrap.append(brand, heading, sub, preview, btn, footer);
  block.replaceChildren(wrap);
}
