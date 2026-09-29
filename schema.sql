-- ============================================================================
-- schema.sql — Nucleo remoto de Jarvis (Cloudflare D1)
-- Memoria compartida entre los 3 pilares (Antigravity, Claude, Jarvis).
-- Ver ../AGENTS.md seccion 0 (Regla Cero), seccion 6 (memoria) y seccion 7
-- (mapa de relaciones) para el protocolo que consume estas tablas.
--
-- D1 aplica FOREIGN KEY por defecto; no hace falta PRAGMA foreign_keys=ON.
-- Aplicar con: wrangler d1 execute jarvis-nucleo --remote --file=schema.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- NODOS — mapa de relaciones: sistemas/servicios del ecosistema
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodos (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL UNIQUE,
  tipo        TEXT NOT NULL,
  descripcion TEXT,
  creado      TEXT NOT NULL,
  autor       TEXT
);

-- ---------------------------------------------------------------------------
-- RELACIONES — analisis de impacto entre nodos (grafo de sistemas)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS relaciones (
  id          TEXT PRIMARY KEY,
  origen      TEXT NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  destino     TEXT NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  descripcion TEXT,
  confianza   TEXT NOT NULL DEFAULT 'media' CHECK (confianza IN ('baja','media','alta')),
  creado      TEXT NOT NULL,
  autor       TEXT
);

CREATE INDEX IF NOT EXISTS idx_relaciones_origen  ON relaciones(origen);
CREATE INDEX IF NOT EXISTS idx_relaciones_destino ON relaciones(destino);
CREATE INDEX IF NOT EXISTS idx_relaciones_tipo    ON relaciones(tipo);

-- ---------------------------------------------------------------------------
-- MEMORIA (legacy) — tabla plana previa a memory_items/memory_observations.
-- Ya existe en el D1 de produccion (creada fuera de este fichero, ver AGENTS.md
-- seccion 8); se declara aqui para que schema.sql refleje la realidad y
-- funcione en local/wrangler dev. POST/PUT /memoria hacen dual-write aqui
-- durante la Fase A de migracion (Tarea A4-WORKER-MEMORIA-API) para no dejar
-- ciegos a clientes/Jarvis que todavia la leen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memoria (
  id             TEXT PRIMARY KEY,
  capa           TEXT NOT NULL,
  texto          TEXT NOT NULL,
  origen         TEXT NOT NULL DEFAULT 'desconocido',
  fecha          TEXT NOT NULL,
  confianza      TEXT NOT NULL DEFAULT 'media',
  revisar        TEXT,
  estado         TEXT NOT NULL DEFAULT 'activo',
  autor          TEXT,
  etiquetas      TEXT,
  sustituido_por TEXT,
  corrige_a      TEXT,
  motivo_archivo TEXT,
  archivado_por  TEXT,
  archivado_en   TEXT
);

CREATE INDEX IF NOT EXISTS idx_memoria_estado ON memoria(estado);

-- ---------------------------------------------------------------------------
-- MEMORY_ITEMS — entidades/conceptos de la memoria (grafo de conocimiento)
-- Cada item acumula observaciones (hechos datados) en memory_observations.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_items (
  id          TEXT PRIMARY KEY,
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL DEFAULT 'concepto',
  estado      TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','archivado')),
  creado      TEXT NOT NULL,
  actualizado TEXT NOT NULL,
  autor       TEXT
);

-- Un mismo nombre solo puede estar activo una vez; archivar libera el nombre.
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_items_nombre_activo
  ON memory_items(nombre) WHERE estado = 'activo';

-- ---------------------------------------------------------------------------
-- MEMORY_OBSERVATIONS — hechos datados asociados a un memory_item
-- Sustituye a la antigua tabla plana "memoria": misma semantica de
-- capa/origen/confianza/estado/autor, pero normalizada bajo un item.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_observations (
  id             TEXT PRIMARY KEY,
  item_id        TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  capa           TEXT NOT NULL CHECK (capa IN ('episodica','semantica','procedimental')),
  texto          TEXT NOT NULL,
  origen         TEXT NOT NULL DEFAULT 'desconocido' CHECK (origen IN ('david','inferido','herramienta')),
  confianza      TEXT NOT NULL DEFAULT 'media' CHECK (confianza IN ('baja','media','alta')),
  estado         TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','archivado')),
  autor          TEXT NOT NULL CHECK (autor IN ('antigravity','claude','jarvis')),
  sustituido_por TEXT REFERENCES memory_observations(id),
  corrige_a      TEXT REFERENCES memory_observations(id),
  motivo_archivo TEXT,
  archivado_por  TEXT,
  archivado_en   TEXT,
  revisar        TEXT,
  fecha          TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_observations_item         ON memory_observations(item_id);
CREATE INDEX IF NOT EXISTS idx_memory_observations_estado_capa  ON memory_observations(estado, capa);

-- ---------------------------------------------------------------------------
-- MEMORY_LINKS — relaciones entre memory_items (grafo de conocimiento)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_links (
  id          TEXT PRIMARY KEY,
  origen_id   TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  destino_id  TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL,
  descripcion TEXT,
  creado      TEXT NOT NULL,
  autor       TEXT,
  UNIQUE (origen_id, destino_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_memory_links_origen  ON memory_links(origen_id);
CREATE INDEX IF NOT EXISTS idx_memory_links_destino ON memory_links(destino_id);

-- ---------------------------------------------------------------------------
-- MEMORY_TAGS / MEMORY_ITEM_TAGS — etiquetado normalizado (many-to-many)
-- Vocabulario fijo por AGENTS.md seccion 6.6: candyla, atiendo, jarvis-app,
-- arquitectura, autonomo, meta-sistema.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memory_tags (
  id     TEXT PRIMARY KEY,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS memory_item_tags (
  item_id TEXT NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  tag_id  TEXT NOT NULL REFERENCES memory_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, tag_id)
);

INSERT OR IGNORE INTO memory_tags (id, nombre) VALUES
  ('tag_candyla',      'candyla'),
  ('tag_atiendo',      'atiendo'),
  ('tag_jarvis_app',   'jarvis-app'),
  ('tag_arquitectura', 'arquitectura'),
  ('tag_autonomo',     'autonomo'),
  ('tag_meta_sistema', 'meta-sistema');

-- ---------------------------------------------------------------------------
-- OBJETIVOS — tareas/objetivos compartidos entre pilares
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS objetivos (
  id                  TEXT PRIMARY KEY,
  titulo              TEXT NOT NULL,
  responsable         TEXT,
  estado              TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','en_curso','bloqueado','hecho','cancelado')),
  avisar_al_terminar  INTEGER NOT NULL DEFAULT 0,
  historial           TEXT NOT NULL DEFAULT '[]',
  creado              TEXT NOT NULL,
  actualizado         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_objetivos_estado ON objetivos(estado);

-- ---------------------------------------------------------------------------
-- CONFIRMACIONES — acciones de riesgo pendientes de aprobacion de David
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS confirmaciones (
  id            TEXT PRIMARY KEY,
  herramienta   TEXT NOT NULL,
  args          TEXT NOT NULL DEFAULT '{}',
  nivel         TEXT NOT NULL,
  resumen       TEXT,
  actor         TEXT NOT NULL DEFAULT 'jarvis',
  estado        TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada','rechazada')),
  resuelto_por  TEXT,
  creado        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_confirmaciones_estado ON confirmaciones(estado);

-- ---------------------------------------------------------------------------
-- LEASES — bloqueos de coordinacion entre pilares sobre un recurso
-- (fichero, nodo, workflow de n8n...) para que dos pilares no lo toquen
-- a la vez. Un recurso solo puede tener un lease 'activo' simultaneo.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leases (
  id           TEXT PRIMARY KEY,
  recurso      TEXT NOT NULL,
  titular      TEXT NOT NULL CHECK (titular IN ('antigravity','claude','jarvis')),
  estado       TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo','liberado','expirado')),
  motivo       TEXT,
  adquirido    TEXT NOT NULL,
  expira       TEXT NOT NULL,
  liberado_en  TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_leases_recurso_activo
  ON leases(recurso) WHERE estado = 'activo';
CREATE INDEX IF NOT EXISTS idx_leases_titular ON leases(titular);

-- ---------------------------------------------------------------------------
-- MEMORY_FTS — busqueda de texto completo sobre memory_observations.texto
-- Tabla FTS5 de "external content" sincronizada por triggers (patron
-- estandar de SQLite: sin triggers, memory_fts queda desincronizada).
-- ---------------------------------------------------------------------------
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  texto,
  content = 'memory_observations',
  content_rowid = 'rowid'
);

CREATE TRIGGER IF NOT EXISTS memory_observations_ai
AFTER INSERT ON memory_observations BEGIN
  INSERT INTO memory_fts(rowid, texto) VALUES (new.rowid, new.texto);
END;

CREATE TRIGGER IF NOT EXISTS memory_observations_ad
AFTER DELETE ON memory_observations BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, texto) VALUES ('delete', old.rowid, old.texto);
END;

CREATE TRIGGER IF NOT EXISTS memory_observations_au
AFTER UPDATE ON memory_observations BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, texto) VALUES ('delete', old.rowid, old.texto);
  INSERT INTO memory_fts(rowid, texto) VALUES (new.rowid, new.texto);
END;

-- ---------------------------------------------------------------------------
-- SILENCIO_EVENTOS — motor de interrupcion selectiva (Fase D): cada hallazgo
-- evaluado por /silencio/evaluar que se registra vía /silencio/eventos, con
-- su canal de salida y (si aplica) su paso por el digest diario.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS silencio_eventos (
  id       TEXT PRIMARY KEY,
  titulo   TEXT NOT NULL,
  resumen  TEXT,
  score    REAL NOT NULL,
  canal    TEXT NOT NULL,
  factores TEXT,
  estado   TEXT NOT NULL DEFAULT 'pendiente',
  creado   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_silencio_eventos_canal_estado ON silencio_eventos(canal, estado);
