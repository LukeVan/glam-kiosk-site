import { readFile, writeFile } from 'node:fs/promises';

const source = await readFile(new URL('./graph-auto-load.user.js', import.meta.url), 'utf8');
for (const [suffix, title, label] of [
  ['upload-new', 'Upload new', 'upload new'],
  ['browse-files', 'Browse files', 'browse files'],
]) {
  const script = source
    .replace('// @name         MAX_Activation_AdobeGraph', `// @name         MAX_Activation_AdobeGraph - ${title}`)
    .replace('const uploadControlLabel = "upload new";', `const uploadControlLabel = "${label}";`)
    .replace('const autoRun = false;', `const autoRun = ${suffix === 'browse-files'};`)
    .replaceAll('/tools/graph-auto-load.user.js', `/tools/graph-auto-load-${suffix}.user.js`);
  await writeFile(new URL(`./graph-auto-load-${suffix}.user.js`, import.meta.url), script);
}
