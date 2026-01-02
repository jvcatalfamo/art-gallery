// WikiArt Data Fetcher
// Run with: node fetch-data.js
// Rate limit: 400 requests/hour, 4 requests/second

const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://www.wikiart.org/en/App';
const DATA_DIR = './data';
const RATE_LIMIT_MS = 300; // ~3 requests/second to stay safe

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  return response.json();
}

async function fetchAllArtists() {
  console.log('Fetching all artists...');
  const url = `${BASE_URL}/Artist/AlphabetJson?v=new`;
  const artists = await fetchJson(url);
  console.log(`Found ${artists.length} artists`);
  return artists;
}

async function fetchPaintingsByArtist(artistUrl) {
  const url = `${BASE_URL}/Painting/PaintingsByArtist?artistUrl=${artistUrl}&json=2`;
  return fetchJson(url);
}

async function fetchArtistDetails(artistUrl) {
  const url = `${BASE_URL}/Artist/ArtistJson?artistUrl=${artistUrl}`;
  return fetchJson(url);
}

async function main() {
  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Check for existing progress
  let artists = [];
  let allPaintings = [];
  let processedArtists = new Set();

  const progressFile = path.join(DATA_DIR, 'progress.json');
  const artistsFile = path.join(DATA_DIR, 'artists.json');
  const paintingsFile = path.join(DATA_DIR, 'paintings.json');

  if (fs.existsSync(progressFile)) {
    const progress = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    processedArtists = new Set(progress.processedArtists || []);
    console.log(`Resuming from ${processedArtists.size} already processed artists`);
  }

  if (fs.existsSync(artistsFile)) {
    artists = JSON.parse(fs.readFileSync(artistsFile, 'utf8'));
    console.log(`Loaded ${artists.length} artists from cache`);
  } else {
    artists = await fetchAllArtists();
    fs.writeFileSync(artistsFile, JSON.stringify(artists, null, 2));
    console.log(`Saved ${artists.length} artists to ${artistsFile}`);
  }

  if (fs.existsSync(paintingsFile)) {
    allPaintings = JSON.parse(fs.readFileSync(paintingsFile, 'utf8'));
    console.log(`Loaded ${allPaintings.length} paintings from cache`);
  }

  // Fetch paintings for each artist
  let requestCount = 0;
  const startTime = Date.now();

  for (const artist of artists) {
    if (processedArtists.has(artist.url)) {
      continue;
    }

    try {
      console.log(`Fetching paintings for: ${artist.artistName} (${artist.url})`);
      const paintings = await fetchPaintingsByArtist(artist.url);

      if (Array.isArray(paintings)) {
        // Add artist info to each painting for easier lookup
        for (const painting of paintings) {
          painting.artistUrl = artist.url;
          painting.artistName = artist.artistName;
          allPaintings.push(painting);
        }
        console.log(`  Found ${paintings.length} paintings (total: ${allPaintings.length})`);
      }

      processedArtists.add(artist.url);
      requestCount++;

      // Save progress every 50 artists
      if (requestCount % 50 === 0) {
        fs.writeFileSync(paintingsFile, JSON.stringify(allPaintings, null, 2));
        fs.writeFileSync(progressFile, JSON.stringify({
          processedArtists: Array.from(processedArtists),
          lastUpdate: new Date().toISOString()
        }));
        console.log(`  [Saved progress: ${processedArtists.size}/${artists.length} artists]`);
      }

      // Rate limiting
      await sleep(RATE_LIMIT_MS);

      // Check hourly limit
      const elapsed = Date.now() - startTime;
      if (requestCount >= 380 && elapsed < 3600000) {
        const waitTime = 3600000 - elapsed + 60000; // Wait for hour to reset + 1 min buffer
        console.log(`Approaching rate limit. Waiting ${Math.round(waitTime / 60000)} minutes...`);
        await sleep(waitTime);
      }

    } catch (error) {
      console.error(`  Error fetching ${artist.url}: ${error.message}`);
      // Continue to next artist
    }
  }

  // Final save
  fs.writeFileSync(paintingsFile, JSON.stringify(allPaintings, null, 2));
  fs.writeFileSync(progressFile, JSON.stringify({
    processedArtists: Array.from(processedArtists),
    lastUpdate: new Date().toISOString(),
    complete: true
  }));

  console.log('\n=== COMPLETE ===');
  console.log(`Total artists: ${artists.length}`);
  console.log(`Total paintings: ${allPaintings.length}`);
}

main().catch(console.error);
