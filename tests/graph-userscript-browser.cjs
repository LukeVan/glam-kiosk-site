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
    await page.evaluate(async ({
      publicFixture, badDigest, currentWidget, blockedWidget, replacementWidget, runControl,
      uploadNewOnly, capsuleUI,
    }) => {
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
      if (replacementWidget) {
        upload.innerHTML = capsuleUI
          ? '<img alt="Existing image"><sp-action-button aria-label="Upload new image" role="button"><sp-icon-upload slot="icon"></sp-icon-upload>Upload new</sp-action-button><button>Reset</button>'
          : '<img alt="Existing image"><sp-button role="button">Upload new</sp-button><button>Reset</button>';
        const control = upload.querySelector('sp-button, sp-action-button');
        control.attachShadow({ mode: 'open' }).innerHTML = '<button><slot></slot></button>';
        if (blockedWidget === 'replacement-ambiguous') {
          upload.append(control.cloneNode(true));
        }
        const other = document.createElement('pg-node');
        other.attachShadow({ mode: 'open' }).innerHTML = '<input value="Other image"><button>Upload new</button>';
        other.shadowRoot.querySelector('button').onclick = () => { window.wrongNodeClicked = true; };
        document.body.prepend(other);
      }
      if (capsuleUI) {
        const panel = document.createElement('section');
        panel.setAttribute('aria-label', 'Input');
        const field = document.createElement('div');
        const label = document.createElement('label');
        label.textContent = 'Input Image';
        field.append(label, list);
        panel.append(field);
        node.replaceWith(panel);
        const other = document.querySelector('pg-node');
        if (other) other.replaceWith(Object.assign(document.createElement('button'), {
          textContent: 'Upload new',
          onclick: () => { window.wrongNodeClicked = true; },
        }));
      }
      if (blockedWidget === 'busy') upload.firstElementChild.setAttribute('aria-busy', 'true');
      if (blockedWidget === 'populated') upload.firstElementChild.append(document.createElement('img'));
      if (blockedWidget === 'ambiguous') upload.append(upload.firstElementChild.cloneNode(true));
      upload.querySelector(replacementWidget ? 'sp-button, sp-action-button' : '.dropzone').onclick = () => {
        const doc = upload.ownerDocument;
        if (doc.querySelector('#device')) return;
        const device = doc.createElement('button');
        device.id = 'device';
        device.textContent = 'Your device';
        device.onclick = async () => {
          const [handle] = await doc.defaultView.showOpenFilePicker();
          const file = await handle.getFile();
          window.uploaded = {
            name: file.name, type: file.type, size: file.size,
            pageFile: file instanceof doc.defaultView.File,
          };
          const toolbar = document.createElement(capsuleUI ? 'capsule-run-controls' : 'graph-run-toolbar');
          toolbar.setAttribute('role', 'toolbar');
          toolbar.setAttribute('aria-label', 'Graph run actions');
          doc.body.append(toolbar);
          const toolbarRoot = toolbar.attachShadow({ mode: 'open' });
          const run = document.createElement('sp-button');
          run.setAttribute('role', 'button');
          run.setAttribute('aria-label', 'Run Graph');
          run.attachShadow({ mode: 'open' }).innerHTML = '<button><slot></slot></button>';
          run.textContent = capsuleUI ? 'Run' : 'Run all';
          run.disabled = true;
          window.runCount = 0;
          run.onclick = () => {
            window.runCount += 1;
            window.ranBeforeReady = !window.imageReady;
          };
          toolbarRoot.append(run);
          if (capsuleUI) {
            const unrelatedRun = document.createElement('button');
            unrelatedRun.textContent = 'Run';
            unrelatedRun.onclick = () => { window.wrongRunClicked = true; };
            document.body.prepend(unrelatedRun);
          }
          if (runControl === 'ambiguous') toolbarRoot.append(run.cloneNode(true));
          const progress = document.createElement('div');
          progress.setAttribute('aria-busy', 'true');
          upload.append(progress);
          setTimeout(async () => {
            const preview = document.createElement('img');
            preview.src = URL.createObjectURL(file);
            upload.append(preview);
            await preview.decode();
            if (uploadNewOnly) {
              preview.remove();
              const replace = document.createElement('button');
              replace.textContent = 'Upload new';
              upload.append(replace);
            }
            window.imageReady = true;
            progress.setAttribute('aria-busy', 'false');
            // Keep Run all disabled briefly after the image itself is ready.
            if (runControl !== 'disabled') setTimeout(() => { run.disabled = false; }, 600);
          }, 900);
        };
        doc.body.append(device);
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
      replacementWidget: Boolean(process.env.REPLACEMENT_GRAPH_WIDGET)
        || !process.env.CURRENT_GRAPH_WIDGET,
      runControl: process.env.RUN_CONTROL || '',
      uploadNewOnly: Boolean(process.env.UPLOAD_NEW_READY),
      capsuleUI: Boolean(process.env.CAPSULE_GRAPH_UI),
    });
    if (process.env.CAPSULE_GRAPH_FRAME) {
      await page.evaluate(async () => {
        const host = document.createElement('graph-studio-capsule-host');
        document.body.append(host);
        const root = host.attachShadow({ mode: 'open' });
        const frame = document.createElement('iframe');
        frame.style.cssText = 'width:900px;height:700px';
        const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
        frame.srcdoc = '<!doctype html><html><body></body></html>';
        root.append(frame);
        await loaded;
        frame.contentWindow.showOpenFilePicker = window.originalPicker;
        frame.contentDocument.body.append(document.querySelector('section[aria-label="Input"]'));
        window.capsuleFrame = frame;
      });
    }
    const script = fs.readFileSync(process.env.GRAPH_USERSCRIPT || 'tools/graph-auto-load.user.js', 'utf8');
    await page.addScriptTag({ content: script });
    if (process.env.BLOCKED_GRAPH_WIDGET) {
      await page.waitForTimeout(1800);
      assert(logs.some((message) => message.includes('Waiting for its upload area.')));
      assert.equal(await page.evaluate(() => Boolean(window.uploaded)), false);
      assert.equal(await page.evaluate(() => showOpenFilePicker === window.originalPicker), true);
      assert.equal(await page.locator('#device').count(), 0);
      assert.equal(await page.evaluate(() => Boolean(window.wrongNodeClicked)), false);
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
    if (script.includes('const autoRun = true;') || process.env.CAPSULE_GRAPH_UI) {
      assert.equal(await page.evaluate(() => window.runCount), 0);
      if (process.env.RUN_CONTROL) {
        await page.waitForFunction(() => window.imageReady);
        await page.waitForTimeout(1500);
        assert.equal(await page.evaluate(() => window.runCount), 0);
        if (process.env.RUN_CONTROL === 'ambiguous') {
          assert(logs.some((message) => message.includes('processing was not started.')));
        }
        console.log(`Run all ${process.env.RUN_CONTROL} control does not start processing.`);
        return;
      }
      await page.waitForFunction(() => window.runCount === 1);
      await page.waitForTimeout(700);
      assert.equal(await page.evaluate(() => window.runCount), 1);
      assert.equal(await page.evaluate(() => window.ranBeforeReady), false);
      assert(logs.some((message) => message.includes(process.env.CAPSULE_GRAPH_UI ? 'Run clicked.' : 'Run all clicked.')));
      assert.equal(await page.evaluate(() => Boolean(window.wrongRunClicked)), false);
    } else {
      await page.waitForFunction(() => window.imageReady);
      await page.waitForTimeout(900);
      assert.equal(await page.evaluate(() => window.runCount), 0);
    }
    const result = await page.evaluate(() => ({
      uploaded: window.uploaded,
      downloads: window.downloads,
      pickerRestored: showOpenFilePicker === window.originalPicker
        && (!window.capsuleFrame || window.capsuleFrame.contentWindow.showOpenFilePicker === window.originalPicker),
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
    assert.equal(await page.evaluate(() => Boolean(window.wrongNodeClicked)), false);
    assert.equal(result.dialogClosed, true);
    assert.equal(result.toastHidden, true);
    assert.equal(result.ordinaryVisible, true);
    await page.waitForSelector('#max-see-ads-btn', { timeout: 8000 });
    assert.equal(await page.locator('#max-see-ads-btn').innerText(), 'Scale Your Ads');
    assert.deepEqual(await page.locator('#max-see-ads-btn').evaluate((button) => {
      const style = getComputedStyle(button);
      return [style.fontSize, style.minWidth, style.minHeight];
    }), ['24px', '168px', '64px']);
    assert.equal(await page.locator('#max-open-graph-btn').innerText(), 'Open Graph');
    const buttonsOverlap = await page.evaluate(() => {
      const a = document.querySelector('#max-see-ads-btn').getBoundingClientRect();
      const b = document.querySelector('#max-open-graph-btn').getBoundingClientRect();
      return b.right > a.left;
    });
    assert.equal(buttonsOverlap, false);
    const opened = await page.evaluate(() => {
      const calls = [];
      window.open = (...args) => { calls.push(args); return null; };
      document.querySelector('#max-open-graph-btn').click();
      return calls;
    });
    assert.equal(opened.length, 1);
    const openedUrl = new URL(opened[0][0]);
    assert.equal(openedUrl.origin + openedUrl.pathname, 'https://firefly.adobe.com/graph/edit/id/urn:aaid:sc:US:08944592-9145-526f-8b43-75400178e5ee');
    assert(new URLSearchParams(openedUrl.hash.slice(1)).getAll('portraitUrl').length > 0);
    assert.equal(opened[0][2], 'noopener');
    assert(logs.some((message) => message.includes('Portrait supplied to Graph file picker.')));
    assert(logs.every((message) => !message.includes('MOCK_ONLY')));
    assert.deepEqual(errors, []);
    console.log('Graph userscript fixture: shadow-DOM node lookup, PNG download, page-realm File, one-use picker restoration, return button and v1.8 notice suppression passed.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
