-- ============================================================================
-- migration_a12_migrate_legacy_memoria.sql — Tarea [A12-DECOMMISSIONING-D1]
-- Migra las filas de la tabla legacy "memoria" que aun no tengan su
-- equivalente en memory_observations (mismo id, dual-write de Fase A, ver
-- src/routes/memoria.ts) hacia memory_items + memory_observations,
-- preservando texto/capa/origen/confianza/autor/fecha, y reparte "etiquetas"
-- (CSV) en memory_item_tags. memory_fts se rellena solo via los triggers de
-- schema.sql (memory_observations_ai) al insertar en memory_observations.
--
-- NO aplicado automaticamente por Claude (despliegue = Antigravity, AGENTS.md
-- 1.1). Aplicar ANTES de migration_a12_drop_legacy_tables.sql, con:
--   wrangler d1 execute jarvis-nucleo --remote --file=migration_a12_migrate_legacy_memoria.sql
-- ============================================================================

-- Tabla de trabajo (no TEMP: hay que poder leerla en los pasos 3 y 4 de este
-- mismo fichero con garantias, y wrangler d1 execute puede trocear el envio
-- en varias llamadas). Se elimina al final de esta migracion.
CREATE TABLE IF NOT EXISTS a12_pendientes AS
SELECT * FROM memoria m
WHERE NOT EXISTS (SELECT 1 FROM memory_observations mo WHERE mo.id = m.id);

-- 1) memory_items — la tabla legacy "memoria" no tiene columna agrupadora
--    ("nombre"): cada recuerdo legacy pasa a ser su propio item, con un id
--    derivado de forma determinista del id legacy para que el paso 2 lo
--    referencie sin ambiguedad.
INSERT INTO memory_items (id, nombre, tipo, estado, creado, actualizado, autor)
SELECT
  'mi_legacy_' || id,
  'legacy-' || id,
  'concepto',
  CASE WHEN estado = 'archivado' THEN 'archivado' ELSE 'activo' END,
  fecha,
  fecha,
  CASE WHEN autor IN ('antigravity', 'claude', 'jarvis') THEN autor ELSE 'jarvis' END
FROM a12_pendientes;

-- 2) memory_observations — mismo id que la fila legacy. sustituido_por /
--    corrige_a se dejan NULL aqui y se rellenan en el paso 3: son FK a
--    memory_observations(id) y, dentro de un INSERT...SELECT multifila, no
--    hay garantia de que la fila referenciada ya exista en ese instante.
--    Los CASE normalizan valores fuera de vocabulario (la tabla legacy no
--    tenia CHECK) al valor por defecto de schema.sql.
INSERT INTO memory_observations (
  id, item_id, capa, texto, origen, confianza, estado, autor,
  motivo_archivo, archivado_por, archivado_en, revisar, fecha
)
SELECT
  id,
  'mi_legacy_' || id,
  CASE WHEN capa IN ('episodica', 'semantica', 'procedimental') THEN capa ELSE 'semantica' END,
  texto,
  CASE WHEN origen IN ('david', 'inferido', 'herramienta') THEN origen ELSE 'herramienta' END,
  CASE WHEN confianza IN ('baja', 'media', 'alta') THEN confianza ELSE 'media' END,
  CASE WHEN estado = 'archivado' THEN 'archivado' ELSE 'activo' END,
  CASE WHEN autor IN ('antigravity', 'claude', 'jarvis') THEN autor ELSE 'jarvis' END,
  motivo_archivo,
  archivado_por,
  archivado_en,
  revisar,
  fecha
FROM a12_pendientes;

-- 3) sustituido_por / corrige_a — ahora que todo el lote esta insertado,
--    todos los ids que puedan referenciar ya existen (o ya existian de
--    antes, por venir de un dual-write de Fase A).
UPDATE memory_observations
SET sustituido_por = (SELECT p.sustituido_por FROM a12_pendientes p WHERE p.id = memory_observations.id)
WHERE id IN (SELECT id FROM a12_pendientes WHERE sustituido_por IS NOT NULL);

UPDATE memory_observations
SET corrige_a = (SELECT p.corrige_a FROM a12_pendientes p WHERE p.id = memory_observations.id)
WHERE id IN (SELECT id FROM a12_pendientes WHERE corrige_a IS NOT NULL);

-- 4) etiquetas (CSV en la columna legacy) -> memory_item_tags. Split via CTE
--    recursiva (patron estandar de SQLite para partir por separador). Los
--    tokens fuera del vocabulario fijo (memory_tags) simplemente no casan en
--    el JOIN y se descartan sin error.
WITH RECURSIVE split(id, etiqueta, resto) AS (
  SELECT id, '', etiquetas || ','
  FROM a12_pendientes
  WHERE etiquetas IS NOT NULL AND trim(etiquetas) != ''
  UNION ALL
  SELECT
    id,
    trim(substr(resto, 1, instr(resto, ',') - 1)),
    substr(resto, instr(resto, ',') + 1)
  FROM split
  WHERE resto != ''
)
INSERT OR IGNORE INTO memory_item_tags (item_id, tag_id)
SELECT 'mi_legacy_' || split.id, mt.id
FROM split
JOIN memory_tags mt ON mt.nombre = split.etiqueta
WHERE split.etiqueta != '';

DROP TABLE a12_pendientes;
