-- migration_c1_nodos_ampliados.sql — campos nuevos de nodos + lote en relaciones
-- Aditiva y retrocompatible: el codigo anterior sigue funcionando con estas columnas.
ALTER TABLE nodos ADD COLUMN origen TEXT;
ALTER TABLE nodos ADD COLUMN identificador TEXT;
ALTER TABLE nodos ADD COLUMN alias TEXT;
ALTER TABLE nodos ADD COLUMN estado TEXT NOT NULL DEFAULT 'activo';
ALTER TABLE nodos ADD COLUMN data TEXT;
ALTER TABLE nodos ADD COLUMN lote TEXT;
ALTER TABLE relaciones ADD COLUMN lote TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_nodos_identificador ON nodos(identificador) WHERE identificador IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nodos_lote ON nodos(lote);
CREATE INDEX IF NOT EXISTS idx_relaciones_lote ON relaciones(lote);
