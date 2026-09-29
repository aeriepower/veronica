-- ============================================================================
-- migration_a3_blast_radius.sql — Tarea [A3-WORKER-BLAST-RADIUS]
-- Enriquece nodos/relaciones (schema.sql, 24-sep) con tier/is_blocking para
-- poder calcular severidad (Seccion 6.3 de arquitectura-jarvis-asistente.md)
-- sin romper las columnas origen/destino que ya usan worker.js y los datos
-- sembrados en seed_canonica.sql.
--
-- NO aplicado automaticamente por Claude (despliegue = Antigravity, AGENTS.md
-- 1.1). Aplicar con:
--   wrangler d1 execute jarvis-nucleo --remote --file=migration_a3_blast_radius.sql
-- ============================================================================

ALTER TABLE nodos ADD COLUMN tier TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE relaciones ADD COLUMN is_blocking INTEGER NOT NULL DEFAULT 1;

-- Sistemas de produccion cuyo fallo/cambio bloquea a quien depende de ellos.
UPDATE nodos SET tier = 'critical'
WHERE id IN ('candyla-salesforce', 'atiendo-n8n', 'jarvis-nucleo-worker', 'candyla-web');
