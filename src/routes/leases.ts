// Leases: exclusion mutua distribuida entre pilares sobre un recurso
// compartido (fichero, nodo, workflow de n8n...). Ver AGENTS.md seccion 0 y
// Tarea [A8-D1-LEASES].
import { Hono } from 'hono'
import type { Env } from '../types'
import { AdquirirLeaseSchema, LiberarLeaseSchema } from '../types/leases'
import { acquireLease, releaseLease, getActiveLeases } from '../services/leases'

const app = new Hono<{ Bindings: Env }>()

// GET /leases — leases actualmente activos (expira vencidos primero).
app.get('/', async (c) => {
  const leases = await getActiveLeases(c.env.DB)
  return c.json(leases)
})

// POST /leases/adquirir
app.post('/adquirir', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = AdquirirLeaseSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data

  const resultado = await acquireLease(c.env.DB, {
    recurso: b.recurso,
    titular: b.titular,
    ttlSegundos: b.ttl_segundos,
    motivo: b.motivo,
  })

  if (resultado.acquired) {
    return c.json({ ok: true, acquired: true, lease_id: resultado.lease_id, expira: resultado.expira })
  }
  return c.json(
    { ok: false, acquired: false, error: 'recurso_bloqueado', titular_actual: resultado.titular_actual, expira: resultado.expira },
    409
  )
})

// POST /leases/liberar
app.post('/liberar', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = LiberarLeaseSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data

  const resultado = await releaseLease(c.env.DB, b)
  return c.json({ ok: true, released: resultado.released })
})

export default app
