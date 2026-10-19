const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    const logs = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => logs.push(message.text()));
    await page.route('https://firefly.adobe.com/**', (route) => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><body><pg-node></pg-node><div id="notices"></div><p id="ordinary">Save a copy is also ordinary page text.</p></body></html>',
    }));
    const cutout = new URL(`https://ffservices24.blob.core.windows.net/meow-ffs-storage-corex/TestEvent/9-Graph-Input/azure_${'a'.repeat(64)}/portrait.png`);
    cutout.search = new URLSearchParams({
      sv: '2023-11-03', sr: 'b', sp: 'r', spr: 'https', sig: 'MOCK_ONLY',
      st: new Date(Date.now() - 60000).toISOString(),
      se: new Date(Date.now() + 7 * 86400000 - 1000).toISOString(),
    });
    await page.goto(`https://firefly.adobe.com/graph/fixture#${new URLSearchParams({ portraitUrl: cutout.href, keep: 'yes' })}`);
    await page.evaluate(async ({ publicFixture, badDigest, currentWidget, blockedWidget }) => {
      window.unsafeWindow = window;
      window.originalPicker = async () => { throw new Error('Native picker must not open'); };
      window.showOpenFilePicker = window.originalPicker;
      window.downloads = 0;
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (publicFixture) {
        const digest = await crypto.subtle.digest('SHA-256', await png.arrayBuffer());
        const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
        const metadata = {
          personId: 'demo_Test', templateSetId: 'max_square', version: 'a'.repeat(32),
          brand: '4-lorealparis', sha256: badDigest ? '0'.repeat(64) : sha256,
        };
        const url = `https://kiosk-preview--glam-kiosk-site--lukevan.aem.page/assets/permanent-demo-cutouts/demo_Test/max_square/${metadata.version}/4-lorealparis.png`;
        location.hash = new URLSearchParams({ portraitUrl: url, publicDemo: JSON.stringify(metadata), keep: 'yes' }).toString();
      }
      window.GM_xmlhttpRequest = async (request) => {
        window.downloads += 1;
        request.onload({ status: 200, finalUrl: request.url, response: png });
      };
      const node = document.querySelector('pg-node');
      const root = node.attachShadow({ mode: 'open' });
      root.innerHTML = '<input value="Input image"><slot name="widget"></slot>';
      const list = document.createElement('pg-widget-list');
      list.slot = 'widget';
      node.append(list);
      const widgets = list.attachShadow({ mode: 'open' });
      widgets.innerHTML = '<adobe-widget-image-1792362854273></adobe-widget-image-1792362854273>';
      const upload = widgets.firstElementChild.attachShadow({ mode: 'open' });
      upload.innerHTML = currentWidget
        ? '<div class="dropzone" aria-busy="false"><div class="content"><svg class="dashed-border"></svg><div class="prompt"><sp-icon-image class="placeholder-icon">Image</sp-icon-image><div class="prompt-text"><span class="prompt-title">Drag and drop your file,</span><span class="prompt-subtitle">or select from your device</span></div></div><sp-button class="browse-button" role="button">Browse files</sp-button></div></div>'
        : '<button class="dropzone empty">Upload</button>';
      if (blockedWidget === 'busy') upload.firstElementChild.setAttribute('aria-busy', 'true');
      if (blockedWidget === 'populated') upload.firstElementChild.append(document.createElement('img'));
      if (blockedWidget === 'ambiguous') upload.append(upload.firstElementChild.cloneNode(true));
      upload.querySelector('.dropzone').onclick = () => {
        if (document.querySelector('#device')) return;
        const device = document.createElement('button');
        device.id = 'device';
        device.textContent = 'Your device';
        device.onclick = async () => {
          const [handle] = await window.showOpenFilePicker();
          const file = await handle.getFile();
          window.uploaded = {
            name: file.name, type: file.type, size: file.size,
            pageFile: file instanceof window.File,
          };
        };
        document.body.append(device);
      };
      const notices = document.querySelector('#notices').attachShadow({ mode: 'open' });
      notices.innerHTML = '<div role="status" style="width:300px;height:80px">Save a copy to edit this graph</div>';
      const dialog = document.createElement('dialog');
      dialog.textContent = 'You do not have edit access';
      document.body.append(dialog);
      dialog.showModal();
    }, {
      publicFixture: Boolean(process.env.PUBLIC_DEMO_FIXTURE),
      badDigest: Boolean(process.env.BAD_DEMO_DIGEST),
      currentWidget: Boolean(process.env.CURRENT_GRAPH_WIDGET),
      blockedWidget: process.env.BLOCKED_GRAPH_WIDGET || '',
    });
    await page.addScriptTag({ content: fs.readFileSync('tools/graph-auto-load.user.js', 'utf8') });
    if (process.env.BLOCKED_GRAPH_WIDGET) {
      await page.waitForTimeout(1800);
      assert(logs.some((message) => message.includes('Looking for its upload area.')));
      assert.equal(await page.evaluate(() => Boolean(window.uploaded)), false);
      assert.equal(await page.evaluate(() => showOpenFilePicker === window.originalPicker), true);
      assert.equal(await page.locator('#device').count(), 0);
      console.log(`Graph ${process.env.BLOCKED_GRAPH_WIDGET} widget rejected without picker/upload.`);
      return;
    }
    if (process.env.BAD_DEMO_DIGEST) {
      await page.waitForFunction(() => location.hash === '#keep=yes');
      await page.waitForTimeout(500);
      assert.equal(await page.evaluate(() => Boolean(window.uploaded)), false);
      assert(logs.some((message) => message.includes('Portrait download was not a valid PNG.')));
      assert.equal(await page.evaluate(() => showOpenFilePicker === window.originalPicker), true);
      console.log('Public demo checksum mismatch blocks picker/import without exposing signed URLs.');
      return;
    }
    await page.waitForFunction(() => window.uploaded).catch((error) => {
      throw new Error(`${error.message}\nFixture console: ${logs.join('\n')}\nPage errors: ${errors.join('\n')}`);
    });
    const result = await page.evaluate(() => ({
      uploaded: window.uploaded,
      downloads: window.downloads,
      pickerRestored: showOpenFilePicker === window.originalPicker,
      hash: location.hash,
      dialogClosed: !document.querySelector('dialog').open,
      toastHidden: getComputedStyle(document.querySelector('#notices').shadowRoot.querySelector('[role="status"]')).display === 'none',
      ordinaryVisible: getComputedStyle(document.querySelector('#ordinary')).display !== 'none',
    }));
    assert.equal(result.uploaded.name, 'portrait.png');
    assert.equal(result.uploaded.type, 'image/png');
    assert.equal(result.uploaded.pageFile, true);
    assert(result.uploaded.size > 8);
    assert.equal(result.downloads, 1);
    assert.equal(result.pickerRestored, true);
    assert.equal(result.hash, '#keep=yes');
    assert.equal(result.dialogClosed, true);
    assert.equal(result.toastHidden, true);
    assert.equal(result.ordinaryVisible, true);
    assert.equal(await page.locator('#max-see-ads-btn').innerText(), 'See your Ads');
    assert(logs.some((message) => message.includes('Portrait supplied to Graph file picker.')));
    assert(logs.every((message) => !message.includes('MOCK_ONLY')));
    assert.deepEqual(errors, []);
    console.log('Graph userscript fixture: shadow-DOM node lookup, PNG download, page-realm File, one-use picker restoration, return button and v1.8 notice suppression passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
