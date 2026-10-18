const brands = ['1-larocheposay', '2-lorealprofessionnel', '3-YSLbeauty', '4-lorealparis'];

module.exports = function fixture() {
  const version = 'a'.repeat(32);
  const prefix = `assets/permanent-demos/demo_Person5/custom_max/${version}/`;
  const image = (file, mimeType = 'image/jpeg') => ({ blob: prefix + file, mimeType });
  const map = (make) => Object.fromEntries(brands.map((brand, index) => [brand, make(brand, index)]));
  return {
    schemaVersion: 1,
    revision: 'b'.repeat(32),
    experienceTemplateSets: { main: 'main_square', max: 'custom_max' },
    people: [{
      id: 'demo_Person5', name: 'Permanent Demo Five', enabled: true, order: 0,
      profiles: {
        custom_max: {
          demo: true,
          version,
          templateFingerprint: 'c'.repeat(64),
          portrait: image('portrait.jpg'),
          ads: map((brand) => image(`ads/${brand}.jpg`)),
          cutouts: map((brand) => image(`cutouts/${brand}.png`, 'image/png')),
          variations: map((brand, index) => Array.from({ length: index === 1 ? 23 : index }, (_, i) => ({
            ...image(`variations/${brand}/page_${i + 1}.jpg`), label: `${brand} variation ${i + 1}`,
          }))),
          printPreviews: map((brand) => image(`print-previews/${brand}.jpg`)),
        },
      },
    }],
  };
};
