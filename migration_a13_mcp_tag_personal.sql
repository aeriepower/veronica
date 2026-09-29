-- ============================================================================
-- migration_a13_mcp_tag_personal.sql — Tarea [MCP-A13]
-- Anade la etiqueta 'personal' (gustos/preferencias de David sin proyecto
-- asociado) al vocabulario cerrado de memory_tags. Sin esta fila,
-- memoria_recordar con etiquetas:['personal'] insertaria la observacion
-- pero el INSERT OR IGNORE...SELECT de memory_item_tags no encontraria la
-- fila y la etiqueta se perderia en silencio.
--
-- NO aplicado automaticamente por Claude (despliegue = Antigravity,
-- AGENTS.md 1.1). Aplicar con:
--   wrangler d1 execute jarvis-nucleo --remote --file=migration_a13_mcp_tag_personal.sql
-- ============================================================================

INSERT OR IGNORE INTO memory_tags (id, nombre) VALUES ('tag_personal', 'personal');
