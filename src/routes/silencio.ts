// Silencio: motor de interrupcion selectiva, registro de eventos evaluados y
// digest diario. Ver Santo Grial Fase D y Tarea [D1-SILENCIO-MOTOR-INTERRUPCION].
import { Hono } from 'hono'
import type { Env } from '../types'
import {
  DespacharDigestSchema,
  EvaluarCorazonadaSchema,
  FactoresInterrupcionSchema,
  GenerarDigestSchema,
  RegistrarEventoSchema,
} from '../types/silencio'
import { calcularInterrupcion } from '../services/silencio'
import { evaluarCorazonada } from '../services/corazonada'
import { generarDigest } from '../services/digest'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

const app = new Hono<{ Bindings: Env }>()

// POST /silencio/evaluar — calcula I y devuelve el canal, sin persistir nada.
app.post('/evaluar', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = FactoresInterrupcionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }

  return c.json(calcularInterrupcion(parsed.data))
})

// POST /silencio/eventos — evalua y registra el evento en silencio_eventos.
app.post('/eventos', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = RegistrarEventoSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data
  const resultado = calcularInterrupcion(b.factores)
  const eventoId = id('sev')

  await db
    .prepare(
      `INSERT INTO silencio_eventos (id, titulo, resumen, score, canal, factores, estado, creado)
       VALUES (?,?,?,?,?,?,'pendiente',?)`
    )
    .bind(eventoId, b.titulo, b.resumen || null, resultado.score, resultado.canal, JSON.stringify(b.factores), ahora())
    .run()

  return c.json({ id: eventoId, ...resultado })
})

// POST /silencio/corazonada/evaluar — evalua si un evento califica como
// corazonada tecnica (seccion 12.3), sin persistir nada.
app.post('/corazonada/evaluar', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = EvaluarCorazonadaSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }

  return c.json(evaluarCorazonada(parsed.data))
})

// GET /silencio/digest-pendiente — eventos en espera del digest diario.
app.get('/digest-pendiente', async (c) => {
  const db = c.env.DB
  const q = await db
    .prepare("SELECT * FROM silencio_eventos WHERE canal='digest_diario' AND estado='pendiente' ORDER BY creado DESC")
    .all()
  return c.json(q.results)
})

// POST /silencio/digest-despachado — marca el digest pendiente (o los ids
// indicados) como despachado.
app.post('/digest-despachado', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => ({}))
  const parsed = DespacharDigestSchema.safeParse(body ?? {})
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const ids = parsed.data.ids

  if (ids && ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',')
    await db
      .prepare(
        `UPDATE silencio_eventos SET estado='despachado' WHERE canal='digest_diario' AND estado='pendiente' AND id IN (${placeholders})`
      )
      .bind(...ids)
      .run()
  } else {
    await db
      .prepare("UPDATE silencio_eventos SET estado='despachado' WHERE canal='digest_diario' AND estado='pendiente'")
      .run()
  }

  return c.json({ ok: true })
})

// POST /silencio/digest/generar — genera y despacha el digest manualmente.
app.post('/digest/generar', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = GenerarDigestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }

  const resultado = await generarDigest(db, parsed.data.momento)
  return c.json(resultado)
})

// GET /silencio/digest/ultimo — ultimo briefing generado (memoria canonica).
app.get('/digest/ultimo', async (c) => {
  const db = c.env.DB
  const row = await db
    .prepare(
      `SELECT mo.texto, mo.fecha, mi.nombre as item_nombre
       FROM memory_observations mo
       JOIN memory_items mi ON mi.id = mo.item_id
       WHERE mi.nombre LIKE 'digest-%' AND mo.estado = 'activo'
       ORDER BY mo.fecha DESC
       LIMIT 1`
    )
    .first()

  if (!row) return c.json({ error: 'no hay ningun digest generado todavia' }, 404)
  return c.json(row)
})

export default app
