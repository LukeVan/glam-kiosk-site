import { BANNER_BRANDS } from './banner-assets.js';

export const DEMO_PEOPLE = [
  { slug: 'tina', name: 'Tina', id: 'demo_dd5af9bb1ce34c41bcc1a45723d6c343' },
  { slug: 'sarah', name: 'Sarah', id: 'demo_abbf9c52fbf441519cd16bd672da1ded' },
  { slug: 'greg', name: 'Greg', id: 'demo_e1b7c9151a34433a83e32b3657afc011' },
];
export const DEMO_PRINT_ORIGIN = 'https://kiosk-preview--glam-kiosk-site--lukevan.aem.page';

export function demoPrintAssets(id, selectedAdId) {
  const person = DEMO_PEOPLE.find((item) => item.id === id);
  const brand = BANNER_BRANDS.find((item, index) => selectedAdId === `${id}_${index + 1}`);
  if (!person || !brand) return null;
  return {
    printPreview: { url: `/assets/demo-print/${person.slug}/${brand}.jpg` },
    qr: `/assets/demo-print/${person.slug}/qr.png`,
    downloadPage: `${DEMO_PRINT_ORIGIN}/max-download.html?demo=${person.slug}`,
  };
}
