const DOMAIN = 'https://engage.adobe.com';
const MUNCHKIN_ID = '360-KCI-804';
const BASE_FORM_ID = 2277;
const PROGRAM_FORM_ID = 4040;
const FIELDS = new Set(['FirstName', 'LastName', 'Email', 'Company', 'mktoFormsCompany', 'Country']);
let callbackSequence = 0;
let libraryPromise;

function library() {
  if (window.MktoForms2?.processForm) return Promise.resolve(window.MktoForms2);
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      script.remove();
      reject(new Error('Marketo library timed out.'));
    }, 15000);
    script.src = `${DOMAIN}/js/forms2/js/forms2.min.js`;
    script.onload = () => {
      clearTimeout(timer);
      if (window.MktoForms2?.processForm) resolve(window.MktoForms2);
      else reject(new Error('Marketo library is unavailable.'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new Error('Marketo library failed to load.'));
    };
    document.head.append(script);
  }).catch((error) => {
    libraryPromise = null;
    throw error;
  });
  return libraryPromise;
}

function formSpec(id, signal) {
  return new Promise((resolve, reject) => {
    callbackSequence += 1;
    const callback = `kioskMarketoCallback${Date.now()}_${callbackSequence}`;
    const script = document.createElement('script');
    let timer;
    let aborted;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', aborted);
      delete window[callback];
      script.remove();
    };
    aborted = () => {
      cleanup();
      reject(new DOMException('Form load cancelled.', 'AbortError'));
    };
    window[callback] = (spec) => {
      cleanup();
      if (!spec || spec.error || !Array.isArray(spec.rows) || Number(spec.Id) !== id) {
        reject(new Error('Marketo form configuration is invalid.'));
      } else resolve(spec);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error('Marketo form configuration could not be loaded.'));
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('Marketo form configuration timed out.'));
    }, 10000);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) { aborted(); return; }
    const url = new URL('/index.php/form/getForm', DOMAIN);
    url.searchParams.set('munchkinId', MUNCHKIN_ID);
    url.searchParams.set('form', String(id));
    url.searchParams.set('url', `${window.location.origin}${window.location.pathname}`);
    url.searchParams.set('callback', callback);
    script.src = url.href;
    document.head.append(script);
  });
}

function cleanFields(formElement) {
  formElement.querySelectorAll('.mktoFormRow').forEach((row) => {
    const fields = [...row.querySelectorAll('input:not([type="hidden"]), select, textarea')];
    if (fields.some((field) => FIELDS.has(field.name))) return;
    row.style.setProperty('display', 'none', 'important');
    row.classList.remove('mktoRequiredField');
    fields.forEach((field) => {
      field.removeAttribute('required');
      field.removeAttribute('aria-required');
      field.classList.remove('mktoRequired');
    });
  });
}

function relaxHiddenRequirements(value) {
  if (!value || typeof value !== 'object') return;
  if (typeof value.Name === 'string' && !FIELDS.has(value.Name)) value.IsRequired = false;
  Object.values(value).forEach(relaxHiddenRequirements);
}

export default async function mountMarketo(container, {
  eventId, signal, consent, onSubmitting, onSuccess,
}) {
  const [forms, spec] = await Promise.all([
    library(), formSpec(BASE_FORM_ID, signal), formSpec(PROGRAM_FORM_ID, signal),
  ]);
  if (signal.aborted) throw new DOMException('Form load cancelled.', 'AbortError');
  spec.munchkinId = MUNCHKIN_ID;
  spec.Id = PROGRAM_FORM_ID;
  spec.Vid = PROGRAM_FORM_ID;
  spec.name = `mktoForm_${PROGRAM_FORM_ID}`;
  spec.action = `${DOMAIN}/index.php/leadCapture/save2`;
  relaxHiddenRequirements(spec.rows);
  if (spec.ProcessOptions?.knownLead) spec.ProcessOptions.knownLead.template = '';
  window.mcz_marketoForm_pref = {
    form: {
      id: PROGRAM_FORM_ID,
      template: 'form_4040',
      known_visitor: false,
      mktoInstantInquiry: { event_form: false },
      success: { type: 'message', content: '' },
    },
    profile: {},
    program: { poi: 'LOREAL' },
  };
  if (!Array.isArray(window.templateRules)) window.templateRules = [];
  if (!window.templateRules.some((rule) => Object.hasOwn(rule, 'form_4040'))) {
    window.templateRules.push({
      form_4040: {
        purpose: ['event_form'],
        field_visibility: Object.fromEntries(Object.entries({
          name: 'required',
          phone: 'hidden',
          company: 'hidden',
          website: 'hidden',
          state: 'hidden',
          postcode: 'hidden',
          company_size: 'hidden',
          demo: 'hidden',
          comments: 'hidden',
        }).map(([key, value]) => [key, [value]])),
        field_filters: Object.fromEntries(
          ['functional_area', 'products', 'industry', 'job_role'].map((key) => [key, ['hidden']]),
        ),
        program_id: '4040',
        known_visitor: false,
        auto_success: false,
      },
    });
  }
  if (!document.getElementById('mktoStyleLoadedSentinel')) {
    const style = document.createElement('style');
    style.id = 'mktoStyleLoadedSentinel';
    style.textContent = '#mktoStyleLoaded{color:#123456!important;background-color:#123456!important;border-top-color:#123456!important}';
    document.head.append(style);
  }
  const formElement = document.createElement('form');
  formElement.id = `mktoForm_${PROGRAM_FORM_ID}`;
  container.append(formElement);
  forms.setOptions({ rootUrl: DOMAIN, baseUrl: `${DOMAIN}/js/forms2/` });
  const form = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Marketo form rendering timed out.')), 10000);
    forms.processForm(spec, (instance) => {
      clearTimeout(timer);
      if (!instance) reject(new Error('Marketo form is unavailable.'));
      else resolve(instance);
    });
  });
  if (signal.aborted) throw new DOMException('Form load cancelled.', 'AbortError');
  form.addHiddenFields({ munchkinId: MUNCHKIN_ID });
  let consentBlocked = false;
  form.onValidate(() => {
    if (!consent() || signal.aborted) {
      form.submittable(false);
      consentBlocked = true;
    } else if (consentBlocked) {
      form.submittable(true);
      consentBlocked = false;
    }
  });
  form.onSubmit(() => {
    if (!signal.aborted) onSubmitting();
  });
  form.onSuccess(() => {
    if (!signal.aborted && consent()) onSuccess(form.vals());
    return false;
  });
  form.render();
  const rendered = form.getFormElem()?.[0];
  if (!rendered || !container.contains(rendered)) throw new Error('Marketo form was not rendered.');
  const attribution = { pmOnsiteCampaignId: eventId || '', pmRetouchCampaignId: 'LOREAL' };
  const missing = Object.fromEntries(Object.entries(attribution)
    .filter(([name]) => !rendered.querySelector(`[name="${name}"]`)));
  if (Object.keys(missing).length) form.addHiddenFields(missing);
  form.setValuesCoerced(attribution);
  const clearPrefill = () => {
    const country = rendered.querySelector('[name="Country"]');
    const unitedStates = [...(country?.options || [])]
      .find((option) => option.value === 'US' || option.textContent.trim() === 'United States');
    form.vals({
      FirstName: '',
      LastName: '',
      Email: '',
      Company: '',
      mktoFormsCompany: '',
      Country: unitedStates?.value || 'United States',
    });
    cleanFields(rendered);
  };
  clearPrefill();
  await new Promise((resolve) => { setTimeout(resolve, 300); });
  if (signal.aborted) throw new DOMException('Form load cancelled.', 'AbortError');
  clearPrefill();
  return {
    submit() {
      const native = rendered.querySelector('.mktoButtonRow button[type="submit"], .mktoButtonRow input[type="submit"], .mktoButtonRow button:not([type])');
      if (!native) throw new Error('Marketo submit button is unavailable.');
      native.click();
    },
  };
}
