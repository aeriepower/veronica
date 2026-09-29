// Objetivos: bus de tareas asincronas entre pilares (idempotente). Ver
// AGENTS.md seccion 6 y Tarea [A5-WORKER-OBJETIVOS].
import { Hono } from 'hono'
import type { Env } from '../types'
import { CrearObjetivoSchema, ActualizarObjetivoSchema } from '../types/objetivos'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

function parseFila(r: any) {
  return {
    ...r,
    historial: JSON.parse(r.historial || '[]'),
    resultado_json: r.resultado_json ? JSON.parse(r.resultado_json) : null,
    artefactos: r.artefactos ? JSON.parse(r.artefactos) : null,
  }
}

function normalizarResultadoJson(v: unknown): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function normalizarArtefactos(v: unknown): string {
  return JSON.stringify(Array.isArray(v) ? v : [v])
}

const app = new Hono<{ Bindings: Env }>()

// GET /objetivos?estado=&asignado_a=&responsable=
app.get('/', async (c) => {
  const db = c.env.DB
  const estado = c.req.query('estado')
  const asignadoA = c.req.query('asignado_a') || c.req.query('responsable')

  const condiciones: string[] = []
  const params: unknown[] = []
  if (estado) {
    condiciones.push('estado = ?')
    params.push(estado)
  }
  if (asignadoA) {
    condiciones.push('(asignado_a = ? OR responsable = ?)')
    params.push(asignadoA, asignadoA)
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : ''

  const q = await db
    .prepare(`SELECT * FROM objetivos ${where} ORDER BY actualizado DESC`)
    .bind(...params)
    .all()
  return c.json(q.results.map(parseFila))
})

// GET /objetivos/:id
app.get('/:id', async (c) => {
  const db = c.env.DB
  const fila = await db.prepare('SELECT * FROM objetivos WHERE id = ?').bind(c.req.param('id')).first()
  if (!fila) return c.json({ error: 'no existe' }, 404)
  return c.json(parseFila(fila))
})

// POST /objetivos — idempotente via header Idempotency-Key (o body.idempotency_key)
app.post('/', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const claveIdempotencia = c.req.header('idempotency-key') || body.idempotency_key
  if (claveIdempotencia) {
    const existente = await db.prepare('SELECT * FROM objetivos WHERE idempotency_key = ?').bind(claveIdempotencia).first()
    if (existente) {
      c.header('X-Idempotent-Replay', 'true')
      return c.json({ id: existente.id, ok: true })
    }
  }

  const parsed = CrearObjetivoSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data
  const nuevoId = id('o')
  const fecha = ahora()
  const historial = [{ estado: 'pendiente', cuando: fecha, quien: b.creado_por }]

  await db
    .prepare(
      `INSERT INTO objetivos
        (id, titulo, descripcion, responsable, asignado_a, creado_por, estado, prioridad, avisar_al_terminar, historial, timeout, idempotency_key, creado, actualizado)
       VALUES (?,?,?,?,?,?,'pendiente',?,?,?,?,?,?,?)`
    )
    .bind(
      nuevoId,
      b.titulo,
      b.descripcion || null,
      b.asignado_a,
      b.asignado_a,
      b.creado_por,
      b.prioridad,
      b.avisar_al_terminar ? 1 : 0,
      JSON.stringify(historial),
      b.timeout ?? null,
      claveIdempotencia || null,
      fecha,
      fecha
    )
    .run()

  return c.json({ id: nuevoId, ok: true })
})

// Transicion de estado, compartida por PATCH /objetivos/:id/estado y el
// alias legacy POST /objetivos/:id.
async function actualizarEstado(c: any) {
  const db = c.env.DB
  const sub = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = ActualizarObjetivoSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data

  const actual: any = await db.prepare('SELECT * FROM objetivos WHERE id = ?').bind(sub).first()
  if (!actual) return c.json({ error: 'no existe' }, 404)

  const historial = JSON.parse(actual.historial || '[]')
  historial.push({ estado: b.estado, cuando: ahora(), quien: b.quien || 'desconocido' })

  const esFinal = b.estado === 'completado' || b.estado === 'hecho'
  const resultadoJson = esFinal && b.resultado_json !== undefined ? normalizarResultadoJson(b.resultado_json) : actual.resultado_json
  const artefactos = esFinal && b.artefactos !== undefined ? normalizarArtefactos(b.artefactos) : actual.artefactos

  await db
    .prepare('UPDATE objetivos SET estado=?, historial=?, resultado_json=?, artefactos=?, actualizado=? WHERE id=?')
    .bind(b.estado, JSON.stringify(historial), resultadoJson, artefactos, ahora(), sub)
    .run()

  return c.json({ ok: true, estado_anterior: actual.estado, estado_nuevo: b.estado })
}

// PATCH /objetivos/:id/estado — transicion de estado
app.patch('/:id/estado', actualizarEstado)

// POST /objetivos/:id — alias legacy de PATCH /objetivos/:id/estado
app.post('/:id', actualizarEstado)

export default app
