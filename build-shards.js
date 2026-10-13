// Splits the big data files into small pieces so the pages can show the
// first painting/poem as soon as ONE piece arrives, loading the rest in the
// background. Re-run after changing data/paintings.json or poems-data.json:
//   node build-shards.js
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'data', 'shards');
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f));

// Interleave (item i -> piece i % n) so every piece is a mix of artists/poets
function split(items, n) {
  const pieces = Array.from({ length: n }, () => []);
  items.forEach((x, i) => pieces[i % n].push(x));
  return pieces;
}

// ---- paintings: compact rows [image, title, artist, year, contentId] ----
// image is stored as "~<middle>" when it is https://uploads...!Large.jpg,
// and rebuilt exactly in the browser (saved albums use the full URL as the id)
const PRE = 'https://uploads', SUF = '!Large.jpg';
const paintings = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'paintings.json'), 'utf8'));
const rows = paintings.map(p => {
  const img = p.image || '';
  const packed = img.startsWith(PRE) && img.endsWith(SUF) ? '~' + img.slice(PRE.length, -SUF.length) : img;
  return [packed, p.title || '', p.artistName || '', p.completitionYear || p.yearAsString || '', p.contentId || 0];
});
const ART_PIECES = 32;
split(rows, ART_PIECES).forEach((piece, i) => fs.writeFileSync(path.join(OUT, `art-${i}.json`), JSON.stringify(piece)));

// ---- poems: raw items, just split ----
const raw = fs.readFileSync(path.join(__dirname, 'poems-data.json'), 'utf8').replace(/^﻿/, '');
// Drop the ~120 scraped entries with no real text (they showed as blank pages)
const poems = JSON.parse(raw)
  .filter(p => (p.content || '').replace(/\s+/g, ' ').trim().length >= 25)
  .map(p => ({ title: p.title, author: p.author, content: p.content }));
const POEM_PIECES = 32;
split(poems, POEM_PIECES).forEach((piece, i) => fs.writeFileSync(path.join(OUT, `poems-${i}.json`), JSON.stringify(piece)));

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
  art: { pieces: ART_PIECES, count: rows.length },
  poems: { pieces: POEM_PIECES, count: poems.length }
}));
console.log(`art: ${rows.length} in ${ART_PIECES} pieces; poems: ${poems.length} in ${POEM_PIECES} pieces`);
