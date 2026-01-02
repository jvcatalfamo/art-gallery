// Art Gallery App

const STORAGE_KEY = 'artgallery_seen';
const SETTINGS_KEY = 'artgallery_settings';
const ALBUMS_KEY = 'artgallery_albums';
const BACKUP_KEY = 'artgallery_backup_info';
const DATA_FILE = './data/paintings.json';
const BACKUP_REMINDER_THRESHOLD = 50; // Remind after 50 new artworks

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
const styleEl = document.getElementById('style');
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
      paintingsMap[p.contentId] = p;
    }
    console.log(`Loaded ${paintings.length} paintings`);
  } catch (e) {
    console.error('Failed to load paintings:', e);
    loadingEl.textContent = 'Failed to load data';
  }
}

// Sorting functions
function applySort() {
  const unseenPaintings = paintings.filter(p => !seen.has(p.contentId));
  const seenPaintings = paintings.filter(p => seen.has(p.contentId));

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

// Zoom functionality
let zoomedImg = null;
let zoomScale = 1;
let zoomX = 0;
let zoomY = 0;

function setupZoom(img, containerId) {
  let lastTap = 0;
  let initialDistance = 0;
  let initialScale = 1;

  img.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleZoom(img, e.clientX, e.clientY);
  });

  // Double-tap for touch
  img.addEventListener('touchend', (e) => {
    const now = Date.now();
    if (now - lastTap < 300 && e.changedTouches.length === 1) {
      e.preventDefault();
      const touch = e.changedTouches[0];
      toggleZoom(img, touch.clientX, touch.clientY);
    }
    lastTap = now;
  });

  // Pinch to zoom
  img.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      initialDistance = getDistance(e.touches[0], e.touches[1]);
      initialScale = zoomScale || 1;
      zoomedImg = img; // Enable zoom mode on pinch start
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
      // Pan when zoomed
      e.preventDefault();
    }
  }, { passive: false });

  img.addEventListener('touchend', (e) => {
    // Reset zoom if scale is back to 1
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

// Show current artwork in main gallery
function showCurrentArtwork() {
  if (paintings.length === 0) return;

  const unseenCount = paintings.filter(p => !seen.has(p.contentId)).length;
  if (unseenCount === 0 && settings.sortOrder === 'unseen') {
    showCompleteMessage();
    return;
  }

  if (settings.sortOrder === 'unseen') {
    while (currentIndex < orderedList.length && seen.has(orderedList[currentIndex].contentId)) {
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

  seen.add(painting.contentId);
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
  };
  img.onerror = () => {
    console.warn('Failed to load:', imageUrl);
    setTimeout(next, 100);
  };
  img.src = imageUrl;

  titleEl.textContent = painting.title || 'Untitled';
  artistEl.textContent = painting.artistName || 'Unknown';
  yearEl.textContent = painting.year || '';
  styleEl.textContent = painting.style || '';
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

  // Touch swipe for main gallery
  let touchStartX = 0;
  galleryView.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  galleryView.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) {
      // Swipe left = prev, swipe right = next
      if (diff > 0) prev();
      else next();
    }
  }, { passive: true });

  // Touch swipe for album detail
  albumDetailView.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
  }, { passive: true });

  albumDetailView.addEventListener('touchend', (e) => {
    const diff = touchStartX - e.changedTouches[0].screenX;
    if (Math.abs(diff) > 50) {
      // Swipe left = prev, swipe right = next
      if (diff > 0) prevInAlbum();
      else nextInAlbum();
    }
  }, { passive: true });

  // Double-tap to zoom
  setupZoom(artworkImg, 'artwork-container');
  setupZoom(document.getElementById('album-artwork'), 'album-artwork-container');

  // Tap left = prev, tap right = next (standard gallery behavior)
  artworkImg.addEventListener('click', (e) => {
    const rect = artworkImg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const threshold = rect.width * 0.3; // Left 30% = prev
    if (x < threshold) {
      prev();
    } else {
      next();
    }
  });

  // Same for album view
  document.getElementById('album-artwork').addEventListener('click', (e) => {
    const img = e.target;
    const rect = img.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const threshold = rect.width * 0.3;
    if (x < threshold) {
      prevInAlbum();
    } else {
      nextInAlbum();
    }
  });

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
    const isIn = album.artworks.includes(painting.contentId);
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
        if (!album.artworks.includes(painting.contentId)) {
          album.artworks.push(painting.contentId);
        }
      } else {
        album.artworks = album.artworks.filter(id => id !== painting.contentId);
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
  document.getElementById('album-art-year').textContent = painting.year || '';
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

  // By style
  const styleStats = {};
  for (const painting of paintings) {
    const style = painting.style || 'Unknown';
    if (!styleStats[style]) styleStats[style] = { total: 0, seen: 0 };
    styleStats[style].total++;
    if (seen.has(painting.contentId)) styleStats[style].seen++;
  }

  document.getElementById('style-list').innerHTML = Object.entries(styleStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, stats]) => {
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
    }).join('');

  // By artist
  const artistStats = {};
  for (const painting of paintings) {
    const artist = painting.artistName || 'Unknown';
    if (!artistStats[artist]) artistStats[artist] = { total: 0, seen: 0 };
    artistStats[artist].total++;
    if (seen.has(painting.contentId)) artistStats[artist].seen++;
  }

  document.getElementById('artist-list').innerHTML = Object.entries(artistStats)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([name, stats]) => {
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
    }).join('');
}

// LocalStorage
function loadSeen() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
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

// Start
init();
