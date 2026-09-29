-- Reversion de migration_c2 (solo filas conocidas el 29-sep-2026). Usar solo si hace falta.
UPDATE nodos SET tipo='sistema' WHERE id IN ('jarvis-app','candyla-web');
UPDATE nodos SET tipo='servicio' WHERE id IN ('candyla-worker-api','atiendo-n8n');
UPDATE nodos SET tipo='plataforma' WHERE id IN ('candyla-salesforce','atiendo-salesforce');
UPDATE nodos SET tipo='integracion' WHERE id IN ('atiendo-gemini','atiendo-google-calendar','atiendo-waba');
UPDATE nodos SET tipo='dispositivo' WHERE id='google-home';
UPDATE nodos SET tipo='almacen' WHERE id='docs-compartidos';
UPDATE relaciones SET tipo='comparte_credencial_con' WHERE id IN ('r13','r17','r18');
UPDATE relaciones SET tipo='bloqueado_por' WHERE id IN ('r20','r21','r22');
UPDATE relaciones SET tipo='mantenido_por' WHERE id='r24';
UPDATE relaciones SET tipo='conecta_a' WHERE id='rel_haconnect_proxmox';
UPDATE relaciones SET tipo='emite_a' WHERE id='rel_nucleo_googlehome';
UPDATE relaciones SET tipo='streaming_a' WHERE id='rel_esp32_proxmox';
