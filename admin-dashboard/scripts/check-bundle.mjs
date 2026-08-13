import { readdir, stat } from 'node:fs/promises';

const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const files = await readdir(assetsDirectory);
const sizes = Object.fromEntries(await Promise.all(files.map(async (file) => [file, (await stat(new URL(file, assetsDirectory))).size])));
const entry = Object.entries(sizes).find(([file]) => /^index-.*\.js$/.test(file));
const css = Object.entries(sizes).find(([file]) => /^index-.*\.css$/.test(file));
const lazyChunks = Object.entries(sizes).filter(([file]) => /Panel-.*\.js$/.test(file));

assertBudget('حزمة الدخول', entry, 400 * 1024);
// The shared responsive shell is about 31.4 KB gzip, including the authenticated
// room-theme phone simulator. Keep a strict raw ceiling with modest headroom.
assertBudget('ملف الأنماط', css, 160 * 1024);
for (const chunk of lazyChunks) {
  const maximum = /^(StoreCatalogPanel|UsersPanel)-/.test(chunk[0]) ? 46 * 1024 : 40 * 1024;
  assertBudget(`حزمة ${chunk[0]}`, chunk, maximum);
}

console.info(JSON.stringify({
  cssBytes: css?.[1] || 0,
  entryBytes: entry?.[1] || 0,
  lazyChunks: Object.fromEntries(lazyChunks),
}, null, 2));

function assertBudget(label, entryValue, maximum) {
  if (!entryValue) throw new Error(`${label}: الملف المطلوب غير موجود في بناء الإنتاج.`);
  if (entryValue[1] > maximum) throw new Error(`${label} تجاوزت الحد: ${entryValue[1]} > ${maximum} bytes.`);
}
