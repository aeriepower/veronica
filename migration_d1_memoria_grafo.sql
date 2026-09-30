-- [D1-MEMORIA-GRAFO] 30-sep-2026. Puente memoria <-> grafo, propuestas del
-- extractor y planes de cambio. Solo aditiva (CREATE ... IF NOT EXISTS):
-- no toca nodos, relaciones ni memory_*.

-- Enlace observacion de memoria <-> nodo. Las observaciones enlazadas quedan
-- exentas de la curacion nocturna (services/curacion.ts).
CREATE TABLE IF NOT EXISTS nodo_memoria (
  id             TEXT PRIMARY KEY,
  nodo_id        TEXT NOT NULL REFERENCES nodos(id) ON DELETE CASCADE,
  observacion_id TEXT NOT NULL REFERENCES memory_observations(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL DEFAULT 'menciona' CHECK (tipo IN ('sobre','menciona')),
  fuerza         REAL NOT NULL DEFAULT 0.5,
  origen         TEXT NOT NULL DEFAULT 'regla' CHECK (origen IN ('regla','ia','manual')),
  creado         TEXT NOT NULL,
  UNIQUE (nodo_id, observacion_id)
);
CREATE INDEX IF NOT EXISTS idx_nodo_memoria_nodo ON nodo_memoria(nodo_id);
CREATE INDEX IF NOT EXISTS idx_nodo_memoria_obs ON nodo_memoria(observacion_id);

-- Nodos/relaciones que el extractor propone y que necesitan aprobacion.
CREATE TABLE IF NOT EXISTS propuestas_grafo (
  id             TEXT PRIMARY KEY,
  clase          TEXT NOT NULL CHECK (clase IN ('nodo','relacion')),
  clave          TEXT NOT NULL UNIQUE,
  payload        TEXT NOT NULL,
  observacion_id TEXT,
  evidencia      TEXT,
  confianza      REAL,
  fuente         TEXT NOT NULL DEFAULT 'regla',
  estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada','rechazada')),
  creado         TEXT NOT NULL,
  resuelto       TEXT,
  resuelto_por   TEXT
);
CREATE INDEX IF NOT EXISTS idx_propuestas_estado ON propuestas_grafo(estado);

-- Planes de cambio (planificar_cambio) y su cierre (plan_cerrar).
CREATE TABLE IF NOT EXISTS planes_cambio (
  id        TEXT PRIMARY KEY,
  tarea     TEXT,
  autor     TEXT,
  semillas  TEXT NOT NULL,
  resultado TEXT NOT NULL,
  creado    TEXT NOT NULL,
  cierre    TEXT,
  cerrado   TEXT
);
