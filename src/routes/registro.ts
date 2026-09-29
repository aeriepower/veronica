// Registro de auditoria: quien hizo que, con que riesgo y resultado.
// Extraido de index.ts para poder reutilizarlo desde MCP via app.request()
// sin duplicar logica. [MCP-A13].
import { Hono } from 'hono'
import type { Env } from '../types'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

const app = new Hono<{ Bindings: Env }>()

// GET /registro?n=
app.get('/', async (c) => {
  const db = c.env.DB
  const n = Number(c.req.query('n') || 50)
  const q = await db.prepare('SELECT * FROM registro ORDER BY ts DESC LIMIT ?').bind(n).all()
  return c.json(q.results)
})

// POST /registro
app.post('/', async (c) => {
  const db = c.env.DB
  const b = await c.req.json()
  const nuevoId = id('r')
  await db.prepare(
    'INSERT INTO registro (id, actor, herramienta, riesgo, args, resultado, ok, ms, ts) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(nuevoId, b.actor, b.herramienta, b.riesgo, JSON.stringify(b.args || {}), b.resultado || null, b.ok ? 1 : 0, b.ms || null, ahora()).run()
  return c.json({ id: nuevoId })
})

export default app
