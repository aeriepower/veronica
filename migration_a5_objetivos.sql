-- ============================================================================
-- migration_a5_objetivos.sql — Tarea [A5-WORKER-OBJETIVOS]
-- Enriquece "objetivos" con los campos canonicos de la Seccion 8.2 de
-- arquitectura-jarvis-asistente.md (idempotencia, prioridad, resultado).
--
-- NO aplicado automaticamente por Claude (despliegue = Antigravity, AGENTS.md
-- 1.1). Aplicar con:
--   wrangler d1 execute jarvis-nucleo --remote --file=migration_a5_objetivos.sql
-- ============================================================================

ALTER TABLE objetivos ADD COLUMN descripcion TEXT;
ALTER TABLE objetivos ADD COLUMN asignado_a TEXT;
ALTER TABLE objetivos ADD COLUMN creado_por TEXT;
ALTER TABLE objetivos ADD COLUMN prioridad TEXT DEFAULT 'media';
ALTER TABLE objetivos ADD COLUMN resultado_json TEXT;
ALTER TABLE objetivos ADD COLUMN artefactos TEXT;
ALTER TABLE objetivos ADD COLUMN timeout INTEGER;
ALTER TABLE objetivos ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_objetivos_idempotency_key
  ON objetivos(idempotency_key) WHERE idempotency_key IS NOT NULL;

UPDATE objetivos SET asignado_a = responsable WHERE asignado_a IS NULL;

-- ----------------------------------------------------------------------------
-- Ampliar el CHECK de "estado": el original (schema.sql) solo admite
-- pendiente/en_curso/bloqueado/hecho/cancelado. ActualizarObjetivoSchema
-- (src/types/objetivos.ts) tambien acepta en_progreso/completado, y SQLite
-- no soporta ALTER TABLE para tocar un CHECK existente -> sin este paso,
-- PATCH /objetivos/:id/estado con esos valores rompe con un error de D1.
-- Se reconstruye la tabla (patron estandar de SQLite), preservando datos.
-- ----------------------------------------------------------------------------
CREATE TABLE objetivos_nuevo (
  id                  TEXT PRIMARY KEY,
  titulo              TEXT NOT NULL,
  descripcion         TEXT,
  responsable         TEXT,
  asignado_a          TEXT,
  creado_por          TEXT,
  estado              TEXT NOT NULL DEFAULT 'pendiente'
                        CHECK (estado IN ('pendiente','en_progreso','en_curso','bloqueado','completado','hecho','cancelado')),
  prioridad           TEXT DEFAULT 'media',
  avisar_al_terminar  INTEGER NOT NULL DEFAULT 0,
  historial           TEXT NOT NULL DEFAULT '[]',
  resultado_json      TEXT,
  artefactos          TEXT,
  timeout             INTEGER,
  idempotency_key     TEXT,
  creado              TEXT NOT NULL,
  actualizado         TEXT NOT NULL
);

INSERT INTO objetivos_nuevo
  (id, titulo, descripcion, responsable, asignado_a, creado_por, estado, prioridad,
   avisar_al_terminar, historial, resultado_json, artefactos, timeout, idempotency_key, creado, actualizado)
SELECT
  id, titulo, descripcion, responsable, asignado_a, creado_por, estado, prioridad,
  avisar_al_terminar, historial, resultado_json, artefactos, timeout, idempotency_key, creado, actualizado
FROM objetivos;

DROP TABLE objetivos;
ALTER TABLE objetivos_nuevo RENAME TO objetivos;

CREATE INDEX IF NOT EXISTS idx_objetivos_estado ON objetivos(estado);
CREATE UNIQUE INDEX IF NOT EXISTS idx_objetivos_idempotency_key
  ON objetivos(idempotency_key) WHERE idempotency_key IS NOT NULL;
