// Art Gallery App

const STORAGE_KEY = 'artgallery_seen';
const SETTINGS_KEY = 'artgallery_settings';
const ALBUMS_KEY = 'artgallery_albums';
const BACKUP_KEY = 'artgallery_backup_info';
const DATA_FILE = './data/paintings.json';
const BACKUP_REMINDER_THRESHOLD = 50; // Remind after 50 new artworks
const API_KEY_STORAGE = 'artgallery_apikey';

// AI prompts - title/artist will be prepended
const LITERAL_PROMPT = `Using the title and artist info provided, describe what is literally depicted:

- Who are the specific people/figures? (Use the title to identify them)
- What scene or event is shown?
- Key objects, setting, and composition
- Colors, lighting, atmosphere

Be specific and use the title context. Keep it concise (2-3 paragraphs).`;

const MEANING_PROMPT = `Using the title and artist info provided, explain the deeper meaning:

- Historical context - what event/period is this? Why did the artist paint it?
- Who commissioned it and why? What was the artist's relationship to the subject?
- Symbolism and what the artist was trying to convey
- How this fits in the artist's body of work or the art movement

Be insightful and use the title/artist context. Keep it concise (2-3 paragraphs).`;

let paintings = [];
let paintingsMap = {};
let orderedList = [];
let currentIndex = 0;
let seen = new Set();
let settings = { sortOrder: 'unseen' };

// Albums: { id: string, name: string, artworks: number[] }
let albums = [];

// Backup tracking
let backupInfo = {
  lastBackup: null,
  seenAtLastBackup: 0
};

// Current album viewing state
let currentAlbumId = null;
let currentAlbumIndex = 0;

// Default albums
const DEFAULT_ALBUMS = [
  { id: 'overall', name: 'Overall', artworks: [] },
  { id: 'color', name: 'Color', artworks: [] },
  { id: 'vibe', name: 'Vibe', artworks: [] },
  { id: 'texture', name: 'Texture', artworks: [] }
];

// DOM elements
const galleryView = document.getElementById('gallery');
const statsView = document.getElementById('stats');
const albumsView = document.getElementById('albums');
const albumDetailView = document.getElementById('album-detail');
const artworkImg = document.getElementById('artwork');
const loadingEl = document.getElementById('loading');
const completeMsgEl = document.getElementById('complete-msg');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const yearEl = document.getElementById('year');
const statsBtn = document.getElementById('stats-btn');
const backBtn = document.getElementById('back-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const resetBtn = document.getElementById('reset-btn');
const albumsBtn = document.getElementById('albums-btn');
const saveBtn = document.getElementById('save-btn');
const savePanel = document.getElementById('save-panel');
const closeSavePanel = document.getElementById('close-save-panel');
const albumCheckboxes = document.getElementById('album-checkboxes');

// Initialize
async function init() {
  loadSeen();
  loadSettings();
  loadAlbums();
  loadBackupInfo();
  await loadPaintings();
  applySort();
  showCurrentArtwork();
  setupControls();
  setupBackupControls();
}

// Load paintings data
async function loadPaintings() {
  try {
    const response = await fetch(DATA_FILE);
    paintings = await response.json();
    paintingsMap = {};
    for (const p of paintings) {
      paintingsMap[getPaintingId(p)] = p;
    }
    console.log(`Loaded ${paintings.length} paintings`);
  } catch (e) {
    console.error('Failed to load paintings:', e);
    loadingEl.textContent = 'Failed to load data';
  }
}

// Sorting functions
function applySort() {
  const unseenPaintings = paintings.filter(p => !seen.has(getPaintingId(p)));
  const seenPaintings = paintings.filter(p => seen.has(getPaintingId(p)));

  switch (settings.sortOrder) {
    case 'random':
      orderedList = shuffle([...paintings]);
      break;
    case 'chronological':
      orderedList = [...paintings].sort((a, b) => (a.year || 0) - (b.year || 0));
      break;
    case 'artist':
      orderedList = [...paintings].sort((a, b) =>
        (a.artistName || '').localeCompare(b.artistName || '')
      );
      break;
    case 'unseen':
    default:
      orderedList = [...shuffle(unseenPaintings), ...shuffle(seenPaintings)];
      break;
  }
  currentIndex = 0;
}

function shuffle(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function cleanImageUrl(url) {
  if (!url) return '';
  return url.replace(/![\w]+\.(jpg|jpeg|png|gif)$/i, '');
}

// Get unique ID for a painting (image URL is more unique than contentId)
function getPaintingId(painting) {
  return painting.image || painting.contentId;
}

// Zoom functionality
let zoomedImg = null;
let zoomScale = 1;
let zoomX = 0;
let zoomY = 0;

function setupZoom(img, containerId) {
  let initialDistance = 0;
  let initialScale = 1;

  img.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleZoom(img, e.clientX, e.clientY);
  });

  // Pinch to zoom
  img.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      initialDistance = getDistance(e.touches[0], e.touches[1]);
      initialScale = zoomScale || 1;
      zoomedImg = img;
    }
  }, { passive: false });

  img.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = getDistance(e.touches[0], e.touches[1]);
      const newScale = Math.min(5, Math.max(1, initialScale * (distance / initialDistance)));
      zoomScale = newScale;
      zoomedImg = img;
      applyZoom(img);
    } else if (e.touches.length === 1 && zoomedImg === img && zoomScale > 1) {
      e.preventDefault();
    }
  }, { passive: false });

  img.addEventListener('touchend', (e) => {
    if (zoomScale <= 1.05) {
      resetZoom();
    }
  });
}

function getDistance(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function toggleZoom(img, x, y) {
  if (zoomedImg === img && zoomScale > 1) {
    // Reset zoom
    zoomScale = 1;
    zoomX = 0;
    zoomY = 0;
    zoomedImg = null;
    img.style.transform = '';
    img.style.transformOrigin = '';
  } else {
    // Zoom in at tap point
    zoomedImg = img;
    zoomScale = 2.5;
    const rect = img.getBoundingClientRect();
    const percentX = ((x - rect.left) / rect.width) * 100;
    const percentY = ((y - rect.top) / rect.height) * 100;
    img.style.transformOrigin = `${percentX}% ${percentY}%`;
    applyZoom(img);
  }
}

function applyZoom(img) {
  img.style.transform = `scale(${zoomScale})`;
}

function resetZoom() {
  if (zoomedImg) {
    zoomedImg.style.transform = '';
    zoomedImg.style.transformOrigin = '';
    zoomedImg = null;
    zoomScale = 1;
  }
}

// Unified touch navigation - handles swipe and tap for iOS
function setupTouchNav(img, prevFn, nextFn) {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;
  let lastTapTime = 0;

  img.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }
  }, { passive: true });

  img.addEventListener('touchend', (e) => {
    if (e.changedTouches.length !== 1) return;
    if (zoomScale > 1) return; // Don't navigate when zoomed

    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const dt = Date.now() - touchStartTime;
    const now = Date.now();

    // Check for double-tap to zoom
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20 && dt < 300) {
      if (now - lastTapTime < 300) {
        // Double tap - zoom
        e.preventDefault();
        toggleZoom(img, touch.clientX, touch.clientY);
        lastTapTime = 0;
        return;
      }
      lastTapTime = now;

      // Single tap - wait briefly to see if it's a double tap
      setTimeout(() => {
        if (lastTapTime === now) {
          // It was a single tap, navigate based on position
          const rect = img.getBoundingClientRect();
          const x = touch.clientX - rect.left;
          const threshold = rect.width * 0.3;
          if (x < threshold) {
            prevFn();
          } else {
            nextFn();
          }
        }
      }, 250);
      return;
    }

    // Swipe detection (horizontal swipe > 50px, completed in < 500ms)
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
      if (dx > 0) {
        prevFn(); // Swipe right = prev
      } else {
        nextFn(); // Swipe left = next
      }
    }
  }, { passive: false });

  // Also support click for desktop
  img.addEventListener('click', (e) => {
    // Only handle if not a touch device or if it's a real mouse click
    if (e.pointerType === 'mouse' || !('ontouchstart' in window)) {
      const rect = img.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const threshold = rect.width * 0.3;
      if (x < threshold) {
        prevFn();
      } else {
        nextFn();
      }
    }
  });
}

// Show current artwork in main gallery
function showCurrentArtwork() {
  if (paintings.length === 0) return;

  const unseenCount = paintings.filter(p => !seen.has(getPaintingId(p))).length;
  if (unseenCount === 0 && settings.sortOrder === 'unseen') {
    showCompleteMessage();
    return;
  }

  if (settings.sortOrder === 'unseen') {
    while (currentIndex < orderedList.length && seen.has(getPaintingId(orderedList[currentIndex]))) {
      currentIndex++;
    }
    if (currentIndex >= orderedList.length) {
      showCompleteMessage();
      return;
    }
  }

  hideCompleteMessage();
  const painting = orderedList[currentIndex];
  if (!painting) return;

  seen.add(getPaintingId(painting));
  saveSeen();

  loadingEl.textContent = 'Loading...';
  loadingEl.classList.remove('hidden');
  artworkImg.classList.remove('loaded');

  const imageUrl = cleanImageUrl(painting.image);
  const img = new Image();
  img.onload = () => {
    artworkImg.src = imageUrl;
    artworkImg.classList.add('loaded');
    loadingEl.classList.add('hidden');
    preloadNext();
  };
  img.onerror = () => {
    console.warn('Failed to load:', imageUrl);
    setTimeout(next, 100);
  };
  img.src = imageUrl;

  titleEl.textContent = painting.title || 'Untitled';
  artistEl.textContent = painting.artistName || 'Unknown';
  yearEl.textContent = painting.completitionYear || painting.yearAsString || '';
}

// Preload next few images for faster navigation
function preloadNext() {
  const preloadCount = 3; // Preload next 3 images
  for (let i = 1; i <= preloadCount; i++) {
    const nextIdx = (currentIndex + i) % orderedList.length;
    const painting = orderedList[nextIdx];
    if (painting && painting.image) {
      const img = new Image();
      img.src = cleanImageUrl(painting.image);
    }
  }
}

function showCompleteMessage() {
  artworkImg.classList.remove('loaded');
  loadingEl.classList.add('hidden');
  completeMsgEl.classList.remove('hidden');
}

function hideCompleteMessage() {
  completeMsgEl.classList.add('hidden');
}

function next() {
  resetZoom();
  currentIndex++;
  if (currentIndex >= orderedList.length) currentIndex = 0;
  showCurrentArtwork();
}

function prev() {
  resetZoom();
  currentIndex--;
  if (currentIndex < 0) currentIndex = orderedList.length - 1;
  showCurrentArtwork();
}

function getCurrentPainting() {
  return orderedList[currentIndex];
}

// Setup controls
function setupControls() {
  // Keyboard
  document.addEventListener('keydown', (e) => {
    if (albumDetailView.classList.contains('active')) {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault();
        nextInAlbum();
      } else if (e.key === 'ArrowLeft') {
        prevInAlbum();
      } else if (e.key === 'Escape') {
        showAlbums();
      }
      return;
    }
    if (statsView.classList.contains('active') || albumsView.classList.contains('active')) {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        showGallery();
      }
      return;
    }
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      prev();
    } else if (e.key === 's') {
      showStats();
    } else if (e.key === 'Escape') {
      settingsPanel.classList.add('hidden');
      savePanel.classList.add('hidden');
    }
  });

  // Setup touch/tap handling for gallery
  setupTouchNav(artworkImg, prev, next);
  setupTouchNav(document.getElementById('album-artwork'), prevInAlbum, nextInAlbum);

  // Setup zoom (pinch only, no double-tap conflicts)
  setupZoom(artworkImg, 'artwork-container');
  setupZoom(document.getElementById('album-artwork'), 'album-artwork-container');

  // Navigation buttons
  statsBtn.addEventListener('click', showStats);
  backBtn.addEventListener('click', showGallery);
  albumsBtn.addEventListener('click', showAlbums);
  document.getElementById('albums-back-btn').addEventListener('click', showGallery);
  document.getElementById('album-detail-back-btn').addEventListener('click', showAlbums);

  // Settings
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPanel.classList.toggle('hidden');
    savePanel.classList.add('hidden');
  });

  document.querySelectorAll('input[name="sort"]').forEach(radio => {
    radio.checked = radio.value === settings.sortOrder;
    radio.addEventListener('change', (e) => {
      settings.sortOrder = e.target.value;
      saveSettings();
      applySort();
      showCurrentArtwork();
      settingsPanel.classList.add('hidden');
    });
  });

  // Save to album
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    savePanel.classList.toggle('hidden');
    settingsPanel.classList.add('hidden');
    if (!savePanel.classList.contains('hidden')) {
      renderAlbumCheckboxes();
    }
  });

  closeSavePanel.addEventListener('click', () => {
    savePanel.classList.add('hidden');
  });

  // Close panels on outside click
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && e.target !== settingsBtn) {
      settingsPanel.classList.add('hidden');
    }
    if (!savePanel.contains(e.target) && e.target !== saveBtn) {
      savePanel.classList.add('hidden');
    }
  });

  // Reset
  resetBtn.addEventListener('click', () => {
    seen.clear();
    saveSeen();
    applySort();
    showCurrentArtwork();
  });

  // Edit albums
  document.getElementById('edit-albums-btn').addEventListener('click', showEditAlbumsModal);
  document.getElementById('close-edit-modal').addEventListener('click', hideEditAlbumsModal);
  document.getElementById('add-album-btn').addEventListener('click', addNewAlbum);

  // Remove from album
  document.getElementById('remove-from-album-btn').addEventListener('click', removeFromCurrentAlbum);
}

// Album checkboxes in save panel
function renderAlbumCheckboxes() {
  const painting = getCurrentPainting();
  if (!painting) return;

  albumCheckboxes.innerHTML = albums.map(album => {
    const isIn = album.artworks.includes(getPaintingId(painting));
    return `
      <label>
        <input type="checkbox" data-album-id="${album.id}" ${isIn ? 'checked' : ''}>
        ${album.name}
      </label>
    `;
  }).join('');

  albumCheckboxes.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const albumId = e.target.dataset.albumId;
      const album = albums.find(a => a.id === albumId);
      if (!album) return;

      if (e.target.checked) {
        if (!album.artworks.includes(getPaintingId(painting))) {
          album.artworks.push(getPaintingId(painting));
        }
      } else {
        album.artworks = album.artworks.filter(id => id !== getPaintingId(painting));
      }
      saveAlbums();
    });
  });
}

// View switching
function showView(viewEl) {
  [galleryView, statsView, albumsView, albumDetailView].forEach(v => v.classList.remove('active'));
  viewEl.classList.add('active');
}

function showGallery() {
  showView(galleryView);
}

function showStats() {
  showView(statsView);
  renderStats();
  updateBackupDisplay();
}

function showAlbums() {
  showView(albumsView);
  renderAlbumsList();
}

function showAlbumDetail(albumId) {
  currentAlbumId = albumId;
  currentAlbumIndex = 0;
  showView(albumDetailView);
  renderAlbumDetail();
}

// Albums list
function renderAlbumsList() {
  const list = document.getElementById('albums-list');
  list.innerHTML = albums.map(album => {
    const count = album.artworks.length;
    const firstArtwork = count > 0 ? paintingsMap[album.artworks[0]] : null;
    const thumbUrl = firstArtwork ? cleanImageUrl(firstArtwork.image) : '';

    return `
      <div class="album-item" data-album-id="${album.id}">
        <div class="album-icon">
          ${thumbUrl ? `<img src="${thumbUrl}" alt="">` : ''}
        </div>
        <div class="album-info">
          <div class="album-name">${album.name}</div>
          <div class="album-count">${count} artwork${count !== 1 ? 's' : ''}</div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.album-item').forEach(item => {
    item.addEventListener('click', () => {
      showAlbumDetail(item.dataset.albumId);
    });
  });
}

// Album detail view
function renderAlbumDetail() {
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album) return;

  document.getElementById('album-detail-title').textContent = album.name;
  document.getElementById('album-detail-count').textContent =
    `${currentAlbumIndex + 1} / ${album.artworks.length}`;

  const emptyEl = document.getElementById('album-empty');
  const artworkEl = document.getElementById('album-artwork');
  const loadingEl = document.getElementById('album-loading');

  if (album.artworks.length === 0) {
    emptyEl.classList.remove('hidden');
    artworkEl.classList.remove('loaded');
    loadingEl.classList.add('hidden');
    document.getElementById('album-art-title').textContent = '';
    document.getElementById('album-art-artist').textContent = '';
    document.getElementById('album-art-year').textContent = '';
    return;
  }

  emptyEl.classList.add('hidden');
  const painting = paintingsMap[album.artworks[currentAlbumIndex]];
  if (!painting) return;

  loadingEl.classList.remove('hidden');
  artworkEl.classList.remove('loaded');

  const imageUrl = cleanImageUrl(painting.image);
  const img = new Image();
  img.onload = () => {
    artworkEl.src = imageUrl;
    artworkEl.classList.add('loaded');
    loadingEl.classList.add('hidden');
  };
  img.onerror = () => {
    loadingEl.textContent = 'Failed to load';
  };
  img.src = imageUrl;

  document.getElementById('album-art-title').textContent = painting.title || 'Untitled';
  document.getElementById('album-art-artist').textContent = painting.artistName || 'Unknown';
  document.getElementById('album-art-year').textContent = painting.completitionYear || painting.yearAsString || '';
  document.getElementById('album-detail-count').textContent =
    `${currentAlbumIndex + 1} / ${album.artworks.length}`;
}

function nextInAlbum() {
  resetZoom();
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;
  currentAlbumIndex = (currentAlbumIndex + 1) % album.artworks.length;
  renderAlbumDetail();
}

function prevInAlbum() {
  resetZoom();
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;
  currentAlbumIndex = (currentAlbumIndex - 1 + album.artworks.length) % album.artworks.length;
  renderAlbumDetail();
}

function removeFromCurrentAlbum() {
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;

  album.artworks.splice(currentAlbumIndex, 1);
  saveAlbums();

  if (currentAlbumIndex >= album.artworks.length) {
    currentAlbumIndex = Math.max(0, album.artworks.length - 1);
  }
  renderAlbumDetail();
}

// Edit albums modal
function showEditAlbumsModal() {
  document.getElementById('edit-albums-modal').classList.remove('hidden');
  renderEditAlbumsList();
}

function hideEditAlbumsModal() {
  document.getElementById('edit-albums-modal').classList.add('hidden');
  renderAlbumsList();
}

function renderEditAlbumsList() {
  const list = document.getElementById('edit-albums-list');
  list.innerHTML = albums.map(album => `
    <div class="edit-album-row" data-album-id="${album.id}">
      <input type="text" value="${album.name}" placeholder="Album name">
      <button class="delete-album-btn" title="Delete">×</button>
    </div>
  `).join('');

  list.querySelectorAll('.edit-album-row').forEach(row => {
    const albumId = row.dataset.albumId;
    const input = row.querySelector('input');
    const deleteBtn = row.querySelector('.delete-album-btn');

    input.addEventListener('change', () => {
      const album = albums.find(a => a.id === albumId);
      if (album) {
        album.name = input.value || 'Untitled';
        saveAlbums();
      }
    });

    deleteBtn.addEventListener('click', () => {
      if (confirm(`Delete "${albums.find(a => a.id === albumId)?.name}"?`)) {
        albums = albums.filter(a => a.id !== albumId);
        saveAlbums();
        renderEditAlbumsList();
      }
    });
  });
}

function addNewAlbum() {
  const newAlbum = {
    id: 'album_' + Date.now(),
    name: 'New Album',
    artworks: []
  };
  albums.push(newAlbum);
  saveAlbums();
  renderEditAlbumsList();
}

// Render stats
function renderStats() {
  const total = paintings.length;
  const seenCount = seen.size;
  const percent = total > 0 ? (seenCount / total * 100).toFixed(1) : 0;

  document.getElementById('overall-fill').style.width = `${percent}%`;
  document.getElementById('overall-text').textContent =
    `${seenCount.toLocaleString()} / ${total.toLocaleString()} artworks seen (${percent}%)`;

  // By artist - only show artists where you've seen at least one, sorted by seen count
  const artistStats = {};
  for (const painting of paintings) {
    const artist = painting.artistName || 'Unknown';
    if (!artistStats[artist]) artistStats[artist] = { total: 0, seen: 0 };
    artistStats[artist].total++;
    if (seen.has(getPaintingId(painting))) artistStats[artist].seen++;
  }

  // Filter to only artists with seen > 0, sort by seen count descending
  const artistsWithSeen = Object.entries(artistStats)
    .filter(([_, stats]) => stats.seen > 0)
    .sort((a, b) => b[1].seen - a[1].seen);

  document.getElementById('artist-list').innerHTML = artistsWithSeen.length > 0
    ? artistsWithSeen.map(([name, stats]) => {
        const pct = (stats.seen / stats.total * 100).toFixed(0);
        return `
          <div class="artist-row">
            <div class="artist-info">
              <span class="artist-name">${name}</span>
              <span class="artist-count">${stats.seen} / ${stats.total}</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('')
    : '<p style="color: #666;">No artists seen yet</p>';
}

// LocalStorage
function loadSeen() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      // IDs are now image URLs (strings), but keep old number IDs for backwards compat
      seen = new Set(JSON.parse(data));
      console.log(`Loaded ${seen.size} seen artworks`);
    }
  } catch (e) {
    console.error('Failed to load seen data:', e);
  }
}

function saveSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
    checkBackupReminder();
  } catch (e) {
    console.error('Failed to save seen data:', e);
  }
}

function loadSettings() {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    if (data) {
      settings = { ...settings, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function loadAlbums() {
  try {
    const data = localStorage.getItem(ALBUMS_KEY);
    if (data) {
      albums = JSON.parse(data);
      console.log(`Loaded ${albums.length} albums`);
    } else {
      albums = JSON.parse(JSON.stringify(DEFAULT_ALBUMS));
      saveAlbums();
    }
  } catch (e) {
    console.error('Failed to load albums:', e);
    albums = JSON.parse(JSON.stringify(DEFAULT_ALBUMS));
  }
}

function saveAlbums() {
  try {
    localStorage.setItem(ALBUMS_KEY, JSON.stringify(albums));
  } catch (e) {
    console.error('Failed to save albums:', e);
  }
}

// Backup functions
function loadBackupInfo() {
  try {
    const data = localStorage.getItem(BACKUP_KEY);
    if (data) {
      backupInfo = JSON.parse(data);
    }
  } catch (e) {
    console.error('Failed to load backup info:', e);
  }
}

function saveBackupInfo() {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backupInfo));
  } catch (e) {
    console.error('Failed to save backup info:', e);
  }
}

function checkBackupReminder() {
  const newSinceLast = seen.size - backupInfo.seenAtLastBackup;
  if (newSinceLast >= BACKUP_REMINDER_THRESHOLD) {
    showBackupReminder(newSinceLast);
  }
}

function showBackupReminder(count) {
  document.getElementById('reminder-count').textContent = count;
  document.getElementById('backup-reminder').classList.remove('hidden');
}

function hideBackupReminder() {
  document.getElementById('backup-reminder').classList.add('hidden');
}

function exportData() {
  const data = {
    version: 1,
    exportDate: new Date().toISOString(),
    seen: [...seen],
    albums: albums,
    settings: settings
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `art-gallery-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Update backup info
  backupInfo.lastBackup = new Date().toISOString();
  backupInfo.seenAtLastBackup = seen.size;
  saveBackupInfo();
  updateBackupDisplay();
  hideBackupReminder();
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (data.seen && Array.isArray(data.seen)) {
        seen = new Set(data.seen);
        saveSeen();
      }

      if (data.albums && Array.isArray(data.albums)) {
        albums = data.albums;
        saveAlbums();
      }

      if (data.settings) {
        settings = { ...settings, ...data.settings };
        saveSettings();
      }

      // Update backup info
      backupInfo.lastBackup = new Date().toISOString();
      backupInfo.seenAtLastBackup = seen.size;
      saveBackupInfo();

      alert(`Imported successfully!\n- ${seen.size} artworks seen\n- ${albums.length} albums`);

      // Refresh UI
      applySort();
      showCurrentArtwork();
      updateBackupDisplay();

    } catch (err) {
      alert('Failed to import: Invalid file format');
      console.error('Import error:', err);
    }
  };
  reader.readAsText(file);
}

function updateBackupDisplay() {
  const textEl = document.getElementById('last-backup-text');
  if (backupInfo.lastBackup) {
    const date = new Date(backupInfo.lastBackup);
    const newSince = seen.size - backupInfo.seenAtLastBackup;
    textEl.textContent = `Last backup: ${date.toLocaleDateString()} (${newSince} new since then)`;
  } else {
    textEl.textContent = 'No backup yet - export your data to keep it safe!';
  }
}

function setupBackupControls() {
  // Export button
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('reminder-export-btn').addEventListener('click', exportData);

  // Import button
  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importData(e.target.files[0]);
      e.target.value = ''; // Reset for next import
    }
  });

  // Reminder modal
  document.getElementById('close-backup-reminder').addEventListener('click', hideBackupReminder);
  document.getElementById('reminder-later-btn').addEventListener('click', () => {
    // Snooze - add half the threshold to delay next reminder
    backupInfo.seenAtLastBackup = seen.size - Math.floor(BACKUP_REMINDER_THRESHOLD / 2);
    saveBackupInfo();
    hideBackupReminder();
  });

  // Update display
  updateBackupDisplay();
}

// AI Interpretation functions
function setupAIControls() {
  const literalBtn = document.getElementById('ai-literal-btn');
  const meaningBtn = document.getElementById('ai-meaning-btn');
  const aiModal = document.getElementById('ai-modal');
  const closeAiModal = document.getElementById('close-ai-modal');
  const apiKeyModal = document.getElementById('api-key-modal');
  const closeApiModal = document.getElementById('close-api-modal');
  const saveApiKeyBtn = document.getElementById('save-api-key');

  literalBtn.addEventListener('click', () => requestInterpretation('literal'));
  meaningBtn.addEventListener('click', () => requestInterpretation('meaning'));

  closeAiModal.addEventListener('click', () => aiModal.classList.add('hidden'));
  closeApiModal.addEventListener('click', () => apiKeyModal.classList.add('hidden'));

  saveApiKeyBtn.addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
      localStorage.setItem(API_KEY_STORAGE, key);
      apiKeyModal.classList.add('hidden');
      // Retry the last request
      if (window.pendingAIRequest) {
        requestInterpretation(window.pendingAIRequest);
      }
    }
  });

  // Close modals on backdrop click
  aiModal.addEventListener('click', (e) => {
    if (e.target === aiModal) aiModal.classList.add('hidden');
  });
  apiKeyModal.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) apiKeyModal.classList.add('hidden');
  });
}

// Convert image URL to base64
async function imageToBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      // Get base64 without the data:image/jpeg;base64, prefix
      const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

async function requestInterpretation(type) {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) {
    window.pendingAIRequest = type;
    document.getElementById('api-key-modal').classList.remove('hidden');
    return;
  }

  const painting = getCurrentPainting();
  if (!painting) return;

  const aiModal = document.getElementById('ai-modal');
  const aiTitle = document.getElementById('ai-modal-title');
  const aiLoading = document.getElementById('ai-loading');
  const aiText = document.getElementById('ai-text');

  // Set title based on type
  aiTitle.textContent = type === 'literal' ? 'What\'s in this painting' : 'Deeper meaning';

  // Show modal with breathing orb
  aiModal.classList.remove('hidden');
  aiLoading.innerHTML = '<div class="breathing-orb"></div>';
  aiText.textContent = '';

  // Disable buttons while loading
  document.getElementById('ai-literal-btn').disabled = true;
  document.getElementById('ai-meaning-btn').disabled = true;

  try {
    const prompt = type === 'literal' ? LITERAL_PROMPT : MEANING_PROMPT;
    const imageUrl = cleanImageUrl(painting.image);

    // Convert image to base64 (WikiArt URLs can't be fetched directly by Claude)
    const imageBase64 = await imageToBase64(imageUrl);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: imageBase64
              }
            },
            {
              type: 'text',
              text: `PAINTING INFO:
Title: "${painting.title}"
Artist: ${painting.artistName}
${painting.completitionYear ? `Year: ${painting.completitionYear}` : ''}

${prompt}`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || 'API request failed');
    }

    const data = await response.json();
    aiLoading.innerHTML = '';
    aiText.textContent = data.content[0].text;

  } catch (error) {
    console.error('AI request failed:', error);
    aiLoading.innerHTML = '';

    if (error.message.includes('invalid x-api-key') || error.message.includes('401')) {
      aiText.textContent = 'Invalid API key. Please check your key and try again.';
      localStorage.removeItem(API_KEY_STORAGE);
    } else if (error.message.includes('CORS') || error.name === 'TypeError') {
      aiText.textContent = 'Unable to connect to Claude API. This may be a browser restriction.\n\nTry using the app in a different browser or contact support.';
    } else {
      aiText.textContent = `Error: ${error.message}`;
    }
  } finally {
    document.getElementById('ai-literal-btn').disabled = false;
    document.getElementById('ai-meaning-btn').disabled = false;
  }
}

// Start
setupAIControls();
init();
