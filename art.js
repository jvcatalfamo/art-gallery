// Art Gallery App

const STORAGE_KEY = 'artgallery_seen';
const ALBUMS_KEY = 'artgallery_albums';
const BACKUP_KEY = 'artgallery_backup_info';
const DATA_FILE = './data/paintings.json';
const BACKUP_REMINDER_THRESHOLD = 10; // Remind after 10 new saves
const API_KEY_STORAGE = 'artgallery_apikey';

// AI prompt - combines literal description with deeper meaning
const AI_PROMPT = `Using the title and artist info provided, give an integrated interpretation of this painting:

Start by describing what we see - the scene, figures, setting, and notable visual elements. Use the title to identify who or what is depicted.

Then naturally flow into the deeper context: Why did the artist paint this? What was happening historically or in their life? What symbolism or meaning is embedded in the work? How does this fit into their artistic journey or the broader art movement?

Write it as a cohesive narrative, not separate sections. Be engaging and insightful. Keep it to 3-4 paragraphs.`;

let paintings = [];
let paintingsMap = {};
let orderedList = [];
let currentIndex = 0;
let seen = new Set();

// Albums: { id: string, name: string, artworks: number[] }
let albums = [];

// Backup tracking
let backupInfo = {
  lastBackup: null,
  seenAtLastBackup: 0,
  savedAtLastBackup: 0
};

// Current album viewing state
let currentAlbumId = null;
let currentAlbumIndex = 0;
let currentAlbumArtworkId = null; // the artwork actually on screen in album view

let consecutiveFailures = 0;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
const resetBtn = document.getElementById('reset-btn');
const albumsBtn = document.getElementById('albums-btn');
const saveBtn = document.getElementById('save-btn');
const savePanel = document.getElementById('save-panel');
const albumCheckboxes = document.getElementById('album-checkboxes');

// Initialize
async function init() {
  loadBackupInfo();
  loadSeen();
  loadAlbums();
  await loadPaintings();
  applySort();
  showCurrentArtwork();
  setupControls();
  setupBackupControls();
  checkBackupReminder();
  // Ask the browser not to evict our data (helps on Android/Chrome; harmless elsewhere)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
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

// Sorting - always random
function applySort() {
  orderedList = shuffle([...paintings]);
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

// Known placeholder images that are shared by many paintings
const PLACEHOLDER_IMAGES = new Set([
  'https://uploads.wikiart.org/Content/images/FRAME-600x480.jpg'
]);

// Get unique ID for a painting
// For placeholder images, use contentId to differentiate
// For unique images, use image URL (more reliable than contentId which has duplicates)
function getPaintingId(painting) {
  if (painting.image && !PLACEHOLDER_IMAGES.has(painting.image)) {
    return painting.image;
  }
  // For placeholders or missing images, use contentId
  // Add prefix to avoid collision with image URLs
  return 'id:' + painting.contentId;
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

  const painting = orderedList[currentIndex];
  if (!painting) return;

  // The save panel belongs to one painting; never leave it open on another
  savePanel.classList.add('hidden');

  loadingEl.textContent = 'Loading...';
  loadingEl.classList.remove('hidden');
  artworkImg.classList.remove('loaded');

  const imageUrl = cleanImageUrl(painting.image);
  const img = new Image();
  img.onload = () => {
    if (getCurrentPainting() !== painting) return; // user already moved on
    consecutiveFailures = 0;
    // Only count it as seen once it actually showed up
    seen.add(getPaintingId(painting));
    saveSeen();
    artworkImg.src = imageUrl;
    artworkImg.classList.add('loaded');
    loadingEl.classList.add('hidden');
    preloadNext();
  };
  img.onerror = () => {
    if (getCurrentPainting() !== painting) return;
    console.warn('Failed to load:', imageUrl);
    consecutiveFailures++;
    // Offline or images blocked: stop instead of racing through the collection
    if (!navigator.onLine || consecutiveFailures >= 5) {
      loadingEl.textContent = 'Can’t load images right now — tap to retry';
      return;
    }
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
    // Typing in a text box (note, album name, API key) must never trigger
    // shortcuts: space/arrows/Backspace/'s' would navigate away mid-typing
    const t = e.target;
    const typing = t && (t.tagName === 'TEXTAREA' || t.isContentEditable ||
      (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file'].includes(t.type)));
    if (typing) return;
    if (t && t.type === 'checkbox' && e.key === ' ') return; // Space ticks the box
    // With a popup open, Escape closes it and nothing else happens underneath
    const openModal = document.querySelector('.modal:not(.hidden)');
    if (openModal) {
      if (e.key === 'Escape') openModal.classList.add('hidden');
      return;
    }
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

  // Save to album
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    savePanel.classList.toggle('hidden');
    if (!savePanel.classList.contains('hidden')) {
      renderAlbumCheckboxes();
    }
  });

  // Close save panel on outside click only (not touch - let click handle it)
  function closeSavePanelOnOutsideClick(e) {
    // Only act if save panel is actually visible
    if (savePanel.classList.contains('hidden')) return;

    const target = e.target;

    // Don't interfere with anything inside save panel, modals, or buttons
    if (!target) return;
    if (target.closest('#save-panel')) return;
    if (target.closest('.modal')) return;
    if (target.closest('.icon-btn')) return;
    if (target.closest('button')) return;
    if (target.closest('label')) return;
    if (target.closest('input')) return;

    // Close the save panel and prevent navigation
    savePanel.classList.add('hidden');
    e.stopPropagation();
    e.preventDefault();
  }
  // Only use click - it fires on both desktop and mobile (after touch)
  document.addEventListener('click', closeSavePanelOnOutsideClick, true);

  // Retry after images failed to load
  loadingEl.addEventListener('click', () => {
    if (consecutiveFailures === 0) return;
    consecutiveFailures = 0;
    showCurrentArtwork();
  });

  // Another tab changed the albums: pick that up so we never write back stale data
  window.addEventListener('storage', (e) => {
    if (e.key === ALBUMS_KEY) {
      refreshAlbums();
      if (albumsView.classList.contains('active')) renderAlbumsList();
      if (albumDetailView.classList.contains('active')) renderAlbumDetail();
      if (!savePanel.classList.contains('hidden')) renderAlbumCheckboxes();
    }
  });

  // Reset
  resetBtn.addEventListener('click', () => {
    seen.clear();
    saveSeen(true);
    applySort();
    showCurrentArtwork();
  });

  // Edit albums
  document.getElementById('edit-albums-btn').addEventListener('click', showEditAlbumsModal);
  document.getElementById('close-edit-modal').addEventListener('click', hideEditAlbumsModal);
  document.getElementById('add-album-btn').addEventListener('click', addNewAlbum);

  // Remove from album
  document.getElementById('remove-from-album-btn').addEventListener('click', removeFromCurrentAlbum);

  // Note editing
  document.getElementById('add-note-btn').addEventListener('click', openNoteModal);
  document.getElementById('edit-note-btn').addEventListener('click', openNoteModal);
  document.getElementById('close-note-modal').addEventListener('click', closeNoteModal);
  document.getElementById('save-note-btn').addEventListener('click', saveNoteFromModal);
  document.getElementById('delete-note-btn').addEventListener('click', deleteNoteFromModal);

  // Close note modal on backdrop click
  document.getElementById('edit-note-modal').addEventListener('click', (e) => {
    if (e.target.id === 'edit-note-modal') closeNoteModal();
  });

}

// Note modal functions
function openNoteModal() {
  refreshAlbums();
  const album = albums.find(a => a.id === currentAlbumId);
  const artworkId = currentAlbumArtworkId;
  if (!album || !artworkId) return;

  const currentNote = album.notes && album.notes[artworkId] || '';

  document.getElementById('edit-note-input').value = currentNote;
  document.getElementById('edit-note-modal').classList.remove('hidden');
}

function closeNoteModal() {
  document.getElementById('edit-note-modal').classList.add('hidden');
}

// Notes are keyed by the artwork on screen, not by index, so a change made
// in another tab can't shift the note onto a different painting
function setNoteForCurrent(note) {
  const artworkId = currentAlbumArtworkId;
  if (!artworkId) return;
  updateAlbums(() => {
    const album = albums.find(a => a.id === currentAlbumId);
    if (!album || !album.artworks.includes(artworkId)) return;
    if (!album.notes) album.notes = {};
    if (note) {
      album.notes[artworkId] = note;
    } else {
      delete album.notes[artworkId];
    }
  });
  closeNoteModal();
  renderAlbumDetail();
}

function saveNoteFromModal() {
  setNoteForCurrent(document.getElementById('edit-note-input').value.trim());
}

function deleteNoteFromModal() {
  setNoteForCurrent('');
}

// Album checkboxes in save panel
function renderAlbumCheckboxes() {
  const painting = getCurrentPainting();
  if (!painting) return;

  const paintingId = getPaintingId(painting);

  refreshAlbums();
  albumCheckboxes.innerHTML = albums.map(album => {
    const isIn = album.artworks.includes(paintingId);
    return `
      <label>
        <input type="checkbox" data-album-id="${escapeHtml(album.id)}" ${isIn ? 'checked' : ''}>
        ${escapeHtml(album.name)}
      </label>
    `;
  }).join('');

  // Handle checkbox changes
  function handleCheckboxToggle(cb) {
    const albumId = cb.dataset.albumId;
    updateAlbums(() => {
      const album = albums.find(a => a.id === albumId);
      if (!album) {
        console.error('Album not found:', albumId);
        return;
      }

      if (cb.checked) {
        if (!album.artworks.includes(paintingId)) {
          album.artworks.push(paintingId);
        }
      } else {
        album.artworks = album.artworks.filter(id => id !== paintingId);
        if (album.notes) {
          delete album.notes[paintingId];
        }
      }
    });
  }

  albumCheckboxes.querySelectorAll('input').forEach(cb => {
    // Use change event (works on desktop)
    cb.addEventListener('change', () => handleCheckboxToggle(cb));

    // Also handle click directly for mobile
    cb.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent save panel from closing
    });
  });

  // Also handle clicks on labels for mobile
  albumCheckboxes.querySelectorAll('label').forEach(label => {
    label.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevent save panel from closing
    });
  });
}

// Simple debounce helper
function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

// View switching
function showView(viewEl) {
  savePanel.classList.add('hidden');
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
  refreshAlbums();
  list.innerHTML = albums.map(album => {
    const count = album.artworks.length;
    const firstArtwork = count > 0 ? paintingsMap[album.artworks[0]] : null;
    const thumbUrl = firstArtwork ? cleanImageUrl(firstArtwork.image) : '';

    return `
      <div class="album-item" data-album-id="${escapeHtml(album.id)}">
        <div class="album-icon">
          ${thumbUrl ? `<img src="${escapeHtml(thumbUrl)}" alt="">` : ''}
        </div>
        <div class="album-info">
          <div class="album-name">${escapeHtml(album.name)}</div>
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

  // Another tab may have shrunk this album
  if (currentAlbumIndex >= album.artworks.length) {
    currentAlbumIndex = Math.max(0, album.artworks.length - 1);
  }
  currentAlbumArtworkId = album.artworks[currentAlbumIndex] || null;

  document.getElementById('album-detail-title').textContent = album.name;
  document.getElementById('album-detail-count').textContent =
    `${currentAlbumIndex + 1} / ${album.artworks.length}`;

  const emptyEl = document.getElementById('album-empty');
  const artworkEl = document.getElementById('album-artwork');
  const loadingEl = document.getElementById('album-loading');
  const noteContainer = document.getElementById('album-note-container');
  const noteDisplay = document.getElementById('album-note-display');
  const addNoteBtn = document.getElementById('add-note-btn');

  if (album.artworks.length === 0) {
    emptyEl.classList.remove('hidden');
    artworkEl.classList.remove('loaded');
    loadingEl.classList.add('hidden');
    noteContainer.classList.add('hidden');
    addNoteBtn.classList.add('hidden');
    document.getElementById('album-art-title').textContent = '';
    document.getElementById('album-art-artist').textContent = '';
    document.getElementById('album-art-year').textContent = '';
    return;
  }

  emptyEl.classList.add('hidden');
  const artworkId = currentAlbumArtworkId;
  const painting = paintingsMap[artworkId];
  if (!painting) {
    // Saved painting no longer in the collection: say so instead of leaving
    // the previous painting on screen (it can still be removed)
    artworkEl.classList.remove('loaded');
    loadingEl.textContent = 'This painting is no longer in the collection';
    loadingEl.classList.remove('hidden');
    noteContainer.classList.add('hidden');
    addNoteBtn.classList.add('hidden');
    document.getElementById('album-art-title').textContent = '';
    document.getElementById('album-art-artist').textContent = '';
    document.getElementById('album-art-year').textContent = '';
    return;
  }

  // Show/hide note
  const note = album.notes && album.notes[artworkId];
  if (note) {
    noteContainer.classList.remove('hidden');
    noteDisplay.textContent = note;
    addNoteBtn.classList.add('hidden');
  } else {
    noteContainer.classList.add('hidden');
    addNoteBtn.classList.remove('hidden');
  }

  loadingEl.textContent = 'Loading...';
  loadingEl.classList.remove('hidden');
  artworkEl.classList.remove('loaded');

  const imageUrl = cleanImageUrl(painting.image);
  const img = new Image();
  img.onload = () => {
    if (currentAlbumArtworkId !== artworkId) return; // user already moved on
    artworkEl.src = imageUrl;
    artworkEl.classList.add('loaded');
    loadingEl.classList.add('hidden');
  };
  img.onerror = () => {
    if (currentAlbumArtworkId !== artworkId) return;
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
  refreshAlbums();
  resetZoom();
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;
  currentAlbumIndex = (currentAlbumIndex + 1) % album.artworks.length;
  renderAlbumDetail();
}

function prevInAlbum() {
  refreshAlbums();
  resetZoom();
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;
  currentAlbumIndex = (currentAlbumIndex - 1 + album.artworks.length) % album.artworks.length;
  renderAlbumDetail();
}

function removeFromCurrentAlbum() {
  const artworkId = currentAlbumArtworkId;
  if (!artworkId) return;

  updateAlbums(() => {
    const album = albums.find(a => a.id === currentAlbumId);
    if (!album) return;
    album.artworks = album.artworks.filter(id => id !== artworkId);
    if (album.notes) delete album.notes[artworkId];
  });
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
  refreshAlbums();
  list.innerHTML = albums.map(album => `
    <div class="edit-album-row" data-album-id="${escapeHtml(album.id)}">
      <input type="text" value="${escapeHtml(album.name)}" placeholder="Album name" maxlength="12">
      <button class="delete-album-btn" title="Delete">×</button>
    </div>
  `).join('');

  list.querySelectorAll('.edit-album-row').forEach(row => {
    const albumId = row.dataset.albumId;
    const input = row.querySelector('input');
    const deleteBtn = row.querySelector('.delete-album-btn');

    input.addEventListener('change', () => {
      updateAlbums(() => {
        const album = albums.find(a => a.id === albumId);
        if (album) album.name = (input.value || 'Untitled').slice(0, 12);
      });
    });

    deleteBtn.addEventListener('click', () => {
      refreshAlbums();
      const album = albums.find(a => a.id === albumId);
      if (!album) return renderEditAlbumsList();
      const n = album.artworks.length;
      if (confirm(`Delete "${album.name}"${n ? ` and its ${n} saved artwork${n !== 1 ? 's' : ''}` : ''}?`)) {
        updateAlbums(() => {
          albums = albums.filter(a => a.id !== albumId);
        });
        renderEditAlbumsList();
      }
    });
  });
}

function addNewAlbum() {
  updateAlbums(() => {
    albums.push({
      id: 'album_' + Date.now(),
      name: 'New',
      artworks: []
    });
  });
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
              <span class="artist-name">${escapeHtml(name)}</span>
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
      const loadedIds = JSON.parse(data);
      seen = new Set(loadedIds);

      // Migrate: remove placeholder URLs from seen set
      // These were incorrectly matching multiple paintings
      let migrated = false;
      for (const placeholder of PLACEHOLDER_IMAGES) {
        if (seen.has(placeholder)) {
          seen.delete(placeholder);
          migrated = true;
          console.log(`Migrated: removed placeholder URL from seen set`);
        }
      }

      if (migrated) {
        saveSeen(true);
      }

      console.log(`Loaded ${seen.size} seen artworks`);
    }
  } catch (e) {
    console.error('Failed to load seen data:', e);
  }
}

// replace=true writes exactly this set (Start Over, migrations); otherwise
// merge with what other tabs have stored instead of overwriting it
function saveSeen(replace = false) {
  try {
    if (!replace) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) for (const id of JSON.parse(stored)) seen.add(id);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch (e) {
    console.error('Failed to save seen data:', e);
  }
}

// Re-read albums from storage so another tab's saves are never overwritten
// by this tab's stale in-memory copy
function refreshAlbums() {
  try {
    const data = localStorage.getItem(ALBUMS_KEY);
    if (data) albums = JSON.parse(data);
  } catch (e) {
    console.error('Failed to refresh albums:', e);
  }
}

// Every album change goes through here: fresh read, change, save
function updateAlbums(fn) {
  refreshAlbums();
  fn();
  saveAlbums();
}

function loadAlbums() {
  try {
    const data = localStorage.getItem(ALBUMS_KEY);
    if (data) {
      albums = JSON.parse(data);
      console.log(`Loaded ${albums.length} albums from localStorage`);
    } else {
      console.log('No album data found, using defaults');
      albums = JSON.parse(JSON.stringify(DEFAULT_ALBUMS));
      saveAlbums();
    }
  } catch (e) {
    console.error('Failed to load albums:', e);
    albums = JSON.parse(JSON.stringify(DEFAULT_ALBUMS));
  }
}

function saveAlbums() {
  const data = JSON.stringify(albums);
  try {
    localStorage.setItem(ALBUMS_KEY, data);
  } catch (e) {
    // Storage full: the seen-history is the big, replaceable part. Drop its
    // oldest half so the albums (irreplaceable) still save.
    try {
      const ids = [...seen];
      seen = new Set(ids.slice(Math.floor(ids.length / 2)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
      localStorage.setItem(ALBUMS_KEY, data);
    } catch (e2) {
      console.error('Failed to save albums:', e2);
      alert('Failed to save! ' + e2.message + '\nExport a backup from the Progress screen now.');
      return;
    }
  }
  checkBackupReminder();
}

function countSaved() {
  return albums.reduce((n, a) => n + a.artworks.length, 0);
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
  if (backupInfo.savedAtLastBackup == null) backupInfo.savedAtLastBackup = 0;
}

function saveBackupInfo() {
  try {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(backupInfo));
  } catch (e) {
    console.error('Failed to save backup info:', e);
  }
}

// Remind based on saves (the part that can't be recreated), not on browsing:
// after 10 new saves, or once saves have gone 3 days without a backup
// (phone browsers can wipe site data after ~7 days away)
function checkBackupReminder() {
  const now = Date.now();
  const newSinceLast = countSaved() - backupInfo.savedAtLastBackup;
  if (newSinceLast <= 0) {
    if (backupInfo.pendingSince) { backupInfo.pendingSince = null; saveBackupInfo(); }
    return;
  }
  if (!backupInfo.pendingSince) { backupInfo.pendingSince = now; saveBackupInfo(); }
  if (backupInfo.snoozedUntil && now < backupInfo.snoozedUntil) return;
  if (newSinceLast >= BACKUP_REMINDER_THRESHOLD || now - backupInfo.pendingSince >= 3 * 86400000) {
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

function snoozeBackupReminder() {
  backupInfo.snoozedUntil = Date.now() + 86400000; // ask again tomorrow
  saveBackupInfo();
  hideBackupReminder();
}

async function exportData() {
  refreshAlbums();
  const data = {
    version: 1,
    type: 'art',
    exportDate: new Date().toISOString(),
    seen: [...seen],
    albums: albums
  };

  const json = JSON.stringify(data, null, 2);
  const name = `art-gallery-backup-${new Date().toISOString().split('T')[0]}.json`;
  const file = new File([json], name, { type: 'application/json' });

  // On phones, use the share sheet so the backup can go to Files / iCloud
  // Drive / email instead of a downloads folder that's easy to lose
  const isTouch = 'ontouchstart' in window;
  if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
    } catch (e) {
      if (e.name === 'AbortError') return; // cancelled: not backed up
      downloadFile(file);
    }
  } else {
    downloadFile(file);
  }

  // Update backup info
  backupInfo.lastBackup = new Date().toISOString();
  backupInfo.seenAtLastBackup = seen.size;
  backupInfo.savedAtLastBackup = countSaved();
  backupInfo.pendingSince = null;
  backupInfo.snoozedUntil = null;
  saveBackupInfo();
  updateBackupDisplay();
  hideBackupReminder();
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Import MERGES into what's here and never removes anything, so restoring
// an older backup can't erase newer saves
function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      // Old art backups have no type; anything typed must be an art backup
      if (data.type && data.type !== 'art') {
        alert('That isn’t an art backup (poetry backups go in the poetry section).');
        return;
      }
      let added = 0;

      if (data.seen && Array.isArray(data.seen)) {
        for (const id of data.seen) seen.add(id);
        saveSeen();
      }

      if (data.albums && Array.isArray(data.albums)) {
        updateAlbums(() => {
          for (const inc of data.albums) {
            if (!inc || !inc.id || !Array.isArray(inc.artworks)) continue;
            let album = albums.find(a => a.id === inc.id);
            if (!album) {
              album = { id: inc.id, name: inc.name || 'Untitled', artworks: [] };
              albums.push(album);
            }
            for (const id of inc.artworks) {
              if (!album.artworks.includes(id)) {
                album.artworks.push(id);
                added++;
              }
            }
            for (const [id, note] of Object.entries(inc.notes || {})) {
              if (!album.notes) album.notes = {};
              if (!album.notes[id]) album.notes[id] = note;
            }
          }
        });
      }

      alert(`Imported!\n- ${added} artwork${added !== 1 ? 's' : ''} added to albums\n- ${seen.size} artworks seen\nNothing already saved was removed.`);

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
  const unsaved = Math.max(0, countSaved() - backupInfo.savedAtLastBackup);
  if (backupInfo.lastBackup) {
    const date = new Date(backupInfo.lastBackup);
    textEl.textContent = `Last backup: ${date.toLocaleDateString()} (${unsaved} saved since then)`;
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
  document.getElementById('reminder-later-btn').addEventListener('click', snoozeBackupReminder);

  // Close backup reminder on backdrop click
  document.getElementById('backup-reminder').addEventListener('click', (e) => {
    if (e.target.id === 'backup-reminder') hideBackupReminder();
  });

  // Update display
  updateBackupDisplay();
}

// AI Interpretation functions
function setupAIControls() {
  const aiBtn = document.getElementById('ai-btn');
  const aiModal = document.getElementById('ai-modal');
  const closeAiModal = document.getElementById('close-ai-modal');
  const apiKeyModal = document.getElementById('api-key-modal');
  const closeApiModal = document.getElementById('close-api-modal');
  const saveApiKeyBtn = document.getElementById('save-api-key');

  aiBtn.addEventListener('click', () => requestInterpretation());

  closeAiModal.addEventListener('click', () => { aiModal.classList.add('hidden'); stopBreathing(); });
  closeApiModal.addEventListener('click', () => apiKeyModal.classList.add('hidden'));

  saveApiKeyBtn.addEventListener('click', () => {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
      localStorage.setItem(API_KEY_STORAGE, key);
      apiKeyModal.classList.add('hidden');
      // Retry the last request
      if (window.pendingAIRequest) {
        requestInterpretation();
        window.pendingAIRequest = false;
      }
    }
  });

  // Close modals on backdrop click
  aiModal.addEventListener('click', (e) => {
    if (e.target === aiModal) { aiModal.classList.add('hidden'); stopBreathing(); }
  });
  apiKeyModal.addEventListener('click', (e) => {
    if (e.target === apiKeyModal) apiKeyModal.classList.add('hidden');
  });
}

// Convert image URL to base64 JPEG, scaled down so huge originals stay under
// the API's per-image size limit (and cost less) - 1568px is plenty to read a painting
const AI_MAX_EDGE = 1568;
async function imageToBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const scale = Math.min(1, AI_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      // Get base64 without the data:image/jpeg;base64, prefix
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      resolve(dataUrl.split(',')[1]);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = url;
  });
}

let aiRequestId = 0;

function stopBreathing() {
  if (window.breathInterval) clearInterval(window.breathInterval);
  window.breathInterval = null;
}

async function requestInterpretation() {
  const apiKey = localStorage.getItem(API_KEY_STORAGE);
  if (!apiKey) {
    window.pendingAIRequest = true;
    document.getElementById('api-key-modal').classList.remove('hidden');
    return;
  }

  const painting = getCurrentPainting();
  if (!painting) return;
  const requestId = ++aiRequestId;

  const aiModal = document.getElementById('ai-modal');
  const aiTitle = document.getElementById('ai-modal-title');
  const aiLoading = document.getElementById('ai-loading');
  const aiText = document.getElementById('ai-text');

  // Set title
  aiTitle.textContent = 'About this painting';

  // Show modal with breathing orb and cycling text
  aiModal.classList.remove('hidden');
  aiLoading.innerHTML = '<div class="breathing-orb"></div><div class="breath-text">breathe in</div>';
  aiText.textContent = '';

  // Cycle through calming messages
  const breathMessages = ['breathe in', 'breathe out', 'relax', 'enjoy your day'];
  let msgIndex = 0;
  stopBreathing();
  window.breathInterval = setInterval(() => {
    msgIndex = (msgIndex + 1) % breathMessages.length;
    const textEl = aiLoading.querySelector('.breath-text');
    if (textEl) textEl.textContent = breathMessages[msgIndex];
  }, 3000);

  // Disable button while loading
  document.getElementById('ai-btn').disabled = true;

  // Only the latest request may write into the modal
  const show = (text) => {
    if (requestId !== aiRequestId) return;
    stopBreathing();
    aiLoading.innerHTML = '';
    aiText.textContent = text;
  };

  try {
    const imageUrl = cleanImageUrl(painting.image);

    // Convert image to base64 (WikiArt URLs can't be fetched directly by Claude)
    const imageBase64 = await imageToBase64(imageUrl);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        output_config: { effort: 'low' },
        fallbacks: 'default',
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

${AI_PROMPT}`
            }
          ]
        }]
      })
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const error = await response.json();
        if (error.error && error.error.message) message = error.error.message;
      } catch (_) {}
      if (response.status === 401) {
        localStorage.removeItem(API_KEY_STORAGE);
        show('Invalid API key. Tap the button again to enter a new one.');
      } else if (response.status === 429 || response.status >= 500) {
        show('Claude is busy right now. Please try again in a moment.');
      } else {
        show(`Error: ${message}`);
      }
      return;
    }

    const data = await response.json();
    if (data.stop_reason === 'refusal') {
      show('Claude couldn\u2019t write about this one. Try another painting.');
      return;
    }
    // The reply can include non-text blocks (e.g. thinking); keep only the text
    const text = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('\n\n')
      .trim();
    show(text || 'No interpretation came back. Please try again.');

  } catch (error) {
    console.error('AI request failed:', error);
    if (error.message === 'Failed to load image') {
      show('Couldn\u2019t load this painting\u2019s image to send. Check your connection and try again.');
    } else {
      show('Unable to reach Claude. Check your connection and try again.');
    }
  } finally {
    if (requestId === aiRequestId) document.getElementById('ai-btn').disabled = false;
  }
}

// Start
setupAIControls();
init();
