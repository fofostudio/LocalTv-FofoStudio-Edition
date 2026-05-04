/**
 * Capa de datos local para Android (Capacitor).
 *
 * Tiene DOS backends con la misma interfaz:
 *
 *   1. SQLite (vía @capacitor-community/sqlite) — más rápido y "correcto",
 *      pero el plugin tiene problemas conocidos de estado en Android
 *      (zombies después de hot-reload, "already exist", "execute not
 *      available connection", etc.).
 *
 *   2. localStorage — bullet-proof. Storage estándar del WebView, sin
 *      plugin nativo, soporte universal en cualquier Android. 5-10 MB
 *      de límite (96 canales serializados pesan ~70 KB, hay margen).
 *
 * En init() intentamos SQLite primero. Si falla por cualquier razón,
 * caemos a localStorage de forma transparente. Si una operación
 * posterior tira un error del plugin SQLite, también caemos a
 * localStorage en runtime y reintentamos. La app SIEMPRE funciona.
 *
 * Race-condition safe: usamos singleton de promesa, no de resultado,
 * para que múltiples componentes que llaman al mismo tiempo no
 * dispararen dos inits paralelos.
 */

const DB_NAME = 'localtv';
const DB_VERSION = 1;

// localStorage keys
const LS_CHANNELS  = 'localtv:channels';
const LS_FAVORITES = 'localtv:favorites';
const LS_CATEGORIES = 'localtv:categories';

// Estado del módulo
let _backendName = null;       // 'sqlite' | 'localStorage'
let _backend = null;           // referencia al backend activo
let _initPromise = null;       // singleton de la promesa de init

// ---------------------------------------------------------------------------
// init() público con singleton de promesa
// ---------------------------------------------------------------------------
async function ensureBackend() {
  if (_backend) return _backend;
  if (!_initPromise) {
    _initPromise = (async () => {
      // Intento 1: SQLite
      try {
        await sqliteBackend.init();
        _backend = sqliteBackend;
        _backendName = 'sqlite';
        console.log('[mobileDb] backend activo: sqlite');
        return _backend;
      } catch (e) {
        console.warn(
          '[mobileDb] SQLite no disponible, fallback a localStorage. Razón:',
          e?.message || e,
        );
      }
      // Fallback: localStorage
      await localStorageBackend.init();
      _backend = localStorageBackend;
      _backendName = 'localStorage';
      console.log('[mobileDb] backend activo: localStorage');
      return _backend;
    })().catch((e) => {
      // Si init falla por completo, NO cachear la promesa rota
      _initPromise = null;
      throw e;
    });
  }
  return _initPromise;
}

/**
 * Wrapper que llama a una operación del backend. Si el backend SQLite tira un
 * error (cualquier mensaje "connection", "execute", "database"), abandonamos
 * SQLite, migramos a localStorage al vuelo y reintentamos UNA vez.
 */
async function withBackend(opName, op) {
  const b = await ensureBackend();
  try {
    return await op(b);
  } catch (e) {
    const msg = String(e?.message || e).toLowerCase();
    const isFlakySqliteErr =
      _backendName === 'sqlite' &&
      (msg.includes('connection') || msg.includes('execute') ||
       msg.includes('database') || msg.includes('not available') ||
       msg.includes('already exist'));
    if (!isFlakySqliteErr) throw e;

    console.warn(`[mobileDb] ${opName} falló en sqlite (${msg}); migrando a localStorage en caliente`);
    try { await sqliteBackend.shutdown(); } catch (_) { /* ignore */ }
    await localStorageBackend.init();
    _backend = localStorageBackend;
    _backendName = 'localStorage';
    return op(localStorageBackend);
  }
}

// ===========================================================================
// SQLite backend
// ===========================================================================
const sqliteBackend = {
  _sqlite: null,
  _db: null,

  async init() {
    const cap = window.Capacitor;
    if (!cap?.Plugins?.CapacitorSQLite) {
      throw new Error('CapacitorSQLite no disponible');
    }
    const { SQLiteConnection } = await import('@capacitor-community/sqlite');
    this._sqlite = new SQLiteConnection(cap.Plugins.CapacitorSQLite);
    const sqlite = this._sqlite;

    // 1) Reconciliar estado interno con el SO (limpia ghosts entre arranques)
    try { await sqlite.checkConnectionsConsistency(); }
    catch (e) { console.warn('[sqlite] checkConnectionsConsistency:', e?.message || e); }

    // 2) Cerrar conexión zombie si existe
    try {
      const exists = (await sqlite.isConnection(DB_NAME, false))?.result;
      if (exists) {
        try { await sqlite.closeConnection(DB_NAME, false); } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }

    // 3) Crear conexión fresca con reintentos
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        this._db = await sqlite.createConnection(
          DB_NAME, false, 'no-encryption', DB_VERSION, false,
        );
        break;
      } catch (e) {
        lastErr = e;
        const m = String(e?.message || e).toLowerCase();
        if (m.includes('already') || m.includes('exist')) {
          try { await sqlite.closeConnection(DB_NAME, false); } catch (_) {}
          // continuar al próximo intento
          continue;
        }
        // error desconocido — no reintentamos
        throw e;
      }
    }
    if (!this._db) throw lastErr || new Error('createConnection falló');

    // 4) Abrir (absorbiendo "already open")
    try { await this._db.open(); }
    catch (e) {
      const m = String(e?.message || e).toLowerCase();
      if (!(m.includes('open') || m.includes('already'))) throw e;
    }

    // 5) Sanity check con SELECT 1 — confirma que execute() responde
    await this._db.execute('SELECT 1');

    // 6) Schema + seed
    await this._ensureSchema();
  },

  async shutdown() {
    if (this._sqlite) {
      try { await this._sqlite.closeConnection(DB_NAME, false); } catch (_) {}
    }
    this._db = null;
    this._sqlite = null;
  },

  async _ensureSchema() {
    const db = this._db;
    await db.execute(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        icon TEXT
      );
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        stream_url TEXT NOT NULL,
        logo_url TEXT,
        category_id INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_channels_slug ON channels(slug);
      CREATE INDEX IF NOT EXISTS idx_channels_active ON channels(is_active);
      CREATE TABLE IF NOT EXISTS favorites (
        slug TEXT PRIMARY KEY
      );
    `);

    const r = await db.query('SELECT COUNT(*) as n FROM channels');
    const n = r?.values?.[0]?.n ?? 0;
    if (n === 0) await this._seedInitial();
  },

  async _seedInitial() {
    const db = this._db;
    await db.run(
      `INSERT OR IGNORE INTO categories (id, name, slug, icon) VALUES (1, 'Deportes', 'deportes', 'fa-futbol')`,
    );
    const seed = await loadSeed();
    if (!seed?.channels?.length) return;
    const STMT = `INSERT OR IGNORE INTO channels (name, slug, stream_url, logo_url, category_id, is_active)
                  VALUES (?, ?, ?, ?, ?, ?)`;
    const set = seed.channels.map((c) => ({
      statement: STMT,
      values: [
        c.name,
        c.slug,
        c.stream_url || `https://tvtvhd.com/vivo/canales.php?stream=${c.slug}`,
        c.logo_url || null,
        c.category_id || 1,
        c.is_active === false ? 0 : 1,
      ],
    }));
    await db.executeSet(set);
    console.log(`[sqlite] seed inicial: ${set.length} canales`);
  },

  async getChannels() {
    const r = await this._db.query(
      `SELECT id, name, slug, stream_url, logo_url, category_id,
              CASE WHEN is_active = 1 THEN 1 ELSE 0 END as is_active
       FROM channels ORDER BY name`,
    );
    return (r.values || []).map((row) => ({ ...row, is_active: row.is_active === 1 }));
  },

  async getCategories() {
    const r = await this._db.query('SELECT id, name, slug, icon FROM categories ORDER BY id');
    return r.values || [];
  },

  async getFavorites() {
    const r = await this._db.query('SELECT slug FROM favorites');
    return new Set((r.values || []).map((row) => row.slug));
  },

  async toggleFavorite(slug) {
    const r = await this._db.query('SELECT 1 FROM favorites WHERE slug = ?', [slug]);
    if (r.values?.length) {
      await this._db.run('DELETE FROM favorites WHERE slug = ?', [slug]);
      return false;
    }
    await this._db.run('INSERT INTO favorites (slug) VALUES (?)', [slug]);
    return true;
  },

  async upsertChannels(scraped) {
    let created = 0, updated = 0;
    for (const ch of scraped) {
      const found = await this._db.query('SELECT id, stream_url FROM channels WHERE slug = ?', [ch.slug]);
      if (found.values?.length) {
        if (found.values[0].stream_url !== ch.stream_url) {
          await this._db.run('UPDATE channels SET stream_url = ? WHERE slug = ?', [ch.stream_url, ch.slug]);
          updated += 1;
        }
      } else {
        await this._db.run(
          'INSERT INTO channels (name, slug, stream_url, category_id, is_active) VALUES (?, ?, ?, 1, 1)',
          [ch.name, ch.slug, ch.stream_url],
        );
        created += 1;
      }
    }
    return { created, updated, total_scraped: scraped.length };
  },

  async setChannelActive(slug, active) {
    await this._db.run('UPDATE channels SET is_active = ? WHERE slug = ?', [active ? 1 : 0, slug]);
  },
};

// ===========================================================================
// localStorage backend (fallback bullet-proof)
// ===========================================================================
const localStorageBackend = {
  async init() {
    // Si ya hay datos del backend SQLite anterior que migramos, los preservamos
    if (!localStorage.getItem(LS_CHANNELS)) {
      const seed = await loadSeed();
      const channels = (seed?.channels || []).map((c, i) => ({
        id: i + 1,
        name: c.name,
        slug: c.slug,
        stream_url: c.stream_url || `https://tvtvhd.com/vivo/canales.php?stream=${c.slug}`,
        logo_url: c.logo_url || null,
        category_id: c.category_id || 1,
        is_active: c.is_active !== false,
      }));
      localStorage.setItem(LS_CHANNELS, JSON.stringify(channels));
      console.log(`[localStorage] seed inicial: ${channels.length} canales`);
    }
    if (!localStorage.getItem(LS_CATEGORIES)) {
      localStorage.setItem(LS_CATEGORIES, JSON.stringify([
        { id: 1, name: 'Deportes', slug: 'deportes', icon: 'fa-futbol' },
      ]));
    }
    if (!localStorage.getItem(LS_FAVORITES)) {
      localStorage.setItem(LS_FAVORITES, JSON.stringify([]));
    }
  },

  async shutdown() { /* no-op */ },

  async getChannels() {
    return JSON.parse(localStorage.getItem(LS_CHANNELS) || '[]');
  },

  async getCategories() {
    return JSON.parse(localStorage.getItem(LS_CATEGORIES) || '[]');
  },

  async getFavorites() {
    const arr = JSON.parse(localStorage.getItem(LS_FAVORITES) || '[]');
    return new Set(arr);
  },

  async toggleFavorite(slug) {
    const arr = JSON.parse(localStorage.getItem(LS_FAVORITES) || '[]');
    const idx = arr.indexOf(slug);
    if (idx >= 0) {
      arr.splice(idx, 1);
      localStorage.setItem(LS_FAVORITES, JSON.stringify(arr));
      return false;
    }
    arr.push(slug);
    localStorage.setItem(LS_FAVORITES, JSON.stringify(arr));
    return true;
  },

  async upsertChannels(scraped) {
    const channels = JSON.parse(localStorage.getItem(LS_CHANNELS) || '[]');
    const bySlug = new Map(channels.map((c) => [c.slug, c]));
    let created = 0, updated = 0;
    let nextId = channels.reduce((m, c) => Math.max(m, c.id || 0), 0) + 1;
    for (const ch of scraped) {
      const existing = bySlug.get(ch.slug);
      if (existing) {
        if (existing.stream_url !== ch.stream_url) {
          existing.stream_url = ch.stream_url;
          updated += 1;
        }
      } else {
        bySlug.set(ch.slug, {
          id: nextId++,
          name: ch.name,
          slug: ch.slug,
          stream_url: ch.stream_url,
          logo_url: null,
          category_id: 1,
          is_active: true,
        });
        created += 1;
      }
    }
    localStorage.setItem(LS_CHANNELS, JSON.stringify([...bySlug.values()]));
    return { created, updated, total_scraped: scraped.length };
  },

  async setChannelActive(slug, active) {
    const channels = JSON.parse(localStorage.getItem(LS_CHANNELS) || '[]');
    const ch = channels.find((c) => c.slug === slug);
    if (ch) {
      ch.is_active = !!active;
      localStorage.setItem(LS_CHANNELS, JSON.stringify(channels));
    }
  },
};

// ===========================================================================
// Helpers compartidos
// ===========================================================================
async function loadSeed() {
  try {
    const res = await fetch('/public-seed/channels.json');
    if (res.ok) return res.json();
  } catch (_) { /* sigue */ }
  // Fallback: GitHub raw
  try {
    const res = await fetch(
      'https://raw.githubusercontent.com/fofostudio/LocalTv-FofoStudio-Edition/main/mobile/public-seed/channels.json',
    );
    if (res.ok) return res.json();
  } catch (_) { /* sigue */ }
  console.warn('[mobileDb] No se pudo cargar el seed inicial');
  return { channels: [] };
}

// ===========================================================================
// API pública (mismas firmas que antes)
// ===========================================================================
export async function getChannels() {
  return withBackend('getChannels', (b) => b.getChannels());
}

export async function getCategories() {
  return withBackend('getCategories', (b) => b.getCategories());
}

export async function getFavorites() {
  return withBackend('getFavorites', (b) => b.getFavorites());
}

export async function toggleFavorite(slug) {
  return withBackend('toggleFavorite', (b) => b.toggleFavorite(slug));
}

export async function upsertChannels(scraped) {
  return withBackend('upsertChannels', (b) => b.upsertChannels(scraped));
}

export async function setChannelActive(slug, active) {
  return withBackend('setChannelActive', (b) => b.setChannelActive(slug, active));
}

/** Para diagnóstico — útil para mostrar en la UI cuál backend está activo. */
export function getActiveBackend() {
  return _backendName;
}
