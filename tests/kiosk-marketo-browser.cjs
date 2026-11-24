const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));

const mockLibrary = `
window.__marketo = { submissions: 0, forms: [], options: null };
window.MktoForms2 = {
  setOptions(value) { window.__marketo.options = value; },
  processForm(spec, done) {
    const element = document.getElementById('mktoForm_' + spec.Id);
    let validate = () => {}, submit = () => {}, success = () => {}, allowed = true;
    const instance = {
      spec,
      addHiddenFields(values) {
        Object.entries(values).forEach(([name, value]) => {
          let field = element.querySelector('[name="' + name + '"]');
          if (!field) { field = document.createElement('input'); field.type = 'hidden'; field.name = name; element.append(field); }
          field.value = value;
        });
      },
      setValuesCoerced(values) { this.vals(values); },
      vals(values) {
        if (values) Object.entries(values).forEach(([name, value]) => {
          const field = element.querySelector('[name="' + name + '"]'); if (field) field.value = value;
        });
        return Object.fromEntries([...element.querySelectorAll('input, select')].map((field) => [field.name, field.value]));
      },
      getFormElem() { return [element]; },
      onValidate(fn) { validate = fn; }, onSubmit(fn) { submit = fn; }, onSuccess(fn) { success = fn; },
      submittable(value) { allowed = value; },
      render() {
        for (const name of ['FirstName', 'LastName', 'Email', 'Company', 'Country', 'Phone']) {
          const row = document.createElement('div'); row.className = 'mktoFormRow';
          const label = document.createElement('label'); label.className = 'mktoLabel'; label.textContent = name;
          const field = document.createElement('input'); field.className = 'mktoField'; field.name = name;
          field.value = 'Previously saved attendee'; field.required = true; label.append(field); row.append(label); element.append(row);
        }
        const row = document.createElement('div'); row.className = 'mktoButtonRow';
        const button = document.createElement('button'); button.type = 'submit'; row.append(button); element.append(row);
        element.className = 'mktoForm';
        element.addEventListener('submit', (event) => {
          event.preventDefault(); validate(true);
          if (allowed) { window.__marketo.submissions += 1; submit(); }
        });
        setTimeout(() => { element.querySelector('[name="FirstName"]').value = 'Late cookie prefill'; }, 100);
      },
      succeed() { return success(this.vals()); },
    };
    window.__marketo.forms.push(instance);
    done(instance);
  },
};
`;

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const requests = [];
    let failProgram = false;
    await context.route('https://engage.adobe.com/**', (route) => {
      const request = route.request();
      const url = new URL(request.url());
      requests.push({ method: request.method(), pathname: url.pathname });
      assert.equal(request.method(), 'GET', 'Never submit real leads');
      if (url.pathname === '/js/forms2/js/forms2.min.js') {
        return route.fulfill({ contentType: 'application/javascript', body: mockLibrary });
      }
      if (url.pathname === '/index.php/form/getForm') {
        const id = Number(url.searchParams.get('form'));
        if (failProgram && id === 4040) return route.abort();
        const callback = url.searchParams.get('callback');
        return route.fulfill({
          contentType: 'application/javascript',
          body: `${callback}(${JSON.stringify({
            Id: id,
            rows: [[{ Name: 'mktoFormsJobTitle', IsRequired: true }, { Name: 'Email', IsRequired: true }]],
            ProcessOptions: { knownLead: { template: 'prefill' } },
          })});`,
        });
      }
      return route.abort();
    });
    await context.route('https://ffservices24.blob.core.windows.net/**', (route) => route.abort());
    await context.route('**/drafts/kiosk-settings.html', (route) => route.fulfill({
      contentType: 'text/html',
      body: fs.readFileSync('drafts/kiosk-settings.html', 'utf8')
        .replace('<body>', '<body><header></header>')
        .replace('</body>', '<footer></footer></body>'),
    }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.stack));

    await page.goto('http://localhost:3017/drafts/kiosk-settings.html');
    const capture = page.getByLabel('Lead capture', { exact: true });
    await capture.selectOption('marketo');
    await page.getByText('Lead capture setting saved on this browser.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-lead-capture-v1')), 'marketo');
    assert.equal(await page.evaluate(() => localStorage.getItem('glam-kiosk-booth-v1')), null);
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    const wrapper = page.locator('.kiosk-marketo-form');
    await wrapper.locator('[name="FirstName"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.kiosk-marketo-form').hasAttribute('aria-busy'));
    for (const name of ['FirstName', 'LastName', 'Email', 'Company']) {
      assert.equal(await wrapper.locator(`[name="${name}"]`).inputValue(), '', `${name} prefill cleared`);
    }
    assert.equal(await wrapper.locator('[name="Country"]').inputValue(), 'United States');
    assert.equal(await wrapper.locator('[name="Phone"]').isVisible(), false);
    assert.equal(await wrapper.locator('[name="Phone"]').getAttribute('required'), null);
    const first = await page.evaluate(() => ({
      spec: window.__marketo.forms[0].spec,
      values: window.__marketo.forms[0].vals(),
      pref: window.mcz_marketoForm_pref,
    }));
    assert.equal(first.spec.Id, 4040);
    assert.equal(first.spec.Vid, 4040);
    assert.equal(first.spec.action, 'https://engage.adobe.com/index.php/leadCapture/save2');
    assert.equal(first.spec.ProcessOptions.knownLead.template, '');
    assert.equal(first.spec.rows[0][0].IsRequired, false);
    assert.equal(first.spec.rows[0][1].IsRequired, true);
    assert.equal(first.values.pmOnsiteCampaignId, '');
    assert.equal(first.values.pmRetouchCampaignId, 'LOREAL');
    assert.equal(first.pref.program.poi, 'LOREAL');
    assert.equal(first.pref.form.template, 'form_4040');
    const button = page.getByRole('button', { name: 'Submit', exact: true });
    assert.equal(await button.isDisabled(), true);
    for (const [name, value] of Object.entries({
      FirstName: 'Test', LastName: 'Visitor', Email: 'test@example.invalid',
      Company: 'Example', Country: 'Canada',
    })) await wrapper.locator(`[name="${name}"]`).fill(value);
    await wrapper.locator('[name="Email"]').press('Enter');
    assert.equal(await page.evaluate(() => window.__marketo.submissions), 0, 'Enter must not bypass consent');
    await page.locator('.kiosk-consent input').check();
    assert.equal(await button.isEnabled(), true);
    await page.evaluate(() => {
      const original = window.setTimeout;
      window.setTimeout = (handler, delay, ...args) => original(handler, delay === 30000 ? 10 : delay, ...args);
    });
    await button.click();
    assert.equal(await page.evaluate(() => window.__marketo.submissions), 1);
    assert.equal(await button.isDisabled(), true);
    await page.getByText('Submission could not be confirmed.', { exact: false }).waitFor();
    assert.equal(await page.locator('.kiosk-panel-portraits').count(), 0, 'No success without callback');
    await page.evaluate(() => window.__marketo.forms[0].succeed());
    await page.locator('.kiosk-portrait-grid .kiosk-card').first().click();
    await page.locator('.kiosk-portrait-actions .kiosk-primary-action').click();
    await page.locator('.kiosk-name input').waitFor();
    assert.equal(await page.locator('.kiosk-name input').inputValue(), 'Test Visitor');
    const stored = await page.evaluate(() => sessionStorage.getItem('glam-attendee-v1:offline-demo'));
    assert(!stored.includes('test@example.invalid') && !stored.includes('Example'), 'Only attendee name persists');
    await page.locator('.kiosk-badge > button').click();
    await page.locator('.kiosk-badge > button').first().click();
    await page.locator('.kiosk-marketo-form [name="FirstName"]').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('.kiosk-marketo-form').hasAttribute('aria-busy'));
    assert.equal(await page.locator('.kiosk-marketo-form [name="FirstName"]').inputValue(), '');

    const old = await page.evaluate(() => window.__marketo.forms.length - 1);
    await page.locator('.kiosk-badge > button').click();
    await page.locator('.kiosk-badge > button').first().click();
    await page.evaluate((index) => window.__marketo.forms[index].succeed(), old);
    assert.equal(await page.locator('.kiosk-panel-portraits').count(), 0, 'Stale success cannot advance next attendee');

    failProgram = true;
    await page.reload();
    await page.getByRole('alert').filter({ hasText: 'Marketo integration is unavailable' }).waitFor();
    await page.locator('.kiosk-consent input').check();
    assert.equal(await page.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);

    await page.goto('http://localhost:3017/drafts/kiosk-settings.html');
    await capture.selectOption('none');
    await page.goto('http://localhost:3017/drafts/attendee-kiosk.html');
    await page.locator('.kiosk-welcome-content').waitFor();
    assert.equal(await page.locator('.kiosk-marketo-form').count(), 0);
    await page.locator('.kiosk-consent input').check();
    await page.getByRole('button', { name: 'Start your creative workflow' }).click();
    await page.locator('.kiosk-portrait-grid').waitFor();
    failProgram = false;
    await page.evaluate(async () => {
      const { saveSettings } = await import('/scripts/kiosk-settings.js');
      saveSettings(localStorage, {
        version: 1,
        containerSAS: `https://ffservices24.blob.core.windows.net/mock-assets?sv=2023-11-03&sr=c&sp=rl&se=${encodeURIComponent(new Date(Date.now() + 86400000).toISOString())}&sig=MOCK_ONLY`,
        eventId: 'EventABC',
        activationProfile: 'max',
        formType: 'marketo',
      });
      localStorage.removeItem('glam-kiosk-lead-capture-v1');
      sessionStorage.clear();
    });
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('.kiosk-marketo-form')?.hasAttribute('aria-busy')
      && !!document.querySelector('.kiosk-marketo-form [name="FirstName"]'));
    assert.equal(await page.evaluate(() => window.__marketo.forms[0].vals().pmOnsiteCampaignId), 'EventABC');
    assert.equal(await page.evaluate(() => window.__marketo.forms[0].vals().pmRetouchCampaignId), 'LOREAL');
    assert(requests.every((request) => request.method === 'GET'));
    assert.deepEqual(errors, []);
    console.log('Marketo: independent setting, offline opt-in/out, mocked base/program attribution, no prefill leakage, consent, confirmed success, name continuity, reset isolation and unavailable form passed.');
    await context.close();
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exit(1); });
