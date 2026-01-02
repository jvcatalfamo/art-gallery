// Quick sample fetcher - grabs a few artists with full painting details
// Run with: node fetch-sample.js

const fs = require('fs');

const BASE_URL = 'https://www.wikiart.org/en/App';
const RATE_LIMIT_MS = 300;

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('Fetching sample data with full details...\n');

  // Get all artists first
  console.log('Fetching artist list...');
  const artists = await fetchJson(`${BASE_URL}/Artist/AlphabetJson?v=new`);
  console.log(`Found ${artists.length} total artists\n`);

  // Pick some famous artists for a good sample
  const sampleArtistUrls = [
    'vincent-van-gogh',
    'claude-monet',
    'pablo-picasso',
    'rembrandt',
    'leonardo-da-vinci',
    'michelangelo',
    'johannes-vermeer',
    'edvard-munch',
    'gustav-klimt',
    'salvador-dali'
  ];

  const sampleArtists = artists.filter(a => sampleArtistUrls.includes(a.url));
  const allPaintings = [];

  for (const artist of sampleArtists) {
    console.log(`Fetching: ${artist.artistName}...`);
    try {
      const paintings = await fetchJson(
        `${BASE_URL}/Painting/PaintingsByArtist?artistUrl=${artist.url}&json=2`
      );
      if (Array.isArray(paintings)) {
        // Get detailed info for first 50 paintings per artist (to stay within rate limits)
        const limit = Math.min(paintings.length, 50);
        console.log(`  Getting details for ${limit} of ${paintings.length} paintings...`);

        for (let i = 0; i < limit; i++) {
          const p = paintings[i];
          try {
            const details = await fetchJson(`${BASE_URL}/Painting/ImageJson/${p.contentId}`);
            allPaintings.push({
              contentId: p.contentId,
              title: details.title || p.title,
              artistName: artist.artistName,
              artistUrl: artist.url,
              year: details.completitionYear || p.completitionYear,
              image: p.image,
              style: details.style || null,
              genre: details.genre || null,
              galleryName: details.galleryName || null
            });
          } catch (e) {
            // Fallback to basic info
            allPaintings.push({
              contentId: p.contentId,
              title: p.title,
              artistName: artist.artistName,
              artistUrl: artist.url,
              year: p.completitionYear,
              image: p.image,
              style: null,
              genre: null,
              galleryName: null
            });
          }
          await sleep(RATE_LIMIT_MS);

          if ((i + 1) % 10 === 0) {
            process.stdout.write(`  ${i + 1}/${limit}\r`);
          }
        }
        console.log(`  Done: ${limit} paintings with details`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  // Save sample data
  if (!fs.existsSync('./data')) fs.mkdirSync('./data');

  fs.writeFileSync('./data/artists-sample.json', JSON.stringify(sampleArtists, null, 2));
  fs.writeFileSync('./data/paintings-sample.json', JSON.stringify(allPaintings, null, 2));

  // Show style breakdown
  const styles = {};
  for (const p of allPaintings) {
    const s = p.style || 'Unknown';
    styles[s] = (styles[s] || 0) + 1;
  }
  console.log('\nStyle breakdown:');
  Object.entries(styles).sort((a, b) => b[1] - a[1]).forEach(([s, c]) => {
    console.log(`  ${s}: ${c}`);
  });

  console.log(`\nSaved ${sampleArtists.length} artists and ${allPaintings.length} paintings to ./data/`);
}

main().catch(console.error);
