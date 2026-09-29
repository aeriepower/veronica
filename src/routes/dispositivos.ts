import { Hono } from 'hono'
import type { Env } from '../types'
import { ahora, id } from '../index'

const dispositivos = new Hono<{ Bindings: Env }>()

// POST /dispositivos — Registro/rotación idempotente de ExpoPushToken
dispositivos.post('/', async (c) => {
  const db = c.env.DB
  const b = await c.req.json<{ token?: string; plataforma?: string; usuario?: string }>()

  if (!b || !b.token || typeof b.token !== 'string') {
    return c.json({ error: 'token es obligatorio y debe ser texto' }, 400)
  }

  const token = b.token.trim()
  const plataforma = (b.plataforma || 'android').toLowerCase()
  const usuario = (b.usuario || 'david').toLowerCase()
  const nuevoId = id('disp')
  const timestamp = ahora()

  await db.prepare(
    'INSERT INTO dispositivos (id, token, plataforma, usuario, actualizado, creado) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET plataforma = excluded.plataforma, usuario = excluded.usuario, actualizado = excluded.actualizado'
  ).bind(nuevoId, token, plataforma, usuario, timestamp, timestamp).run()

  const row = await db.prepare('SELECT id, token, plataforma, usuario, actualizado, creado FROM dispositivos WHERE token = ?').bind(token).first()

  return c.json({ ok: true, dispositivo: row }, 200)
})

// GET /dispositivos — Lista de dispositivos registrados
dispositivos.get('/', async (c) => {
  const db = c.env.DB
  const q = await db.prepare('SELECT id, token, plataforma, usuario, actualizado, creado FROM dispositivos ORDER BY actualizado DESC').all()
  return c.json(q.results)
})

// DELETE /dispositivos/:token — Baja de dispositivo
dispositivos.delete('/:token', async (c) => {
  const db = c.env.DB
  const token = decodeURIComponent(c.req.param('token'))
  const res = await db.prepare('DELETE FROM dispositivos WHERE token = ?').bind(token).run()
  return c.json({ ok: true, eliminados: res.meta?.changes ?? 0 })
})

export default dispositivos
