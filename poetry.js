// Poetry App - Using Poetry Foundation data via Hugging Face

const STORAGE_KEY = 'poetry_seen';
const ALBUMS_KEY = 'poetry_albums';
const BACKUP_KEY = 'poetry_backup_info';
const BACKUP_REMINDER_THRESHOLD = 10; // Remind after 10 new saves

// Local poetry data (13,854 poems from Poetry Foundation)
const POEMS_DATA_URL = 'poems-data.json';
const TOTAL_POEMS = 13854;

let poems = [];
let poemsMap = {};
let orderedList = [];
let currentIndex = 0;
let seen = new Set();

// Collections
let albums = [];
let currentAlbumId = null;
let currentAlbumIndex = 0;
let currentAlbumPoemId = null; // the poem actually on screen in collection view

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Default collections
const DEFAULT_ALBUMS = [
  { id: 'favorites', name: 'Favorites', artworks: [] },
  { id: 'mood', name: 'Mood', artworks: [] },
  { id: 'inspiring', name: 'Inspiring', artworks: [] }
];

// Backup tracking
let backupInfo = {
  lastBackup: null,
  seenAtLastBackup: 0,
  savedAtLastBackup: 0
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
const albumCheckboxes = document.getElementById('album-checkboxes');

// Initialize
async function init() {
  loadBackupInfo();
  loadSeen();
  loadAlbums();
  await loadPoems();
  applySort();
  showCurrentPoem();
  setupControls();
  setupBackupControls();
  checkBackupReminder();
  // Ask the browser not to evict our data (helps on Android/Chrome; harmless elsewhere)
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}

// Fix encoding issues - garbled UTF-8 smart quotes, dashes, and accented characters
function fixEncoding(text) {
  if (!text) return '';

  // These patterns occur when UTF-8 is misinterpreted
  text = text.replace(/â€™/g, "'");      // right single quote
  text = text.replace(/â€˜/g, "'");      // left single quote
  text = text.replace(/â€œ/g, '"');      // left double quote
  text = text.replace(/â€/g, '"');       // right double quote (partial)
  text = text.replace(/â€"/g, '—');      // em-dash
  text = text.replace(/â€"/g, '–');      // en-dash
  text = text.replace(/â€¦/g, '...');    // ellipsis
  text = text.replace(/Ã¢â‚¬â„¢/g, "'"); // deeply garbled apostrophe
  text = text.replace(/Ã¢â‚¬/g, '"');    // deeply garbled quote

  // Garbled accented characters (UTF-8 interpreted as Latin-1)
  text = text.replace(/Ã©/g, 'é');       // e-acute
  text = text.replace(/Ã¨/g, 'è');       // e-grave
  text = text.replace(/Ã«/g, 'ë');       // e-umlaut
  text = text.replace(/Ãª/g, 'ê');       // e-circumflex
  text = text.replace(/Ã¡/g, 'á');       // a-acute
  text = text.replace(/Ã /g, 'à');       // a-grave
  text = text.replace(/Ã¤/g, 'ä');       // a-umlaut
  text = text.replace(/Ã¢/g, 'â');       // a-circumflex
  text = text.replace(/Ã­/g, 'í');       // i-acute
  text = text.replace(/Ã¬/g, 'ì');       // i-grave
  text = text.replace(/Ã¯/g, 'ï');       // i-umlaut
  text = text.replace(/Ã®/g, 'î');       // i-circumflex
  text = text.replace(/Ã³/g, 'ó');       // o-acute
  text = text.replace(/Ã²/g, 'ò');       // o-grave
  text = text.replace(/Ã¶/g, 'ö');       // o-umlaut
  text = text.replace(/Ã´/g, 'ô');       // o-circumflex
  text = text.replace(/Ãº/g, 'ú');       // u-acute
  text = text.replace(/Ã¹/g, 'ù');       // u-grave
  text = text.replace(/Ã¼/g, 'ü');       // u-umlaut
  text = text.replace(/Ã»/g, 'û');       // u-circumflex
  text = text.replace(/Ã±/g, 'ñ');       // n-tilde
  text = text.replace(/Ã§/g, 'ç');       // c-cedilla

  // Clean up any remaining garbled sequences (â followed by box/special characters)
  text = text.replace(/â[\u0080-\u00FF][\u0080-\u00FF]/g, "'");
  text = text.replace(/â\s*□\s*□/g, "'");
  text = text.replace(/â€[^a-zA-Z]/g, "'"); // catch remaining variants

  return text;
}

// Clean up poem content - fix encoding and line breaks
function cleanPoemContent(content) {
  if (!content) return '';

  // Fix encoding issues
  content = fixEncoding(content);

  // Normalize line breaks - handle \r\r\n pattern in the data
  content = content.replace(/\r\r\n/g, '\n');
  content = content.replace(/\r\n/g, '\n');
  content = content.replace(/\r/g, '\n');

  // Some poems use multiple spaces (2+) as line separators instead of newlines
  // Convert these to newlines
  content = content.replace(/  +/g, '\n');

  // Fix concatenated words where line breaks were stripped
  // Pattern 1: lowercase followed by uppercase (e.g., "fittingArtemisia" → "fitting\nArtemisia")
  content = content.replace(/([a-z])([A-Z])/g, '$1\n$2');

  // Pattern 2: common line-ending punctuation followed by letter without space
  content = content.replace(/([.!?;:,])([A-Za-z])/g, '$1\n$2');

  // Pattern 3: words concatenated with common line-starting words
  // VERY CONSERVATIVE - only use words that rarely end legitimate English words
  // Words like "it", "at", "in", "an", "be", "one", "or", "is" are TOO DANGEROUS
  // because they appear at the end of many words (wait, what, rain, can, maybe, done, for, this)
  const safeLineStarters = 'the|and|for|with|from|they|your|their|have|would|could|should|because|through|between|without|before|after|under|over|about|these|those|which|where|while|during|against|toward|upon|within|beyond|behind|below|above|across|along|among|around|beneath|beside|despite|except|inside|outside|unlike|until|throughout|whenever|wherever|however|whatever|whoever|although|whereas|whereby|wherein|therefore|furthermore|moreover|nevertheless|nonetheless|otherwise|meanwhile|afterwards|beforehand|henceforth|thereafter|whereupon';

  // Only apply to longer words (10+ chars) to catch concatenations like "perturbationsof"
  const lineStarterRegex = new RegExp(`^(.{4,})(${safeLineStarters})$`, 'i');
  content = content.split(/(\s+)/).map(part => {
    if (/^\s+$/.test(part)) return part;
    // Only try splitting longer words
    if (part.length < 10) return part;
    const match = part.match(lineStarterRegex);
    if (match) {
      return match[1] + '\n' + match[2];
    }
    return part;
  }).join('');

  // Collapse multiple consecutive newlines into double newline (stanza break)
  content = content.replace(/\n{3,}/g, '\n\n');

  // Trim leading/trailing whitespace from each line
  const lines = content.split('\n');
  const cleanedLines = lines.map(line => line.trim());

  // Remove leading and trailing empty lines, but preserve internal stanza breaks
  let start = 0;
  let end = cleanedLines.length - 1;
  while (start < cleanedLines.length && !cleanedLines[start]) start++;
  while (end >= 0 && !cleanedLines[end]) end--;

  const trimmedLines = cleanedLines.slice(start, end + 1);

  return trimmedLines.join('\n');
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
        title: fixEncoding((item.title || 'Untitled').trim()),
        author: fixEncoding((item.author || 'Unknown').trim()),
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

  // The save panel belongs to one poem; never leave it open on another
  savePanel.classList.add('hidden');

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
    // Typing in a text box (note, collection name) must never trigger
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

  // Another tab changed the collections: pick that up so we never write back stale data
  window.addEventListener('storage', (e) => {
    if (e.key === ALBUMS_KEY) {
      refreshAlbums();
      if (albumsView.classList.contains('active')) renderAlbumsList();
      if (albumDetailView.classList.contains('active')) renderAlbumDetail();
      if (!savePanel.classList.contains('hidden')) renderAlbumCheckboxes();
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
  refreshAlbums();
  const album = albums.find(a => a.id === currentAlbumId);
  const poemId = currentAlbumPoemId;
  if (!album || !poemId) return;

  const currentNote = album.notes && album.notes[poemId] || '';

  document.getElementById('edit-note-input').value = currentNote;
  document.getElementById('edit-note-modal').classList.remove('hidden');
}

function closeNoteModal() {
  document.getElementById('edit-note-modal').classList.add('hidden');
}

// Notes are keyed by the poem on screen, not by index, so a change made
// in another tab can't shift the note onto a different poem
function setNoteForCurrent(note) {
  const poemId = currentAlbumPoemId;
  if (!poemId) return;
  updateAlbums(() => {
    const album = albums.find(a => a.id === currentAlbumId);
    if (!album || !album.artworks.includes(poemId)) return;
    if (!album.notes) album.notes = {};
    if (note) {
      album.notes[poemId] = note;
    } else {
      delete album.notes[poemId];
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

// Collection checkboxes
function renderAlbumCheckboxes() {
  const poem = getCurrentPoem();
  if (!poem) return;

  const poemId = getPoemId(poem);

  refreshAlbums();
  albumCheckboxes.innerHTML = albums.map(album => {
    const isIn = album.artworks.includes(poemId);
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
        console.error('Collection not found:', albumId);
        return;
      }

      if (cb.checked) {
        if (!album.artworks.includes(poemId)) {
          album.artworks.push(poemId);
        }
      } else {
        album.artworks = album.artworks.filter(id => id !== poemId);
        if (album.notes) {
          delete album.notes[poemId];
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
  refreshAlbums();
  list.innerHTML = albums.map(album => {
    const count = album.artworks.length;
    return `
      <div class="album-item" data-album-id="${escapeHtml(album.id)}">
        <div class="album-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="#666">
            <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
          </svg>
        </div>
        <div class="album-info">
          <div class="album-name">${escapeHtml(album.name)}</div>
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

  // Another tab may have shrunk this collection
  if (currentAlbumIndex >= album.artworks.length) {
    currentAlbumIndex = Math.max(0, album.artworks.length - 1);
  }
  currentAlbumPoemId = album.artworks[currentAlbumIndex] || null;

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
  const poemId = currentAlbumPoemId;
  const poem = poemsMap[poemId];

  if (!poem) {
    // Saved poem no longer in the data: say so (it can still be removed)
    poemEl.textContent = 'This poem is no longer in the collection';
    loadingEl.classList.add('hidden');
    noteContainer.classList.add('hidden');
    addNoteBtn.classList.add('hidden');
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
  refreshAlbums();
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;
  currentAlbumIndex = (currentAlbumIndex + 1) % album.artworks.length;
  renderAlbumDetail();
}

function prevInAlbum() {
  refreshAlbums();
  const album = albums.find(a => a.id === currentAlbumId);
  if (!album || album.artworks.length === 0) return;
  currentAlbumIndex = (currentAlbumIndex - 1 + album.artworks.length) % album.artworks.length;
  renderAlbumDetail();
}

function removeFromCurrentAlbum() {
  const poemId = currentAlbumPoemId;
  if (!poemId) return;

  updateAlbums(() => {
    const album = albums.find(a => a.id === currentAlbumId);
    if (!album) return;
    album.artworks = album.artworks.filter(id => id !== poemId);
    if (album.notes) delete album.notes[poemId];
  });
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
  refreshAlbums();
  list.innerHTML = albums.map(album => `
    <div class="edit-album-row" data-album-id="${escapeHtml(album.id)}">
      <input type="text" value="${escapeHtml(album.name)}" placeholder="Collection name" maxlength="12">
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
      if (confirm(`Delete "${album.name}"${n ? ` and its ${n} saved poem${n !== 1 ? 's' : ''}` : ''}?`)) {
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
              <span class="artist-name">${escapeHtml(name)}</span>
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

// replace=true writes exactly this set; otherwise merge with what other tabs
// have stored instead of overwriting it
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

// Re-read collections from storage so another tab's saves are never
// overwritten by this tab's stale in-memory copy
function refreshAlbums() {
  try {
    const data = localStorage.getItem(ALBUMS_KEY);
    if (data) albums = JSON.parse(data);
  } catch (e) {
    console.error('Failed to refresh collections:', e);
  }
}

// Every collection change goes through here: fresh read, change, save
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
      console.log(`Loaded ${albums.length} collections from localStorage`);
    } else {
      console.log('No collection data found, using defaults');
      albums = JSON.parse(JSON.stringify(DEFAULT_ALBUMS));
      saveAlbums();
    }
  } catch (e) {
    console.error('Failed to load collections:', e);
    albums = JSON.parse(JSON.stringify(DEFAULT_ALBUMS));
  }
}

function saveAlbums() {
  const data = JSON.stringify(albums);
  try {
    localStorage.setItem(ALBUMS_KEY, data);
  } catch (e) {
    // Storage full: the read-history is the big, replaceable part. Drop its
    // oldest half so the collections (irreplaceable) still save.
    try {
      const ids = [...seen];
      seen = new Set(ids.slice(Math.floor(ids.length / 2)));
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
      localStorage.setItem(ALBUMS_KEY, data);
    } catch (e2) {
      console.error('Failed to save collections:', e2);
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

// Remind based on saves (the part that can't be recreated), not on reading:
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
    type: 'poetry',
    exportDate: new Date().toISOString(),
    seen: [...seen],
    albums: albums
  };

  const json = JSON.stringify(data, null, 2);
  const name = `poetry-backup-${new Date().toISOString().split('T')[0]}.json`;
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
      if (data.type !== 'poetry') {
        alert('That isn’t a poetry backup (art backups go in the art section).');
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

      alert(`Imported!\n- ${added} poem${added !== 1 ? 's' : ''} added to collections\n- ${seen.size} poems read\nNothing already saved was removed.`);

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
  const unsaved = Math.max(0, countSaved() - backupInfo.savedAtLastBackup);
  if (backupInfo.lastBackup) {
    const date = new Date(backupInfo.lastBackup);
    textEl.textContent = `Last backup: ${date.toLocaleDateString()} (${unsaved} saved since then)`;
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
  document.getElementById('reminder-later-btn').addEventListener('click', snoozeBackupReminder);

  // Close backup reminder on backdrop click
  document.getElementById('backup-reminder').addEventListener('click', (e) => {
    if (e.target.id === 'backup-reminder') hideBackupReminder();
  });

  updateBackupDisplay();
}

// Start
init();
