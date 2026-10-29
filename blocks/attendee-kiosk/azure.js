import {
  SETTINGS_KEY, loadSettings, listBlobs, blobURL,
} from '../../scripts/kiosk-settings.js';
import { readPrintStatus, submitPrintRequest, submitPreparation } from './fulfillment.js';
import { completedPortraits } from './completed.js';
import { readBannerManifest, BANNER_BRANDS } from './banner-assets.js';
import { readGraphInput } from './graph-input.js';
import { readDemoCatalog } from './demo-catalog.js';

const EXTENSIONS = /\.(jpg|jpeg|png|webp)$/i;
const BRANDS = [
  ['1-larocheposay', 'La Roche-Posay'],
  ['2-lorealprofessionnel', 'L’Oréal Professionnel'],
  ['3-yslbeauty', 'YSL Beauty'],
  ['4-lorealparis', 'L’Oréal Paris'],
];

function imageName(name, prefix) {
  const file = name.slice(prefix.length);
  return file && !file.includes('/') && !file.startsWith('.') && EXTENSIONS.test(file);
}

function stem(name) {
  return name.replace(EXTENSIONS, '').replace(/[^\p{L}\p{N}_.-]/gu, '_');
}

async function portraitID(name) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(name));
  return `azure_${[...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export default function createAzureAPI(demo, storage, fetcher = fetch) {
  let eventId;
  let setupError;
  let intakeEnabled = false;
  try {
    if (!storage.getItem(SETTINGS_KEY)) return null;
    const saved = loadSettings(storage);
    eventId = saved.eventId;
    intakeEnabled = saved.formType === 'marketo';
  } catch (error) {
    setupError = error.message;
  }
  let warning = '';
  let catalog;
  function settings() {
    if (setupError) throw new Error(setupError);
    const saved = loadSettings(storage);
    if (!saved) throw new Error('Booth settings were cleared. Restart the kiosk page.');
    if (saved.eventId !== eventId) throw new Error('The booth event changed. Restart the kiosk page.');
    return saved;
  }
  async function demos(signal, refresh = false) {
    if (refresh || catalog === undefined) {
      catalog = await readDemoCatalog(settings(), signal, fetcher);
    }
    if (catalog === null) return demo.portraits(signal);
    return catalog.people.map((person) => ({
      id: person.id,
      label: person.label,
      thumbnailUrl: person.profile.portrait.url,
      demo: true,
      demoCatalog: true,
      templateSetId: catalog.templateSetId,
      demoVersion: person.profile.version,
    }));
  }
  async function demoProfile(id, signal) {
    await demos(signal);
    if (catalog === null) return null;
    const person = catalog.people.find((item) => item.id === id);
    if (!person) throw new Error('This demo is no longer published for the selected Template Set.');
    return person.profile;
  }
  async function azurePortraits(signal) {
    const saved = settings();
    const prefix = `${saved.eventId}/portraits/pending/`;
    const blobs = await listBlobs(saved.containerSAS, { prefix, fetcher, signal });
    const portraits = await Promise.all(blobs.filter(({ name }) => (
      imageName(name, prefix) && !name.slice(prefix.length).replace(EXTENSIONS, '').startsWith('demo_')
    )).map(async ({ name, lastModified }) => {
      if (!Number.isFinite(Date.parse(lastModified))) throw new Error('Azure portrait timestamp is invalid.');
      return {
        id: await portraitID(name),
        label: 'Event portrait',
        thumbnailUrl: blobURL(saved.containerSAS, name),
        createdAt: new Date(lastModified).toISOString(),
        stem: stem(name.slice(prefix.length)),
        demo: false,
      };
    }));
    if (new Set(portraits.map((item) => item.stem)).size !== portraits.length) {
      throw new Error('Azure inputs contain duplicate portrait stems. Ask booth staff to resolve them.');
    }
    return portraits.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }
  // The orchestrator publishes an empty marker per portrait once any kiosk submits its ad.
  async function sharedUsedPortraits(signal) {
    const saved = settings();
    const prefix = `${saved.eventId}/portraits/used/`;
    const blobs = await listBlobs(saved.containerSAS, { prefix, fetcher, signal });
    return blobs.map(({ name }) => name.slice(prefix.length))
      .filter((id) => /^azure_[0-9a-f]{64}$/.test(id));
  }
  async function selectedPortrait(id, signal) {
    if (id.startsWith('demo_')) return (await demos(signal)).find((item) => item.id === id);
    const selected = (await azurePortraits(signal)).find((item) => item.id === id);
    if (!selected) throw new Error('The selected Azure portrait is no longer available. Choose another photo.');
    return selected;
  }
  return {
    source: 'azure',
    eventId: eventId || 'invalid-settings',
    intakeEnabled,
    settings,
    async prepare(request, signal) {
      await submitPreparation(request, settings(), signal, fetcher);
    },
    async graphInput(id, signal) {
      return readGraphInput(id, settings(), signal, fetcher);
    },
    async bannerResults(id, selectedAdId, signal) {
      const brand = BANNER_BRANDS.find((item, index) => selectedAdId === `${id}_${index + 1}`);
      if (!brand) throw new Error('Banner results require the selected portrait’s ad.');
      if (id.startsWith('demo_')) {
        const profile = await demoProfile(id, signal);
        if (!profile) throw new Error('Legacy demo variations are static samples.');
        return { status: 'ready', assets: profile.variations[brand] };
      }
      return readBannerManifest(id, settings(), signal, fetcher, brand);
    },
    async demoAssets(id, selectedAdId, signal) {
      if (!id.startsWith('demo_')) throw new Error('Demo assets require a demo identity.');
      const profile = await demoProfile(id, signal);
      if (!profile) return null;
      const brand = BANNER_BRANDS.find((item, index) => selectedAdId === `${id}_${index + 1}`);
      if (!brand) throw new Error('Demo assets require the selected demo’s ad.');
      return { cutout: profile.cutouts[brand], printPreview: profile.printPreviews[brand] };
    },
    async demoCutouts(id, signal) {
      const profile = await demoProfile(id, signal);
      return profile ? BANNER_BRANDS.map((brand, index) => ({
        ...profile.cutouts[brand], label: BRANDS[index][1],
      })) : [];
    },
    async printStatus(request, signal) {
      return readPrintStatus(request, settings(), signal, fetcher);
    },
    get warning() { return warning; },
    selectedPortrait,
    async portraits(signal) {
      const samples = (await demos(signal, true)).map((item) => ({ ...item, demo: true }));
      const showCompleted = settings().showCompletedPortraits;
      const hidden = showCompleted ? [] : completedPortraits(storage, eventId);
      try {
        const [portraits, used] = await Promise.all([
          azurePortraits(signal),
          showCompleted ? [] : sharedUsedPortraits(signal),
        ]);
        hidden.push(...used);
        warning = '';
        return [...portraits.filter((item) => !hidden.includes(item.id)), ...samples];
      } catch (error) {
        if (signal?.aborted) throw error;
        warning = error.message;
        return samples;
      }
    },
    async manifest(id, signal) {
      if (id.startsWith('demo_')) {
        const profile = await demoProfile(id, signal);
        if (!profile) return demo.manifest(id, signal);
        return {
          portraitId: id,
          status: 'ready',
          demoCatalog: true,
          ads: BANNER_BRANDS.map((brand, index) => ({
            id: `${id}_${index + 1}`, label: BRANDS[index][1], url: profile.ads[brand].url,
          })),
          banners: [],
        };
      }
      const selected = await selectedPortrait(id, signal);
      const saved = settings();
      const prefix = `${saved.eventId}/4-Output/${selected.stem}/`;
      const blobs = await listBlobs(saved.containerSAS, { prefix, fetcher, signal });
      const names = new Set(blobs.map((item) => item.name));
      const ads = [];
      BRANDS.forEach(([key, label], index) => {
        const matches = blobs.filter(({ name }) => (
          imageName(name, prefix) && name.slice(prefix.length).toLowerCase().includes(key)
        ));
        if (matches.length > 1) throw new Error('Multiple Azure ads match one brand. Ask booth staff to resolve them.');
        if (matches.length) {
          ads.push({
            id: `${id}_${index + 1}`,
            label,
            url: blobURL(saved.containerSAS, matches[0].name),
          });
        }
      });
      let status = 'pending';
      if (names.has(`${prefix}.hub-all-fallback`)) status = 'failed';
      else if (ads.length === 4) status = 'ready';
      else if (names.has(`${prefix}.hub-processed`)) status = 'partial';
      return {
        portraitId: id, status, ads, banners: [],
      };
    },
    async resume(state, signal) {
      if (state.portraitId.startsWith('demo_')) return demo.resume(state, signal);
      settings();
      return undefined;
    },
    async select(state, signal) {
      if (state.portraitId.startsWith('demo_')) return demo.select(state, signal);
      const manifest = await this.manifest(state.portraitId, signal);
      if (manifest.status !== 'ready' || !manifest.ads.some((ad) => ad.id === state.selectedAdId)) {
        throw new Error('The selected Azure ad is not ready. Refresh assets or choose a demo portrait.');
      }
      if (!state.printRequest) throw new Error('The print request is missing. Confirm the ad selection again.');
      await submitPrintRequest(state.printRequest, settings(), signal, fetcher);
      return undefined;
    },
  };
}
