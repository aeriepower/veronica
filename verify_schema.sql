-- ============================================================================
-- verify_schema.sql — pruebas de humo para schema.sql (nucleo-worker)
-- Insercion basica, busqueda FTS5 y verificacion de foreign keys.
--
-- Aplicar DESPUES de schema.sql:
--   wrangler d1 execute jarvis-nucleo --remote --file=schema.sql
--   wrangler d1 execute jarvis-nucleo --remote --file=verify_schema.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) NODOS + RELACIONES
-- ---------------------------------------------------------------------------
INSERT INTO nodos (id, nombre, tipo, descripcion, creado, autor) VALUES
  ('n_test_n8n',   'n8n',        'servicio', 'Router de WhatsApp', '2026-09-24T00:00:00.000Z', 'claude'),
  ('n_test_sf',    'Salesforce', 'servicio', 'CRM y aprovisionamiento', '2026-09-24T00:00:00.000Z', 'claude');

INSERT INTO relaciones (id, origen, destino, tipo, descripcion, confianza, creado, autor) VALUES
  ('r_test_1', 'n_test_n8n', 'n_test_sf', 'depende_de', 'n8n consulta Salesforce al aprovisionar', 'alta', '2026-09-24T00:00:00.000Z', 'claude');

-- ---------------------------------------------------------------------------
-- 2) MEMORY_ITEMS + MEMORY_OBSERVATIONS (dispara los triggers de memory_fts)
-- ---------------------------------------------------------------------------
INSERT INTO memory_items (id, nombre, tipo, estado, creado, actualizado, autor) VALUES
  ('mi_test_1', 'Esquema D1 nucleo-worker', 'decision', 'activo', '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z', 'claude');

INSERT INTO memory_observations (id, item_id, capa, texto, origen, confianza, estado, autor, fecha) VALUES
  ('mo_test_1', 'mi_test_1', 'semantica', 'El esquema formal de produccion usa memory_items y memory_observations para reemplazar la tabla plana memoria.', 'david', 'alta', 'activo', 'claude', '2026-09-24T00:00:00.000Z');

-- ---------------------------------------------------------------------------
-- 3) MEMORY_LINKS + MEMORY_TAGS + MEMORY_ITEM_TAGS
-- ---------------------------------------------------------------------------
INSERT INTO memory_items (id, nombre, tipo, estado, creado, actualizado, autor) VALUES
  ('mi_test_2', 'Nucleo remoto Jarvis', 'sistema', 'activo', '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z', 'claude');

INSERT INTO memory_links (id, origen_id, destino_id, tipo, descripcion, creado, autor) VALUES
  ('ml_test_1', 'mi_test_1', 'mi_test_2', 'forma_parte_de', 'El esquema forma parte del nucleo remoto', '2026-09-24T00:00:00.000Z', 'claude');

INSERT INTO memory_item_tags (item_id, tag_id) VALUES
  ('mi_test_1', 'tag_arquitectura'),
  ('mi_test_1', 'tag_jarvis_app');

-- ---------------------------------------------------------------------------
-- 4) OBJETIVOS + CONFIRMACIONES + LEASES
-- ---------------------------------------------------------------------------
INSERT INTO objetivos (id, titulo, responsable, estado, avisar_al_terminar, historial, creado, actualizado) VALUES
  ('o_test_1', 'Formalizar schema.sql del nucleo-worker', 'claude', 'hecho', 1, '[{"estado":"hecho","cuando":"2026-09-24T00:00:00.000Z","quien":"claude"}]', '2026-09-24T00:00:00.000Z', '2026-09-24T00:00:00.000Z');

INSERT INTO confirmaciones (id, herramienta, args, nivel, resumen, actor, estado, creado) VALUES
  ('c_test_1', 'db.migrate', '{"fichero":"schema.sql"}', 'bajo', 'Aplicar schema formal en D1', 'claude', 'aprobada', '2026-09-24T00:00:00.000Z');

INSERT INTO leases (id, recurso, titular, estado, motivo, adquirido, expira) VALUES
  ('l_test_1', 'jarvis/nucleo-worker/schema.sql', 'claude', 'activo', 'Escribiendo el DDL formal', '2026-09-24T00:00:00.000Z', '2026-09-24T00:10:00.000Z');

-- Debe fallar (UNIQUE parcial): ya hay un lease activo sobre el mismo recurso.
-- INSERT INTO leases (id, recurso, titular, estado, adquirido, expira) VALUES
--   ('l_test_2', 'jarvis/nucleo-worker/schema.sql', 'antigravity', 'activo', '2026-09-24T00:05:00.000Z', '2026-09-24T00:15:00.000Z');

-- ---------------------------------------------------------------------------
-- 5) BUSQUEDA FTS5
-- ---------------------------------------------------------------------------
-- Debe devolver la fila mo_test_1 (contiene "esquema" y "memoria").
SELECT o.id, o.item_id, o.texto
FROM memory_observations o
JOIN memory_fts f ON f.rowid = o.rowid
WHERE memory_fts MATCH 'esquema AND memoria';

-- Ranking por relevancia (bm25) sobre el mismo indice.
SELECT o.id, bm25(memory_fts) AS relevancia
FROM memory_observations o
JOIN memory_fts f ON f.rowid = o.rowid
WHERE memory_fts MATCH '"nucleo-worker" OR produccion'
ORDER BY relevancia
LIMIT 5;

-- ---------------------------------------------------------------------------
-- 6) VERIFICACION DE FOREIGN KEYS
-- ---------------------------------------------------------------------------
-- Debe devolver 0 filas: sin violaciones de integridad referencial.
PRAGMA foreign_key_check;

-- Debe fallar con "FOREIGN KEY constraint failed" (item_id inexistente).
-- INSERT INTO memory_observations (id, item_id, capa, texto, origen, confianza, estado, autor, fecha)
--   VALUES ('mo_test_bad', 'mi_no_existe', 'semantica', 'observacion huerfana', 'inferido', 'baja', 'activo', 'claude', '2026-09-24T00:00:00.000Z');

-- Confirma el borrado en cascada: al archivar (borrar) mi_test_2, memory_links
-- que lo referencian como destino_id debe desaparecer tambien.
DELETE FROM memory_items WHERE id = 'mi_test_2';
SELECT COUNT(*) AS enlaces_huerfanos FROM memory_links WHERE destino_id = 'mi_test_2'; -- debe dar 0

-- ---------------------------------------------------------------------------
-- 7) LIMPIEZA DE DATOS DE PRUEBA
-- ---------------------------------------------------------------------------
DELETE FROM leases WHERE id = 'l_test_1';
DELETE FROM confirmaciones WHERE id = 'c_test_1';
DELETE FROM objetivos WHERE id = 'o_test_1';
DELETE FROM memory_item_tags WHERE item_id = 'mi_test_1';
DELETE FROM memory_observations WHERE id = 'mo_test_1'; -- dispara memory_observations_ad
DELETE FROM memory_items WHERE id = 'mi_test_1';
DELETE FROM relaciones WHERE id = 'r_test_1';
DELETE FROM nodos WHERE id IN ('n_test_n8n', 'n_test_sf');

-- Debe devolver 0 filas: memory_fts quedo limpia tras el DELETE de arriba.
SELECT COUNT(*) AS filas_fts_restantes FROM memory_fts WHERE texto MATCH 'esquema';
