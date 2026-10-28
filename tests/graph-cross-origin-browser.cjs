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
      contentType: 'text/html', body: '<!doctype html><body><div id="host"></div></body>',
    }));
    await page.route('https://graph.adobe.com/**', (route) => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><body><div id="input"></div></body>',
    }));
    const url = new URL(`https://ffservices24.blob.core.windows.net/meow-ffs-storage-corex/TestEvent/9-Graph-Input/azure_${'a'.repeat(64)}/portrait.png`);
    url.search = new URLSearchParams({
      sv: '2023-11-03', sr: 'b', sp: 'r', spr: 'https', sig: 'MOCK_ONLY',
      st: new Date(Date.now() - 60000).toISOString(),
      se: new Date(Date.now() + 86400000).toISOString(),
    });
    await page.goto(`https://firefly.adobe.com/graph/capsule/id/fixture#${new URLSearchParams({ portraitUrl: url.href })}`);
    const navigation = page.waitForEvent('framenavigated', {
      predicate: (item) => item.url().startsWith('https://graph.adobe.com/'),
    });
    await page.evaluate(() => {
      window.unsafeWindow = window;
      window.GM_xmlhttpRequest = () => { throw new Error('Parent must not download'); };
      document.querySelector('#host').attachShadow({ mode: 'open' }).innerHTML = '<iframe src="https://graph.adobe.com/capsule/fixture" style="width:900px;height:700px"></iframe>';
    });
    const frame = await navigation;
    await frame.waitForSelector('#input', { state: 'attached' });
    await frame.evaluate(() => {
      window.unsafeWindow = window;
      window.downloads = 0;
      const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0y8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
      window.GM_xmlhttpRequest = (request) => {
        window.downloads += 1;
        request.onload({
          status: 200, finalUrl: request.url, response: new Blob([bytes], { type: 'image/png' }),
        });
      };
      window.originalPicker = async () => { throw new Error('Native picker must not open'); };
      window.showOpenFilePicker = window.originalPicker;
      const root = document.querySelector('#input').attachShadow({ mode: 'open' });
      // Real capsule renders the label before its image widget/uploader.
      root.innerHTML = '<section><span>Input Image</span></section>';
      window.uploaderClicks = 0;
      window.renderUploader = () => {
        root.querySelector('section').insertAdjacentHTML('beforeend', '<capsule-widget-frame><sp-action-button role="button" aria-label="Upload new image">Upload new</sp-action-button></capsule-widget-frame>');
        root.querySelector('sp-action-button').onclick = () => {
        window.uploaderClicks += 1;
        // First click is swallowed to exercise the menu retry.
        if (window.uploaderClicks === 1) return;
        const device = document.createElement('button');
        device.textContent = 'Your device';
        device.onclick = async () => {
          const [handle] = await window.showOpenFilePicker();
          const file = await handle.getFile();
          window.uploaded = file.name === 'portrait.png' && file instanceof window.File;
          const busy = document.createElement('div');
          busy.setAttribute('aria-busy', 'true');
          root.querySelector('section').append(busy);
          const toolbar = document.createElement('capsule-run-controls');
          document.body.append(toolbar);
          const controls = toolbar.attachShadow({ mode: 'open' });
          controls.innerHTML = '<sp-button role="button" disabled>Run</sp-button>';
          const run = controls.querySelector('sp-button');
          window.runs = 0;
          run.onclick = () => { window.runs += 1; };
          setTimeout(() => {
            busy.setAttribute('aria-busy', 'false');
            run.removeAttribute('disabled');
          }, 600);
        };
        document.body.append(device);
        };
      };
      setTimeout(window.renderUploader, 1500);
    });
    const script = fs.readFileSync('tools/graph-auto-load.user.js', 'utf8');
    // The child must reject unsolicited same-frame messages, even with a valid-looking payload.
    await frame.addScriptTag({ content: script });
    await frame.evaluate(() => window.postMessage({
      type: 'MAX_GRAPH_HANDOFF', parameters: 'portraitUrl=invalid',
    }, '*'));
    await page.waitForTimeout(200);
    assert.equal(await frame.evaluate(() => window.downloads), 0);
    await page.addScriptTag({ content: script });
    assert.equal(await page.locator('#max-see-ads-btn').count(), 0);
    await frame.waitForFunction(() => window.runs === 1, null, { timeout: 30000 });
    await page.waitForSelector('#max-see-ads-btn', { timeout: 8000 });
    await page.waitForTimeout(700);
    assert.equal(await frame.evaluate(() => window.runs), 1);
    assert.equal(await frame.evaluate(() => window.uploaded), true);
    assert.equal(await frame.evaluate(() => window.downloads), 1);
    assert.equal(await frame.evaluate(() => showOpenFilePicker === window.originalPicker), true);
    assert.equal(await page.evaluate(() => location.hash), '');
    assert.equal(await page.locator('#max-see-ads-btn').count(), 1);
    assert.equal(await frame.locator('#max-see-ads-btn').count(), 0);
    assert.equal(await frame.evaluate(() => window.uploaderClicks), 2);
    assert(logs.some((message) => message.includes('Waiting for its upload area.')));
    assert(logs.some((message) => message.includes('retrying (1/3)')));
    assert(logs.some((message) => message.includes('Portrait handoff sent to the trusted capsule frame.')));
    assert(logs.every((message) => !message.includes('MOCK_ONLY')));
    assert.deepEqual(errors, []);
    console.log('Cross-origin capsule: checked relay, child-realm upload, one Run click, hash cleanup and late uploader, menu retry, delayed single Next passed.');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
