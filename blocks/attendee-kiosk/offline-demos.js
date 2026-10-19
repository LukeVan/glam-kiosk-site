import { readOfflineDemoCatalog } from './demo-catalog.js';
import { BANNER_BRANDS } from './banner-assets.js';

const LABELS = ['La Roche-Posay', 'L’Oréal Professionnel', 'YSL Beauty', 'L’Oréal Paris'];

export default function createOfflineDemoAPI(fetcher = fetch) {
  let catalog;
  async function load(signal, refresh = false) {
    if (!catalog || refresh) catalog = await readOfflineDemoCatalog(signal, fetcher);
    return catalog;
  }
  async function profile(id, signal) {
    const data = await load(signal);
    const person = data.people.find((item) => item.id === id);
    if (!person) throw new Error('This offline demo is no longer available. Choose another demo.');
    return person.profile;
  }
  function brandFor(id, selectedAdId) {
    const brand = BANNER_BRANDS.find((item, index) => selectedAdId === `${id}_${index + 1}`);
    if (!brand) throw new Error('Offline demo assets require the selected demo’s ad.');
    return brand;
  }
  function portraits(data) {
    return data.people.map((person) => ({
      id: person.id,
      label: person.label,
      thumbnailUrl: person.profile.portrait.url,
      demo: true,
      demoCatalog: true,
      templateSetId: data.templateSetId,
      demoVersion: person.profile.version,
    }));
  }
  return {
    source: 'offline-demo',
    async portraits(signal) {
      return portraits(await load(signal, true));
    },
    async selectedPortrait(id, signal) {
      return portraits(await load(signal)).find((person) => person.id === id);
    },
    async manifest(id, signal) {
      const assets = await profile(id, signal);
      return {
        portraitId: id,
        status: 'ready',
        demoCatalog: true,
        ads: BANNER_BRANDS.map((brand, index) => ({
          id: `${id}_${index + 1}`, label: LABELS[index], url: assets.ads[brand].url,
        })),
        banners: [],
      };
    },
    async bannerResults(id, selectedAdId, signal) {
      const assets = await profile(id, signal);
      return { status: 'ready', assets: assets.variations[brandFor(id, selectedAdId)] };
    },
    async demoAssets(id, selectedAdId, signal) {
      const assets = await profile(id, signal);
      const brand = brandFor(id, selectedAdId);
      return { cutout: assets.cutouts[brand], printPreview: assets.printPreviews[brand] };
    },
    async resume(state, signal) {
      await profile(state.portraitId, signal);
    },
    async select(state, signal) {
      await profile(state.portraitId, signal);
      brandFor(state.portraitId, state.selectedAdId);
    },
  };
}
