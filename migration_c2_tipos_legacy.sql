-- migration_c2_tipos_legacy.sql — migra tipos de nodo y de relacion legacy al vocabulario cerrado.
-- Tipos nuevos aceptados: repositorio, base_datos, workflow, documento, persona, bloqueador, herramienta.
UPDATE nodos SET tipo='software'         WHERE tipo IN ('sistema','servicio','plataforma');
UPDATE nodos SET tipo='servicio_externo' WHERE tipo='integracion';
UPDATE nodos SET tipo='hardware'         WHERE tipo='dispositivo';
UPDATE nodos SET tipo='documento'        WHERE tipo='almacen';
UPDATE relaciones SET tipo='secret_share' WHERE tipo='comparte_credencial_con';
UPDATE relaciones SET tipo='depende_de'   WHERE tipo='bloqueado_por';
UPDATE relaciones SET tipo='conectado_a'  WHERE tipo IN ('mantenido_por','conecta_a');
UPDATE relaciones SET tipo='llama_a'      WHERE tipo IN ('emite_a','streaming_a');
