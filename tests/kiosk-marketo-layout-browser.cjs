const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium } = require(path.join(path.dirname(fs.realpathSync(process.argv[2])), 'index.js'));
const addTestFixture = require('./kiosk-test-fixture.cjs');

const baseURL = process.env.KIOSK_BASE_URL || 'http://localhost:3017';
const fixtureOrigin = process.env.KIOSK_BASE_URL ? null : new URL(baseURL).origin;
const fields = ['FirstName', 'LastName', 'Email', 'Country'];

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 763, height: 1053 },
      { width: 834, height: 1038 },
      { width: 1920, height: 1080 },
    ]) {
      for (const appearance of ['light', 'dark']) {
        const context = await browser.newContext({ viewport });
        const submissions = [];
        await context.route('**/*', (route) => {
          const request = route.request();
          if (request.method() !== 'GET') {
            if (new URL(request.url()).hostname === 'engage.adobe.com') submissions.push(request.url());
            return route.abort();
          }
          return route.continue();
        });
        if (fixtureOrigin) await addTestFixture(context, fixtureOrigin);
        const page = await context.newPage();
        const errors = [];
        await page.goto(`${baseURL}/max2026.html`);
        await page.evaluate(async (theme) => {
          localStorage.setItem('glam-kiosk-lead-capture-v1', 'marketo');
          localStorage.setItem('glam-kiosk-appearance-v1', theme);
          const response = await fetch('/blocks/attendee-kiosk/access-gate.js');
          if (response.ok) {
            const { ACCESS_VERIFIER } = await import('/blocks/attendee-kiosk/access-gate.js');
            sessionStorage.setItem('glam-kiosk-access-v1', ACCESS_VERIFIER);
          }
        }, appearance);
        page.on('pageerror', (error) => errors.push(error.message));
        await page.reload();
        const wrapper = page.locator('.kiosk-marketo-form');
        await page.waitForFunction(() => {
          const node = document.querySelector('.kiosk-marketo-form');
          return node && !node.hasAttribute('aria-busy');
        }, null, { timeout: 40000 });
        await wrapper.locator('[name="FirstName"]').waitFor({ state: 'visible' });
        await page.waitForTimeout(1000);
        const names = await wrapper.locator('input:not([type="hidden"]), select, textarea')
          .evaluateAll((nodes) => nodes.filter((node) => node.getClientRects().length)
            .map((node) => node.name));
        fields.forEach((name) => assert(names.includes(name), `Missing visible ${name}`));
        const company = names.find((name) => ['Company', 'mktoFormsCompany'].includes(name));
        const shownFields = company ? [...fields.slice(0, 3), company, 'Country'] : fields;
        const dimensions = await page.evaluate((expected) => {
          const wrapperNode = document.querySelector('.kiosk-marketo-form');
          const content = wrapperNode.closest('.kiosk-welcome-content');
          const form = wrapperNode.querySelector('form');
          const rect = (node) => {
            const bounds = node.getBoundingClientRect();
            return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
          };
          const controls = expected.map((name) => {
            const input = form.querySelector(`[name="${name}"]`);
            const label = form.querySelector(`label[for="${input.id}"]`);
            return {
              name,
              ...rect(input),
              opacity: getComputedStyle(input).opacity,
              labelColor: label && getComputedStyle(label).color,
            };
          });
          return {
            form: rect(form),
            content: rect(content),
            formOpacity: getComputedStyle(form).opacity,
            formScrollWidth: form.scrollWidth,
            formClientWidth: form.clientWidth,
            contentScrollWidth: content.scrollWidth,
            contentClientWidth: content.clientWidth,
            pageScrollWidth: document.documentElement.scrollWidth,
            pageClientWidth: document.documentElement.clientWidth,
            controls,
            consent: rect(document.querySelector('.kiosk-consent')),
          };
        }, shownFields);
        assert.equal(dimensions.formOpacity, '1', 'Actual form must be painted');
        assert(dimensions.form.height > 100 && dimensions.form.height < 600, 'Form must not contain a giant blank region');
        assert(dimensions.formScrollWidth <= dimensions.formClientWidth + 1, 'Form must not scroll horizontally');
        assert(dimensions.contentScrollWidth <= dimensions.contentClientWidth + 1, 'Content must not scroll horizontally');
        assert(dimensions.pageScrollWidth <= dimensions.pageClientWidth + 1, 'Page must not scroll horizontally');
        assert(dimensions.controls[0].top - dimensions.form.top < 80, 'First field must start near top of form');
        assert(dimensions.consent.top - dimensions.controls.at(-1).bottom >= 0, 'Consent must not overlap the last field');
        assert(dimensions.consent.top - dimensions.controls.at(-1).bottom < 100, 'No large gap before consent');
        for (const [index, control] of dimensions.controls.entries()) {
          assert(control.width >= 180 && control.height >= 40, `${control.name} must be usable`);
          assert(control.left >= 0 && control.right <= viewport.width + 1, `${control.name} must fit the viewport`);
          assert.equal(control.opacity, '1');
          assert.equal(control.labelColor, appearance === 'dark' ? 'rgb(255, 255, 255)' : 'rgb(26, 26, 26)');
          if (index) {
            const gap = control.top - dimensions.controls[index - 1].bottom;
            assert(gap >= 0 && gap < 80, `Unexpected gap before ${control.name}`);
          }
          const field = wrapper.locator(`[name="${control.name}"]`);
          await field.scrollIntoViewIfNeeded();
          await field.click({ trial: true });
        }
        if (process.env.KIOSK_SCREENSHOT_DIR) {
          await page.screenshot({
            path: path.join(process.env.KIOSK_SCREENSHOT_DIR, `marketo-layout-${viewport.width}-${appearance}.png`),
          });
        }
        const submit = page.getByRole('button', { name: 'Submit', exact: true });
        assert(await submit.isDisabled(), 'Consent must gate native submission');
        await page.locator('.kiosk-consent input').check();
        assert(await submit.isEnabled());
        await wrapper.locator('[name="FirstName"]').fill('Test');
        await wrapper.locator('[name="LastName"]').fill('Visitor');
        await wrapper.locator('[name="Email"]').fill('visitor@example.invalid');
        if (company) await wrapper.locator(`[name="${company}"]`).fill('Example');
        assert(await page.evaluate(() => {
          const element = document.querySelector('.kiosk-marketo-form form');
          const form = window.MktoForms2.allForms()
            .find((item) => item.getFormElem()?.[0] === element);
          return form.validate();
        }), 'Native validation must accept filled visible fields');
        assert.deepEqual(submissions, [], 'No real lead may be submitted');
        assert.deepEqual(errors, []);
        console.log(`Real Marketo layout passed: ${viewport.width}x${viewport.height} ${appearance}`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exit(1); });
