// Sync between devices through a private GitHub gist in the owner's account.
// Each device pastes a GitHub key (classic token, "gist" scope only) once;
// after that, saves merge both ways automatically.
//
// Every add, removal, rename and note is timestamped in a ledger, so an add
// OR a removal on one device carries to the other and nothing is silently
// overwritten. Seen/read history just unions.

(function () {
  const TOKEN_KEY = 'sync_token';
  const GIST_KEY = 'sync_gist_id';
  const GIST_DESC = 'Art gallery sync (do not delete)';
  const API = 'https://api.github.com';
  const NEW_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=gist&description=Art%20gallery%20sync';

  let cfg = null;          // { app, albumsKey, seenKey, onMerged }
  let syncing = false;
  let again = false;       // a change came in while syncing
  let timer = null;
  let lastSync = null;
  let lastError = null;

  const fileName = () => cfg.app + '.json';
  const ledgerKey = () => cfg.app + '_sync_ledger';
  const viewKey = () => cfg.app + '_sync_view';
  const token = () => { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } };
  const readJSON = (k, fallback) => {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  };

  async function gh(path, opts = {}) {
    const res = await fetch(API + path, {
      ...opts,
      cache: 'no-store', // GitHub's API is cacheable for 60s; we always want fresh
      headers: {
        'Authorization': 'token ' + token(),
        'Accept': 'application/vnd.github+json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    if (res.status === 401) throw new Error('GitHub key was rejected (expired or revoked?)');
    return res;
  }

  // Find (or create) the one sync gist in this account
  async function gistId() {
    let id = localStorage.getItem(GIST_KEY);
    if (id) return id;
    for (let page = 1; page <= 10; page++) {
      const res = await gh(`/gists?per_page=100&page=${page}`);
      if (!res.ok) throw new Error('Could not list gists (' + res.status + ')');
      const list = await res.json();
      const found = list.find(g => g.description === GIST_DESC);
      if (found) { id = found.id; break; }
      if (list.length < 100) break;
    }
    if (!id) {
      const res = await gh('/gists', {
        method: 'POST',
        body: JSON.stringify({
          description: GIST_DESC,
          public: false,
          files: { 'README.md': { content: 'Synced albums for the art gallery and poetry pages. Do not delete.' } }
        })
      });
      if (!res.ok) throw new Error('Could not create sync storage (' + res.status + ')');
      id = (await res.json()).id;
    }
    localStorage.setItem(GIST_KEY, id);
    return id;
  }

  async function readRemote(id) {
    const res = await gh('/gists/' + id);
    if (res.status === 404) { localStorage.removeItem(GIST_KEY); throw new Error('Sync storage not found; try again'); }
    if (!res.ok) throw new Error('Could not read sync data (' + res.status + ')');
    const f = (await res.json()).files[fileName()];
    if (!f) return null;
    let content = f.content;
    if (f.truncated) content = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
    return JSON.parse(content);
  }

  // ---- merge: a timestamped ledger of every add/remove/rename/note ----
  // Each device keeps a ledger; merging two ledgers keeps the newest stamp for
  // everything, so the result is the same in whatever order devices sync, and
  // a save can't vanish even if two devices upload at the same moment (the
  // overwritten device still has it in its ledger and re-uploads it).
  function emptyLedger() { return { clock: 0, albums: {} }; }
  const byId = arr => Object.fromEntries((arr || []).map(a => [a.id, a]));
  const newer = (x, y) => (x.t > y.t || (x.t === y.t && String(x.v) > String(y.v))) ? x : y;

  // Stamp whatever changed locally since the last sync (`view` = what the
  // last sync left on screen)
  function recordLocal(ledger, view, local, initial) {
    const ts = initial ? 1 : Math.max(Date.now(), ledger.clock + 1);
    const V = byId(view), Lc = byId(local);
    for (const a of local) {
      const v = V[a.id];
      const e = ledger.albums[a.id] || (ledger.albums[a.id] = { name: { v: a.name, t: 0 }, created: 0, deleted: -1, items: {}, notes: {} });
      if (!v) e.created = Math.max(e.created, e.deleted + 1, ts);
      if (!v || v.name !== a.name) e.name = { v: a.name, t: ts };
      const vItems = new Set(v ? v.artworks : []), lItems = new Set(a.artworks);
      for (const x of lItems) if (!vItems.has(x)) {
        const it = e.items[x] || (e.items[x] = { a: 0, r: -1 });
        it.a = Math.max(it.a, it.r + 1, ts);
      }
      for (const x of vItems) if (!lItems.has(x)) {
        const it = e.items[x] || (e.items[x] = { a: 0, r: -1 });
        it.r = Math.max(it.r, it.a, ts);
      }
      const vn = (v && v.notes) || {}, ln = a.notes || {};
      for (const k of new Set([...Object.keys(vn), ...Object.keys(ln)])) {
        if ((ln[k] || '') !== (vn[k] || '')) e.notes[k] = { v: ln[k] || '', t: ts };
      }
    }
    for (const v of view) {
      if (!Lc[v.id] && ledger.albums[v.id]) {
        const e = ledger.albums[v.id];
        e.deleted = Math.max(e.deleted, e.created, ts);
      }
    }
    ledger.clock = Math.max(ledger.clock, ts);
    return ledger;
  }

  function mergeLedgers(A, B) {
    const out = { clock: Math.max(A.clock || 0, B.clock || 0), albums: {} };
    for (const id of new Set([...Object.keys(A.albums), ...Object.keys(B.albums)])) {
      const x = A.albums[id], y = B.albums[id];
      if (!x || !y) { out.albums[id] = JSON.parse(JSON.stringify(x || y)); continue; }
      const items = {};
      for (const k of new Set([...Object.keys(x.items), ...Object.keys(y.items)])) {
        const p = x.items[k] || { a: 0, r: -1 }, q = y.items[k] || { a: 0, r: -1 };
        items[k] = { a: Math.max(p.a, q.a), r: Math.max(p.r, q.r) };
      }
      const notes = {};
      for (const k of new Set([...Object.keys(x.notes), ...Object.keys(y.notes)])) {
        notes[k] = !x.notes[k] ? y.notes[k] : !y.notes[k] ? x.notes[k] : newer(x.notes[k], y.notes[k]);
      }
      out.albums[id] = {
        name: newer(x.name, y.name),
        created: Math.max(x.created, y.created),
        deleted: Math.max(x.deleted, y.deleted),
        items, notes
      };
    }
    return out;
  }

  // Turn the ledger back into the app's albums, keeping this device's order
  function materialize(ledger, local) {
    const alive = id => { const e = ledger.albums[id]; return e && e.created > e.deleted; };
    const L = byId(local);
    const ids = local.map(a => a.id).filter(alive);
    const extra = Object.keys(ledger.albums).filter(id => alive(id) && !L[id])
      .sort((p, q) => ledger.albums[p].created - ledger.albums[q].created || (p < q ? -1 : 1));
    return [...ids, ...extra].map(id => {
      const e = ledger.albums[id];
      const has = k => e.items[k] && e.items[k].a > e.items[k].r;
      const mine = (L[id] ? L[id].artworks : []).filter(has);
      const mineSet = new Set(mine);
      const others = Object.keys(e.items).filter(k => has(k) && !mineSet.has(k))
        .sort((p, q) => e.items[p].a - e.items[q].a);
      const artworks = [...mine, ...others];
      const album = { id, name: e.name.v, artworks };
      const notes = {};
      for (const k of artworks) if (e.notes[k] && e.notes[k].v) notes[k] = e.notes[k].v;
      if (Object.keys(notes).length) album.notes = notes;
      return album;
    });
  }

  let verifyTimer = null;

  async function syncNow() {
    if (!cfg || !token()) return;
    if (syncing) { again = true; return; }
    syncing = true;
    try {
      do {
        again = false;
        const id = await gistId();
        const remote = await readRemote(id);

        // No awaits from here to the local write, so a save made meanwhile
        // can't be lost (it either lands before this read or triggers `again`)
        const localAlbums = readJSON(cfg.albumsKey, []);
        const localSeen = readJSON(cfg.seenKey, []);
        let ledger = readJSON(ledgerKey(), null);
        const initial = !ledger;
        if (initial) ledger = emptyLedger();
        recordLocal(ledger, initial ? [] : readJSON(viewKey(), []), localAlbums, initial);
        const merged = remote && remote.ledger ? mergeLedgers(ledger, remote.ledger) : ledger;
        const albums = materialize(merged, localAlbums);
        const seen = [...new Set([...localSeen, ...((remote && remote.seen) || [])])];

        const albumsJSON = JSON.stringify(albums), ledgerJSON = JSON.stringify(merged);
        const changedHere = albumsJSON !== JSON.stringify(localAlbums) || seen.length !== localSeen.length;
        localStorage.setItem(cfg.albumsKey, albumsJSON);
        localStorage.setItem(cfg.seenKey, JSON.stringify(seen));
        localStorage.setItem(ledgerKey(), ledgerJSON);
        localStorage.setItem(viewKey(), albumsJSON);
        if (changedHere && cfg.onMerged) cfg.onMerged();

        const remoteDiffers = !remote || JSON.stringify(remote.ledger) !== ledgerJSON ||
          (remote.seen || []).length !== seen.length;
        if (remoteDiffers) {
          const res = await gh('/gists/' + id, {
            method: 'PATCH',
            body: JSON.stringify({ files: { [fileName()]: { content: JSON.stringify({ ledger: merged, seen, updatedAt: new Date().toISOString() }) } } })
          });
          if (!res.ok) throw new Error('Could not save sync data (' + res.status + ')');
          // Check back shortly: if another device uploaded at the same moment
          // and overwrote this, the next sync puts our changes back
          clearTimeout(verifyTimer);
          // (random delay so two devices that collided don't collide again)
          verifyTimer = setTimeout(syncNow, 2500 + Math.random() * 5000);
        }
      } while (again);
      lastSync = new Date();
      lastError = null;
    } catch (e) {
      console.error('Sync failed:', e);
      lastError = navigator.onLine ? e.message : 'Offline — will sync when you’re back online';
    } finally {
      syncing = false;
      renderStatus();
    }
  }

  // Called after every album save: sync shortly after the last change
  function changed() {
    if (!token()) return;
    clearTimeout(timer);
    timer = setTimeout(syncNow, 1500);
  }

  async function connect(key) {
    key = (key || '').trim();
    if (!key) return 'Paste your key first';
    const res = await fetch(API + '/user', { cache: 'no-store', headers: { 'Authorization': 'token ' + key } });
    if (!res.ok) return 'That key didn’t work. Check you copied all of it.';
    const scopes = res.headers.get('x-oauth-scopes');
    if (scopes !== null && !scopes.split(',').map(s => s.trim()).includes('gist')) {
      return 'That key is missing the “gist” permission. Make a new one with the link above.';
    }
    localStorage.setItem(TOKEN_KEY, key);
    localStorage.removeItem(GIST_KEY);
    startAuto();
    await syncNow();
    return lastError;
  }

  function disconnect() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(GIST_KEY);
    localStorage.removeItem(ledgerKey());
    localStorage.removeItem(viewKey());
    lastSync = null;
    lastError = null;
    renderStatus();
  }

  // ---- UI: a "Sync" section on the Progress screen + a connect popup ----
  function renderStatus() {
    const el = document.getElementById('sync-status');
    if (!el) return;
    const on = !!token();
    document.getElementById('sync-connect-btn').classList.toggle('hidden', on);
    document.getElementById('sync-now-btn').classList.toggle('hidden', !on);
    document.getElementById('sync-off-btn').classList.toggle('hidden', !on);
    if (!on) el.textContent = 'Not syncing. Connect to share saves between your phone and laptop.';
    else if (syncing) el.textContent = 'Syncing…';
    else if (lastError) el.textContent = 'Sync problem: ' + lastError;
    else if (lastSync) el.textContent = 'Synced at ' + lastSync.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    else el.textContent = 'Connected.';
  }

  function buildUI() {
    const stats = document.getElementById('stats-content');
    if (!stats || document.getElementById('sync-section')) return;
    const section = document.createElement('div');
    section.id = 'sync-section';
    section.className = 'stat-section';
    section.innerHTML = `
      <h2>Sync</h2>
      <p id="sync-status"></p>
      <div class="backup-buttons">
        <button id="sync-connect-btn" class="action-btn">Connect</button>
        <button id="sync-now-btn" class="action-btn hidden">Sync Now</button>
        <button id="sync-off-btn" class="action-btn secondary hidden">Disconnect</button>
      </div>`;
    stats.insertBefore(section, document.getElementById('backup-section'));

    const modal = document.createElement('div');
    modal.id = 'sync-modal';
    modal.className = 'modal hidden';
    modal.innerHTML = `
      <div class="modal-content">
        <div class="modal-header">
          <h2>Connect sync</h2>
          <button id="close-sync-modal" class="icon-btn small">×</button>
        </div>
        <p style="color: #888; margin-bottom: 12px; font-size: 14px;">Paste your GitHub sync key. You only do this once per device.</p>
        <p style="color: #888; margin-bottom: 16px; font-size: 13px;">No key yet? <a href="${NEW_TOKEN_URL}" target="_blank" rel="noopener" style="color: #ccc; text-decoration: underline;">Make one here</a>: set Expiration to “No expiration”, keep only “gist” ticked, Generate, then copy it.</p>
        <input type="password" id="sync-key-input" placeholder="ghp_..." autocomplete="off" style="width: 100%; padding: 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; color: #ddd; margin-bottom: 12px; font-family: inherit;">
        <p id="sync-modal-msg" style="color: #c99; font-size: 13px; min-height: 1em; margin-bottom: 12px;"></p>
        <button id="sync-key-save" class="action-btn">Connect</button>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.classList.add('hidden');
    document.getElementById('sync-connect-btn').addEventListener('click', () => {
      document.getElementById('sync-modal-msg').textContent = '';
      document.getElementById('sync-key-input').value = '';
      modal.classList.remove('hidden');
    });
    document.getElementById('close-sync-modal').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.getElementById('sync-key-save').addEventListener('click', async () => {
      const msg = document.getElementById('sync-modal-msg');
      msg.textContent = 'Connecting…';
      const err = await connect(document.getElementById('sync-key-input').value);
      if (err) { msg.textContent = err; return; }
      close();
    });
    document.getElementById('sync-now-btn').addEventListener('click', syncNow);
    document.getElementById('sync-off-btn').addEventListener('click', () => {
      if (confirm('Stop syncing on this device? Your saves stay here and online.')) disconnect();
    });
    renderStatus();
  }

  let autoStarted = false;
  function startAuto() {
    if (autoStarted) return;
    autoStarted = true;
    // Pull the other device's changes whenever the app comes back to the front
    document.addEventListener('visibilitychange', () => {
      if (token()) syncNow();   // visible: pull; hidden: push before the app is put away
    });
    window.addEventListener('online', () => { if (token()) syncNow(); });
    // Reading history piggybacks; push it every few minutes while open
    setInterval(() => { if (token() && document.visibilityState === 'visible') syncNow(); }, 5 * 60 * 1000);
  }

  function init(options) {
    cfg = options;
    buildUI();
    if (!token()) return;
    startAuto();
    syncNow();
  }

  window.Sync = { init, changed, syncNow, isOn: () => !!token() && !lastError, _merge: { recordLocal, mergeLedgers, materialize } };
})();
