-- ============================================================================
-- seed_canonica.sql — Poblado inicial del nucleo remoto (Cloudflare D1)
-- Tarea [A2-D1-POBLADO-INICIAL]. Idempotente: todo INSERT OR IGNORE.
-- Aplicar con: wrangler d1 execute jarvis-nucleo --remote --file=seed_canonica.sql
-- Ver AGENTS.md secciones 0, 6 y 7.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- NODOS (13) — software/servicios, hardware, credenciales logicas
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO nodos (id, nombre, tipo, descripcion, creado, autor) VALUES
  ('candyla-salesforce',   'Salesforce (Candyla)',              'software',    'Org Salesforce de Candyla: Apex, LWC y Screen Flows.',                        '2026-09-23T00:00:00Z', 'claude'),
  ('atiendo-n8n',          'n8n (Atiendo)',                      'software',    'Instancia n8n que orquesta los flujos de WhatsApp de Atiendo.',               '2026-09-23T00:00:00Z', 'claude'),
  ('jarvis-nucleo-worker', 'Cloudflare Worker jarvis-nucleo',    'software',    'Worker Hono + D1, nucleo remoto compartido por los tres pilares.',           '2026-09-23T00:00:00Z', 'claude'),
  ('candyla-web',          'Web Candyla (Astro/Cloudflare Pages)','software',   'Frontend de la tienda Candyla en Cloudflare Pages.',                          '2026-09-23T00:00:00Z', 'claude'),
  ('jarvis-opi',           'Orange Pi (Jarvis)',                 'hardware',    'Dispositivo Orange Pi que ejecuta el asistente de voz Jarvis.',              '2026-09-23T00:00:00Z', 'claude'),
  ('pc-windows-david',     'PC Windows de David',                'hardware',    'Equipo de escritorio de David, puesto de trabajo principal.',                '2026-09-23T00:00:00Z', 'claude'),
  ('google-home-salon',    'Google Home (Salon)',                'hardware',    'Altavoz Google Home en el salon, usado para avisos por voz.',                '2026-09-23T00:00:00Z', 'claude'),
  ('mini-pc-proxmox',      'Mini PC Proxmox',                    'hardware',    'Servidor Proxmox que hospeda maquinas virtuales/contenedores locales.',      '2026-09-23T00:00:00Z', 'claude'),
  ('ha-connect-zbt2',      'Home Assistant + ZBT-2',              'hardware',    'Home Assistant con dongle Zigbee ZBT-2 para domotica.',                      '2026-09-23T00:00:00Z', 'claude'),
  ('esp32-despacho',       'ESP32 (Despacho)',                   'hardware',    'Microcontrolador ESP32 en el despacho.',                                      '2026-09-23T00:00:00Z', 'claude'),
  ('cred-meta-token',      'Credencial: Token Meta Cloud API',   'credencial',  'Metadato (sin valor real) del token de Meta Cloud API usado por Atiendo.',   '2026-09-23T00:00:00Z', 'claude'),
  ('cred-salesforce-oauth','Credencial: OAuth Salesforce',       'credencial',  'Metadato (sin valor real) de la credencial OAuth de Salesforce.',            '2026-09-23T00:00:00Z', 'claude'),
  ('cred-cloudflare-token','Credencial: Token Cloudflare',       'credencial',  'Metadato (sin valor real) del token API de Cloudflare usado por jarvis-nucleo.', '2026-09-23T00:00:00Z', 'claude');

-- ---------------------------------------------------------------------------
-- RELACIONES (10) — grafo de dependencias entre nodos
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO relaciones (id, origen, destino, tipo, descripcion, confianza, creado, autor) VALUES
  ('rel_atiendo_credmeta',    'atiendo-n8n',          'cred-meta-token',       'secret_share', 'Atiendo usa el token de Meta Cloud API para enviar/recibir WhatsApp.',   'alta', '2026-09-23T00:00:00Z', 'claude'),
  ('rel_atiendo_salesforce',  'atiendo-n8n',          'candyla-salesforce',    'depende_de',   'Atiendo consulta y actualiza datos en Salesforce (leads, citas).',       'alta', '2026-09-23T00:00:00Z', 'claude'),
  ('rel_opi_nucleo',          'jarvis-opi',           'jarvis-nucleo-worker',  'llama_a',      'La Orange Pi llama al nucleo remoto para leer/escribir memoria.',        'alta', '2026-09-23T00:00:00Z', 'claude'),
  ('rel_pcwindows_nucleo',    'pc-windows-david',     'jarvis-nucleo-worker',  'llama_a',      'El PC de David (Claude Code/Antigravity) llama al nucleo remoto.',       'alta', '2026-09-23T00:00:00Z', 'claude'),
  ('rel_candylaweb_nucleo',   'candyla-web',          'jarvis-nucleo-worker',  'llama_a',      'La web de Candyla puede consultar el nucleo remoto.',                    'media','2026-09-23T00:00:00Z', 'claude'),
  ('rel_nucleo_googlehome',   'jarvis-nucleo-worker', 'google-home-salon',    'emite_a',      'El nucleo emite avisos de voz al Google Home del salon.',                'alta', '2026-09-23T00:00:00Z', 'claude'),
  ('rel_haconnect_proxmox',   'ha-connect-zbt2',      'mini-pc-proxmox',      'conecta_a',    'Home Assistant (con el ZBT-2) corre conectado al Mini PC Proxmox.',      'alta', '2026-09-23T00:00:00Z', 'claude'),
  ('rel_esp32_proxmox',       'esp32-despacho',       'mini-pc-proxmox',      'streaming_a',  'El ESP32 del despacho envia streaming/datos al Mini PC Proxmox.',        'alta', '2026-09-23T00:00:00Z', 'claude'),
  ('rel_salesforce_credoauth','candyla-salesforce',   'cred-salesforce-oauth','secret_share', 'Salesforce usa la credencial OAuth para integraciones externas.',       'alta', '2026-09-23T00:00:00Z', 'claude'),
  ('rel_nucleo_credcloudflare','jarvis-nucleo-worker','cred-cloudflare-token','secret_share', 'El nucleo usa el token de Cloudflare para desplegar/administrar el Worker.', 'alta', '2026-09-23T00:00:00Z', 'claude');

-- ---------------------------------------------------------------------------
-- MEMORY_ITEMS (6) — memoria canonica validada (grafo de conocimiento)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO memory_items (id, nombre, tipo, estado, creado, actualizado, autor) VALUES
  ('mi_regla_cero',  'Regla Cero — Cero Informacion Privilegiada',                        'principio',    'activo', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z', 'antigravity'),
  ('mi_david_rol',   'Principio Rector — David no es Sysadmin',                           'principio',    'activo', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z', 'antigravity'),
  ('mi_tabula_rasa', 'Principio de Tabula Rasa — Cero Parches Heredados',                 'principio',    'activo', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z', 'antigravity'),
  ('mi_claude_pro',  'Mandato Operativo — Uso Activo de Claude Pro para Programacion',    'principio',    'activo', '2026-09-13T00:00:00Z', '2026-09-16T00:00:00Z', 'antigravity'),
  ('mi_santo_grial', 'Arquitectura Maestra — Un Solo Sustrato, Tres Bocas',               'arquitectura', 'activo', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z', 'antigravity'),
  ('mi_nucleo_d1',   'Sustrato Central — Cloudflare Worker jarvis-nucleo + D1',           'arquitectura', 'activo', '2026-09-23T00:00:00Z', '2026-09-23T00:00:00Z', 'antigravity');

-- ---------------------------------------------------------------------------
-- MEMORY_OBSERVATIONS (6) — un hecho datado por item, capa/origen/confianza
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO memory_observations (id, item_id, capa, texto, origen, confianza, estado, autor, fecha) VALUES
  ('mo_regla_cero',  'mi_regla_cero',  'procedimental', 'Nada que haga cualquiera de los tres pilares puede quedar solo en su cabeza. Si uno lo sabe, lo deben saber los tres en D1 o en candyla/docs_compartidos/.', 'david', 'alta', 'activo', 'antigravity', '2026-09-23T00:00:00Z'),
  ('mo_david_rol',   'mi_david_rol',   'procedimental', 'David no depura infraestructura, no busca rutas de servidores por SSH ni hace de puente entre agentes. Delegacion cruzada A2A obligatoria.', 'david', 'alta', 'activo', 'antigravity', '2026-09-23T00:00:00Z'),
  ('mo_tabula_rasa', 'mi_tabula_rasa', 'procedimental', 'Prefiero borrar lo que tenemos y construirlo de cero si asi queda mas limpio. Queda prohibido arrastrar codigo espagueti o parches temporales.', 'david', 'alta', 'activo', 'antigravity', '2026-09-23T00:00:00Z'),
  ('mo_claude_pro',  'mi_claude_pro',  'procedimental', 'David paga mensualmente la suscripcion Pro especificamente para que Claude Code sea el Lead Engineer que escriba y programe el codigo.', 'david', 'alta', 'activo', 'antigravity', '2026-09-16T00:00:00Z'),
  ('mo_santo_grial', 'mi_santo_grial', 'semantica',     'Un solo sustrato compartido. Tres bocas distintas. Documento maestro canonico en candyla/docs_compartidos/arquitectura-jarvis-asistente.md.', 'david', 'alta', 'activo', 'antigravity', '2026-09-23T00:00:00Z'),
  ('mo_nucleo_d1',   'mi_nucleo_d1',   'semantica',     'El unico cerebro soberano es jarvis-nucleo en Cloudflare D1. Jarvis, Antigravity y Claude son clientes y actuadores.', 'david', 'alta', 'activo', 'antigravity', '2026-09-23T00:00:00Z');

-- ---------------------------------------------------------------------------
-- MEMORY_ITEM_TAGS — vinculo de los 6 items con tag_meta_sistema y tag_arquitectura
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO memory_item_tags (item_id, tag_id) VALUES
  ('mi_regla_cero',  'tag_meta_sistema'),
  ('mi_regla_cero',  'tag_arquitectura'),
  ('mi_david_rol',   'tag_meta_sistema'),
  ('mi_david_rol',   'tag_arquitectura'),
  ('mi_tabula_rasa', 'tag_meta_sistema'),
  ('mi_tabula_rasa', 'tag_arquitectura'),
  ('mi_claude_pro',  'tag_meta_sistema'),
  ('mi_claude_pro',  'tag_arquitectura'),
  ('mi_santo_grial', 'tag_meta_sistema'),
  ('mi_santo_grial', 'tag_arquitectura'),
  ('mi_nucleo_d1',   'tag_meta_sistema'),
  ('mi_nucleo_d1',   'tag_arquitectura');
