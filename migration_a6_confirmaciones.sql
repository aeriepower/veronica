-- ============================================================================
-- migration_a6_confirmaciones.sql — Tarea [A6-WORKER-CONFIRMACIONES]
-- Anade timeout/contexto/impacto/resuelto_en y el estado 'expirada' a
-- "confirmaciones" (Pasarela HITL N3, arquitectura-jarvis-asistente.md).
--
-- NO aplicado automaticamente por Claude (despliegue = Antigravity, AGENTS.md
-- 1.1). Aplicar con:
--   wrangler d1 execute jarvis-nucleo --remote --file=migration_a6_confirmaciones.sql
-- ============================================================================

-- SQLite no permite ALTER TABLE sobre un CHECK existente, y el CHECK original
-- de "estado" (schema.sql) no incluye 'expirada' -> se reconstruye la tabla
-- (mismo patron que migration_a5_objetivos.sql), preservando datos.
CREATE TABLE confirmaciones_nuevo (
  id            TEXT PRIMARY KEY,
  herramienta   TEXT NOT NULL,
  args          TEXT NOT NULL DEFAULT '{}',
  nivel         TEXT NOT NULL,
  resumen       TEXT,
  actor         TEXT NOT NULL DEFAULT 'jarvis',
  contexto      TEXT,
  impacto       TEXT,
  estado        TEXT NOT NULL DEFAULT 'pendiente'
                  CHECK (estado IN ('pendiente','aprobada','rechazada','expirada')),
  resuelto_por  TEXT,
  resuelto_en   TEXT,
  timeout       INTEGER,
  creado        TEXT NOT NULL
);

INSERT INTO confirmaciones_nuevo
  (id, herramienta, args, nivel, resumen, actor, estado, resuelto_por, creado)
SELECT id, herramienta, args, nivel, resumen, actor, estado, resuelto_por, creado
FROM confirmaciones;

DROP TABLE confirmaciones;
ALTER TABLE confirmaciones_nuevo RENAME TO confirmaciones;

CREATE INDEX IF NOT EXISTS idx_confirmaciones_estado ON confirmaciones(estado);
CREATE INDEX IF NOT EXISTS idx_confirmaciones_creado ON confirmaciones(creado);
