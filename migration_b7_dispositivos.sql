-- migration_b7_dispositivos.sql — Persistencia de tokens push en D1
CREATE TABLE IF NOT EXISTS dispositivos (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  plataforma  TEXT NOT NULL DEFAULT 'android',
  usuario     TEXT NOT NULL DEFAULT 'david',
  actualizado TEXT NOT NULL,
  creado      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dispositivos_token ON dispositivos(token);
CREATE INDEX IF NOT EXISTS idx_dispositivos_usuario ON dispositivos(usuario);
