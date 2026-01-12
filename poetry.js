// Poetry App - Using Poetry Foundation data via Hugging Face

const STORAGE_KEY = 'poetry_seen';
const ALBUMS_KEY = 'poetry_albums';
const BACKUP_KEY = 'poetry_backup_info';
const BACKUP_REMINDER_THRESHOLD = 50;

// Local poetry data (13,801 poems from Poetry Foundation)
const POEMS_DATA_URL = 'poems-data.json';
const TOTAL_POEMS = 13801;

let poems = [];
let poemsMap = {};
let orderedList = [];
let currentIndex = 0;
let seen = new Set();

// Collections
let albums = [];
let currentAlbumId = null;
let currentAlbumIndex = 0;

// Default collections
const DEFAULT_ALBUMS = [
  { id: 'favorites', name: 'Favorites', artworks: [] },
  { id: 'mood', name: 'Mood', artworks: [] },
  { id: 'inspiring', name: 'Inspiring', artworks: [] }
];

// Backup tracking
let backupInfo = {
  lastBackup: null,
  seenAtLastBackup: 0
};

// DOM elements
const poetryView = document.getElementById('poetry');
const statsView = document.getElementById('stats');
const albumsView = document.getElementById('albums');
const albumDetailView = document.getElementById('album-detail');
const poemText = document.getElementById('poem-text');
const loadingEl = document.getElementById('poem-loading');
const titleEl = document.getElementById('title');
const artistEl = document.getElementById('artist');
const statsBtn = document.getElementById('stats-btn');
const backBtn = document.getElementById('back-btn');
const albumsBtn = document.getElementById('albums-btn');
const saveBtn = document.getElementById('save-btn');
const savePanel = document.getElementById('save-panel');
const closeSavePanel = document.getElementById('close-save-panel');
const albumCheckboxes = document.getElementById('album-checkboxes');

// Initialize
async function init() {
  loadSeen();
  loadAlbums();
  loadBackupInfo();
  await loadPoems();
  applySort();
  showCurrentPoem();
  setupControls();
  setupBackupControls();
}

// Clean up poem content - fix hard-wrapped lines that split words
function cleanPoemContent(content) {
  if (!content) return '';

  // Normalize line breaks
  content = content.replace(/\r\n/g, '\n');
  content = content.replace(/\r/g, '\n');

  // Convert multiple spaces (2+) to line breaks - some data uses spaces instead of newlines
  content = content.replace(/  +/g, '\n');

  // Preserve stanza breaks (double newlines) by using a placeholder
  content = content.replace(/\n\n+/g, '\n\n§STANZA§\n\n');

  // Split into lines
  const lines = content.split('\n');
  const result = [];
  let currentLine = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines (stanza breaks handled separately)
    if (!line) continue;

    // Handle stanza marker - output accumulated line first
    if (line === '§STANZA§') {
      if (currentLine) {
        result.push(currentLine);
        currentLine = '';
      }
      result.push('');
      continue;
    }

    // If no accumulated line, start fresh
    if (!currentLine) {
      currentLine = line;
      continue;
    }

    // Check if current accumulated line was probably hard-wrapped
    const endsWithLowercase = /[a-z]$/.test(currentLine);
    const startsWithLowercase = /^[a-z]/.test(line);
    const endsWithPunctuation = /[.!?,;:'")\-—]$/.test(currentLine);

    if (endsWithLowercase && startsWithLowercase && !endsWithPunctuation) {
      // Determine if this was mid-word split or word boundary
      // Get the last "word fragment" (text after last space)
      const lastSpaceIdx = currentLine.lastIndexOf(' ');
      const tailFragment = lastSpaceIdx >= 0 ? currentLine.slice(lastSpaceIdx + 1) : currentLine;

      // If tail is very short (1-3 chars), it's likely a mid-word split
      // Join without space to reconstruct the word
      if (tailFragment.length <= 3) {
        currentLine = currentLine + line;
      } else {
        // Tail is longer, likely a complete word - add space between
        currentLine = currentLine + ' ' + line;
      }
    } else {
      // This looks like a natural line break, save current line and start new one
      result.push(currentLine);
      currentLine = line;
    }
  }

  // Don't forget the last line
  if (currentLine) {
    result.push(currentLine);
  }

  // Join lines back together
  return result.join('\n');
}

// Load poems from local JSON file
async function loadPoems() {
  try {
    loadingEl.textContent = 'Loading poems...';

    const response = await fetch(POEMS_DATA_URL);
    const data = await response.json();

    // Transform and dedupe poems
    poems = [];
    poemsMap = {};

    for (const item of data) {
      const poem = {
        title: (item.title || 'Untitled').trim(),
        author: (item.author || 'Unknown').trim(),
        content: cleanPoemContent(item.content)
      };

      const id = getPoemId(poem);
      if (!poemsMap[id]) {
        poems.push(poem);
        poemsMap[id] = poem;
      }
    }

    console.log(`Loaded ${poems.length} poems`);
    loadingEl.textContent = '';
  } catch (e) {
    console.error('Failed to load poems:', e);
    loadingEl.textContent = 'Failed to load poems. Please refresh.';
  }
}

// All poems are loaded from local file, so this just reshuffles when needed
function fetchMorePoems() {
  // Reshuffle to give variety when cycling through
  if (currentIndex >= orderedList.length - 1) {
    orderedList = shuffle([...poems]);
    currentIndex = 0;
  }
}

// Get unique ID for a poem
function getPoemId(poem) {
  return `${poem.title}::${poem.author}`;
}

// Sorting - always random
function applySort() {
  orderedList = shuffle([...poems]);
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

// Show current poem
function showCurrentPoem() {
  if (poems.length === 0) return;

  const poem = orderedList[currentIndex];
  if (!poem) return;

  seen.add(getPoemId(poem));
  saveSeen();

  // Display poem
  poemText.textContent = poem.content;
  titleEl.textContent = poem.title || 'Untitled';
  artistEl.textContent = poem.author || 'Unknown';

  // Scroll to top of poem
  document.getElementById('poem-container').scrollTop = 0;
}

function next() {
  currentIndex++;
  if (currentIndex >= orderedList.length) currentIndex = 0;
  showCurrentPoem();

  // Fetch more poems when running low
  if (orderedList.length - currentIndex < 50) {
    fetchMorePoems();
  }
}

function prev() {
  currentIndex--;
  if (currentIndex < 0) currentIndex = orderedList.length - 1;
  showCurrentPoem();
}

function getCurrentPoem() {
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
        showPoetry();
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

  // Touch navigation on poem container
  setupTouchNav(document.getElementById('poem-container'), prev, next);
  setupTouchNav(document.getElementById('album-poem-container'), prevInAlbum, nextInAlbum);

  // Navigation buttons
  statsBtn.addEventListener('click', showStats);
  backBtn.addEventListener('click', showPoetry);
  albumsBtn.addEventListener('click', showAlbums);
  document.getElementById('albums-back-btn').addEventListener('click', showPoetry);
  document.getElementById('album-detail-back-btn').addEventListener('click', showAlbums);

  // Save to collection
  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    savePanel.classList.toggle('hidden');
    if (!savePanel.classList.contains('hidden')) {
      renderAlbumCheckboxes();
    }
  });

  closeSavePanel.addEventListener('click', () => {
    savePanel.classList.add('hidden');
  });

  // Close panels on outside click
  document.addEventListener('click', (e) => {
    if (!savePanel.contains(e.target) && e.target !== saveBtn) {
      savePanel.classList.add('hidden');
    }
  });

  // Edit collections
  document.getElementById('edit-albums-btn').addEventListener('click', showEditAlbumsModal);
  document.getElementById('close-edit-modal').addEventListener('click', hideEditAlbumsModal);
  document.getElementById('add-album-btn').addEventListener('click', addNewAlbum);

  // Remove from collection
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

  // Note input in save panel
  const noteInput = document.getElementById('note-input');
  noteInput.addEventListener('input', debounce(() => {
    const poem = getCurrentPoem();
    if (!poem) return;

    const poemId = getPoemId(poem);
    const note = noteInput.value.trim();

    for (const album of albums) {
      if (album.artworks.includes(poemId)) {
        if (!album.notes) album.notes = {};
        if (note) {
          album.notes[poemId] = note;
        } else {
          delete album.notes[poemId];
        }
      }
    }
    saveAlbums();
  }, 500));
}

// Touch navigation
function setupTouchNav(el, prevFn, nextFn) {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartTime = Date.now();
    }
  }, { passive: true });

  el.addEventListener('touchend', (e) => {
    if (e.changedTouches.length !== 1) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartX;
    const dy = touch.clientY - touchStartY;
    const dt = Date.now() - touchStartTime;

    // Tap detection
    if (Math.abs(dx) < 20 && Math.abs(dy) < 20 && dt < 300) {
      const rect = el.getBoundingClientRect();
      const x = touch.clientX - rect.left;
      const threshold = rect.width * 0.3;
      if (x < threshold) {
        prevFn();
      } else {
        nextFn();
      }
      return;
    }

    // Swipe detection
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) && dt < 500) {
      if (dx > 0) {
        prevFn();
      } else {
        nextFn();
      }
    }
  }, { passive: false });

  // Desktop click
  el.addEventListener('click', (e) => {
    if (e.pointerType === 'mouse' || !('ontouchstart' in window)) {
      const rect = el.getBoundingClientRect();
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

// Note modal functions
function openNoteModal() {
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;

  const poemId = album.artworks[currentAlbumIndex];
  const currentNote = album.notes && album.notes[poemId] || '';

  document.getElementById('edit-note-input').value = currentNote;
  document.getElementById('edit-note-modal').classList.remove('hidden');
}

function closeNoteModal() {
  document.getElementById('edit-note-modal').classList.add('hidden');
}

function saveNoteFromModal() {
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;

  const poemId = album.artworks[currentAlbumIndex];
  const note = document.getElementById('edit-note-input').value.trim();

  if (!album.notes) album.notes = {};

  if (note) {
    album.notes[poemId] = note;
  } else {
    delete album.notes[poemId];
  }

  saveAlbums();
  closeNoteModal();
  renderAlbumDetail();
}

function deleteNoteFromModal() {
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;

  const poemId = album.artworks[currentAlbumIndex];

  if (album.notes) {
    delete album.notes[poemId];
  }

  saveAlbums();
  closeNoteModal();
  renderAlbumDetail();
}

// Collection checkboxes
function renderAlbumCheckboxes() {
  const poem = getCurrentPoem();
  if (!poem) return;

  const poemId = getPoemId(poem);
  const noteSection = document.getElementById('note-section');
  const noteInput = document.getElementById('note-input');

  albumCheckboxes.innerHTML = albums.map(album => {
    const isIn = album.artworks.includes(poemId);
    return `
      <label>
        <input type="checkbox" data-album-id="${album.id}" ${isIn ? 'checked' : ''}>
        ${album.name}
      </label>
    `;
  }).join('');

  const isInAnyAlbum = albums.some(a => a.artworks.includes(poemId));
  if (isInAnyAlbum) {
    noteSection.classList.remove('hidden');
    const albumWithNote = albums.find(a =>
      a.artworks.includes(poemId) && a.notes && a.notes[poemId]
    );
    noteInput.value = albumWithNote ? albumWithNote.notes[poemId] : '';
  } else {
    noteSection.classList.add('hidden');
    noteInput.value = '';
  }

  albumCheckboxes.querySelectorAll('input').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const albumId = e.target.dataset.albumId;
      const album = albums.find(a => a.id === albumId);
      if (!album) return;

      if (e.target.checked) {
        if (!album.artworks.includes(poemId)) {
          album.artworks.push(poemId);
        }
      } else {
        album.artworks = album.artworks.filter(id => id !== poemId);
        if (album.notes) {
          delete album.notes[poemId];
        }
      }
      saveAlbums();

      const nowInAnyAlbum = albums.some(a => a.artworks.includes(poemId));
      if (nowInAnyAlbum) {
        noteSection.classList.remove('hidden');
      } else {
        noteSection.classList.add('hidden');
        noteInput.value = '';
      }
    });
  });
}

function debounce(fn, delay) {
  let timeoutId;
  return function(...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

// View switching
function showView(viewEl) {
  [poetryView, statsView, albumsView, albumDetailView].forEach(v => v.classList.remove('active'));
  viewEl.classList.add('active');
}

function showPoetry() {
  showView(poetryView);
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

// Collections list
function renderAlbumsList() {
  const list = document.getElementById('albums-list');
  list.innerHTML = albums.map(album => {
    const count = album.artworks.length;
    return `
      <div class="album-item" data-album-id="${album.id}">
        <div class="album-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#666">
            <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
          </svg>
        </div>
        <div class="album-info">
          <div class="album-name">${album.name}</div>
          <div class="album-count">${count} poem${count !== 1 ? 's' : ''}</div>
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

// Collection detail view
function renderAlbumDetail() {
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album) return;

  document.getElementById('album-detail-title').textContent = album.name;
  document.getElementById('album-detail-count').textContent =
    `${currentAlbumIndex + 1} / ${album.artworks.length}`;

  const emptyEl = document.getElementById('album-empty');
  const poemEl = document.getElementById('album-poem-text');
  const loadingEl = document.getElementById('album-loading');
  const noteContainer = document.getElementById('album-note-container');
  const noteDisplay = document.getElementById('album-note-display');
  const addNoteBtn = document.getElementById('add-note-btn');

  if (album.artworks.length === 0) {
    emptyEl.classList.remove('hidden');
    poemEl.textContent = '';
    loadingEl.classList.add('hidden');
    noteContainer.classList.add('hidden');
    addNoteBtn.classList.add('hidden');
    document.getElementById('album-art-title').textContent = '';
    document.getElementById('album-art-artist').textContent = '';
    return;
  }

  emptyEl.classList.add('hidden');
  const poemId = album.artworks[currentAlbumIndex];
  const poem = poemsMap[poemId];

  if (!poem) {
    poemEl.textContent = 'Poem not found';
    document.getElementById('album-art-title').textContent = '';
    document.getElementById('album-art-artist').textContent = '';
    return;
  }

  // Show/hide note
  const note = album.notes && album.notes[poemId];
  if (note) {
    noteContainer.classList.remove('hidden');
    noteDisplay.textContent = note;
    addNoteBtn.classList.add('hidden');
  } else {
    noteContainer.classList.add('hidden');
    addNoteBtn.classList.remove('hidden');
  }

  loadingEl.classList.add('hidden');
  poemEl.textContent = poem.content;
  document.getElementById('album-art-title').textContent = poem.title || 'Untitled';
  document.getElementById('album-art-artist').textContent = poem.author || 'Unknown';
  document.getElementById('album-detail-count').textContent =
    `${currentAlbumIndex + 1} / ${album.artworks.length}`;
}

function nextInAlbum() {
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;
  currentAlbumIndex = (currentAlbumIndex + 1) % album.artworks.length;
  renderAlbumDetail();
}

function prevInAlbum() {
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

// Edit collections modal
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
      <input type="text" value="${album.name}" placeholder="Collection name">
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
    name: 'New Collection',
    artworks: []
  };
  albums.push(newAlbum);
  saveAlbums();
  renderEditAlbumsList();
}

// Render stats
function renderStats() {
  const total = TOTAL_POEMS; // Use actual total from Poetry Foundation
  const seenCount = seen.size;
  const percent = total > 0 ? (seenCount / total * 100).toFixed(1) : 0;

  document.getElementById('overall-fill').style.width = `${percent}%`;
  document.getElementById('overall-text').textContent =
    `${seenCount.toLocaleString()} / ${total.toLocaleString()} poems read (${percent}%)`;

  // By poet
  const poetStats = {};
  for (const poem of poems) {
    const poet = poem.author || 'Unknown';
    if (!poetStats[poet]) poetStats[poet] = { total: 0, seen: 0 };
    poetStats[poet].total++;
    if (seen.has(getPoemId(poem))) poetStats[poet].seen++;
  }

  const poetsWithSeen = Object.entries(poetStats)
    .filter(([_, stats]) => stats.seen > 0)
    .sort((a, b) => b[1].seen - a[1].seen);

  document.getElementById('artist-list').innerHTML = poetsWithSeen.length > 0
    ? poetsWithSeen.map(([name, stats]) => {
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
    : '<p style="color: #666;">No poems read yet</p>';
}

// LocalStorage
function loadSeen() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      seen = new Set(JSON.parse(data));
      console.log(`Loaded ${seen.size} read poems`);
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

function loadAlbums() {
  try {
    const data = localStorage.getItem(ALBUMS_KEY);
    if (data) {
      albums = JSON.parse(data);
      console.log(`Loaded ${albums.length} collections`);
    } else {
      albums = JSON.parse(JSON.stringify(DEFAULT_ALBUMS));
      saveAlbums();
    }
  } catch (e) {
    console.error('Failed to load collections:', e);
    albums = JSON.parse(JSON.stringify(DEFAULT_ALBUMS));
  }
}

function saveAlbums() {
  try {
    localStorage.setItem(ALBUMS_KEY, JSON.stringify(albums));
  } catch (e) {
    console.error('Failed to save collections:', e);
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
    type: 'poetry',
    exportDate: new Date().toISOString(),
    seen: [...seen],
    albums: albums
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `poetry-backup-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

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

      backupInfo.lastBackup = new Date().toISOString();
      backupInfo.seenAtLastBackup = seen.size;
      saveBackupInfo();

      alert(`Imported successfully!\n- ${seen.size} poems read\n- ${albums.length} collections`);

      applySort();
      showCurrentPoem();
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
  document.getElementById('export-btn').addEventListener('click', exportData);
  document.getElementById('reminder-export-btn').addEventListener('click', exportData);

  document.getElementById('import-btn').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      importData(e.target.files[0]);
      e.target.value = '';
    }
  });

  document.getElementById('close-backup-reminder').addEventListener('click', hideBackupReminder);
  document.getElementById('reminder-later-btn').addEventListener('click', () => {
    backupInfo.seenAtLastBackup = seen.size - Math.floor(BACKUP_REMINDER_THRESHOLD / 2);
    saveBackupInfo();
    hideBackupReminder();
  });

  updateBackupDisplay();
}

// Start
init();
