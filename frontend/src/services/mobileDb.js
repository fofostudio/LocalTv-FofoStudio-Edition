/**
 * Capa SQLite local para la app móvil (Capacitor).
 * Usa @capacitor-community/sqlite. En primera ejecución carga el seed de
 * 96 canales desde public-seed/channels.json.
 *
 * Esta capa es el equivalente del backend FastAPI: provee la misma forma de
 * datos que /api/channels/, /api/categories/, etc., pero offline.
 *
 * Solo se importa desde mobileApi.js (que sólo se usa cuando isCapacitor()).
 */

const DB_NAME = 'localtv';
const DB_VERSION = 1;

let _sqlite = null;     // SQLiteConnection singleton del plugin
let _db = null;         // SQLiteDBConnection abierta

async function getSqlite() {
  if (_sqlite) return _sqlite;
  const cap = window.Capacitor;
  if (!cap?.Plugins?.CapacitorSQLite) {
    throw new Error('Plugin @capacitor-community/sqlite no está disponible');
  }
  const { SQLiteConnection } = await import('@capacitor-community/sqlite');
  _sqlite = new SQLiteConnection(cap.Plugins.CapacitorSQLite);
  return _sqlite;
}

async function openDb() {
  if (_db) return _db;
  const sqlite = await getSqlite();

  // Estrategia: matar todas las conexiones zombie y crear una fresca.
  // El plugin @capacitor-community/sqlite tiene varios estados internos
  // (registrada / abierta / consistente con el SO) que se desincronizan
  // tras hot-reloads del WebView. Reusar conexiones viejas tira errores
  // intermitentes ("Connection already exist", "execute not available
  // connection"). Crear de cero es lo único determinístico.

  // 1) Reconciliar estado interno del plugin (limpia ghosts del SO)
  try { await sqlite.checkConnectionsConsistency(); }
  catch (e) { console.warn('[mobileDb] checkConnectionsConsistency:', e?.message || e); }

  // 2) Cerrar la conexión registrada si la hubiera
  try {
    const exists = (await sqlite.isConnection(DB_NAME, false))?.result;
    if (exists) {
      try { await sqlite.closeConnection(DB_NAME, false); } catch (_) { /* ignore */ }
    }
  } catch (_) { /* ignore */ }

  // 3) Crear y abrir una conexión fresca
  try {
    _db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
  } catch (e) {
    // Si todavía dice "already exist" después del close, hacemos un último intento
    const msg = String(e?.message || e).toLowerCase();
    if (msg.includes('already') || msg.includes('exist')) {
      try { await sqlite.closeConnection(DB_NAME, false); } catch (_) {}
      _db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
    } else {
      throw e;
    }
  }

  // 4) Asegurar abierta. open() falla si ya estaba abierta — lo absorbemos.
  try { await _db.open(); }
  catch (e) {
    const msg = String(e?.message || e).toLowerCase();
    if (!(msg.includes('open') || msg.includes('already'))) throw e;
  }

  // 5) Sanity check: si execute() no responde acá, algo del plugin se rompió
  //    irrecuperablemente — cerramos todo y avisamos.
  try {
    await _db.execute('SELECT 1');
  } catch (e) {
    console.error('[mobileDb] sanity SELECT 1 falló, recreando:', e?.message || e);
    try { await sqlite.closeConnection(DB_NAME, false); } catch (_) {}
    _db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false);
    await _db.open();
  }

  await _ensureSchema(_db);
  return _db;
}

async function _ensureSchema(db) {
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

  // Seed inicial si la tabla está vacía
  const r = await db.query('SELECT COUNT(*) as n FROM channels');
  const n = r?.values?.[0]?.n ?? 0;
  if (n === 0) await _seedInitial(db);
}

async function _seedInitial(db) {
  // Categoría única "Deportes"
  await db.run(
    `INSERT OR IGNORE INTO categories (id, name, slug, icon) VALUES (1, 'Deportes', 'deportes', 'fa-futbol')`,
  );

  // Cargar el JSON empaquetado en assets/public-seed/channels.json
  let seed;
  try {
    const res = await fetch('/public-seed/channels.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    seed = await res.json();
  } catch (e) {
    console.warn('[mobileDb] No se encontró seed local, intento red:', e.message);
    const res = await fetch(
      'https://raw.githubusercontent.com/fofostudio/LocalTv-FofoStudio-Edition/main/mobile/public-seed/channels.json',
    );
    seed = await res.json();
  }

  const STMT = `INSERT OR IGNORE INTO channels (name, slug, stream_url, logo_url, category_id, is_active)
                VALUES (?, ?, ?, ?, ?, ?)`;
  const set = (seed.channels || []).map((c) => ({
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
  if (set.length) await db.executeSet(set);
  console.log(`[mobileDb] seed inicial: ${set.length} canales`);
}

// ---- queries (mismas formas que devuelve el backend) ----

export async function getChannels() {
  const db = await openDb();
  const r = await db.query(
    `SELECT id, name, slug, stream_url, logo_url, category_id,
            CASE WHEN is_active = 1 THEN 1 ELSE 0 END as is_active
     FROM channels ORDER BY name`,
  );
  return (r.values || []).map((row) => ({ ...row, is_active: row.is_active === 1 }));
}

export async function getCategories() {
  const db = await openDb();
  const r = await db.query('SELECT id, name, slug, icon FROM categories ORDER BY id');
  return r.values || [];
}

export async function getFavorites() {
  const db = await openDb();
  const r = await db.query('SELECT slug FROM favorites');
  return new Set((r.values || []).map((row) => row.slug));
}

export async function toggleFavorite(slug) {
  const db = await openDb();
  const r = await db.query('SELECT 1 FROM favorites WHERE slug = ?', [slug]);
  if (r.values?.length) {
    await db.run('DELETE FROM favorites WHERE slug = ?', [slug]);
    return false;
  }
  await db.run('INSERT INTO favorites (slug) VALUES (?)', [slug]);
  return true;
}

export async function upsertChannels(scraped) {
  const db = await openDb();
  let created = 0;
  let updated = 0;
  for (const ch of scraped) {
    const found = await db.query('SELECT id, stream_url FROM channels WHERE slug = ?', [ch.slug]);
    if (found.values?.length) {
      if (found.values[0].stream_url !== ch.stream_url) {
        await db.run('UPDATE channels SET stream_url = ? WHERE slug = ?', [ch.stream_url, ch.slug]);
        updated += 1;
      }
    } else {
      await db.run(
        'INSERT INTO channels (name, slug, stream_url, category_id, is_active) VALUES (?, ?, ?, 1, 1)',
        [ch.name, ch.slug, ch.stream_url],
      );
      created += 1;
    }
  }
  return { created, updated, total_scraped: scraped.length };
}

export async function setChannelActive(slug, active) {
  const db = await openDb();
  await db.run('UPDATE channels SET is_active = ? WHERE slug = ?', [active ? 1 : 0, slug]);
}
