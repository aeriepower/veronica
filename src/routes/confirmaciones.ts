// Confirmaciones: pasarela HITL N3, bloqueo preventivo de acciones criticas
// pendientes de aprobacion de David. Ver AGENTS.md seccion 6 y Tarea
// [A6-WORKER-CONFIRMACIONES].
import { Hono } from 'hono'
import type { Env } from '../types'
import { CrearConfirmacionSchema, ResolverConfirmacionSchema } from '../types/confirmaciones'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

// Cualquier pendiente cuyo timeout (unix, segundos) ya haya pasado -> expirada.
async function expirarVencidas(db: D1Database) {
  await db
    .prepare("UPDATE confirmaciones SET estado='expirada' WHERE estado='pendiente' AND timeout IS NOT NULL AND timeout < unixepoch()")
    .run()
}

const app = new Hono<{ Bindings: Env }>()

// GET /confirmaciones y GET /confirmaciones/pendientes — alias: expira
// vencidas y devuelve las pendientes restantes, ordenadas por creado DESC.
async function listarPendientes(c: any) {
  const db = c.env.DB
  await expirarVencidas(db)
  const q = await db.prepare("SELECT * FROM confirmaciones WHERE estado='pendiente' ORDER BY creado DESC").all()
  return c.json(q.results)
}
app.get('/', listarPendientes)
app.get('/pendientes', listarPendientes)

// POST /confirmaciones
app.post('/', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = CrearConfirmacionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data

  const nuevoId = id('c')
  const ahoraUnix = Math.floor(Date.now() / 1000)
  const offsetOTimestamp = b.timeout ?? 1800
  const timeoutUnix = offsetOTimestamp < 1_000_000 ? ahoraUnix + offsetOTimestamp : offsetOTimestamp
  const args = typeof b.args === 'string' ? b.args : JSON.stringify(b.args || {})

  await db
    .prepare(
      `INSERT INTO confirmaciones
        (id, herramienta, args, nivel, resumen, actor, contexto, impacto, estado, timeout, creado)
       VALUES (?,?,?,?,?,?,?,?,'pendiente',?,?)`
    )
    .bind(nuevoId, b.herramienta, args, b.nivel, b.resumen, b.actor, b.contexto || null, b.impacto || null, timeoutUnix, ahora())
    .run()

  return c.json({ id: nuevoId, ok: true, timeout: timeoutUnix })
})

// GET /confirmaciones/:id — estado puntual (polling / verificacion de callback).
app.get('/:id', async (c) => {
  const db = c.env.DB
  const subId = c.req.param('id')
  const fila: any = await db.prepare('SELECT * FROM confirmaciones WHERE id = ?').bind(subId).first()
  if (!fila) return c.json({ error: 'no existe' }, 404)

  if (fila.estado === 'pendiente' && fila.timeout != null && fila.timeout < Math.floor(Date.now() / 1000)) {
    await db.prepare("UPDATE confirmaciones SET estado='expirada' WHERE id=? AND estado='pendiente'").bind(subId).run()
    fila.estado = 'expirada'
  }

  return c.json(fila)
})

// POST /confirmaciones/:id/resolver (y compatibilidad POST /confirmaciones/:id)
async function resolverConfirmacion(c: any) {
  const db = c.env.DB
  const subId = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = ResolverConfirmacionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data

  const actual: any = await db.prepare('SELECT * FROM confirmaciones WHERE id = ?').bind(subId).first()
  if (!actual) return c.json({ error: 'no existe' }, 404)
  if (actual.estado !== 'pendiente') {
    const yaAprobada = (actual.estado === 'aprobada' && b.decision === 'aprobar')
    const yaRechazada = (actual.estado === 'rechazada' && b.decision === 'rechazar')
    if (yaAprobada || yaRechazada) {
      let argsParsed = actual.args
      try {
        argsParsed = typeof actual.args === 'string' ? JSON.parse(actual.args) : actual.args
      } catch {}

      return c.json({
        ok: true,
        id: subId,
        estado: actual.estado,
        herramienta: actual.herramienta,
        args: argsParsed,
        nivel: actual.nivel,
        resumen: actual.resumen,
        actor: actual.actor,
        contexto: actual.contexto,
        impacto: actual.impacto,
        resuelto_por: actual.resuelto_por || b.quien,
        ya_resuelto: true
      })
    }
    return c.json({ error: `la confirmacion ya esta en estado '${actual.estado}', no se puede resolver` }, 409)
  }

  const nuevoEstado = b.decision === 'aprobar' ? 'aprobada' : 'rechazada'
  await db
    .prepare('UPDATE confirmaciones SET estado=?, resuelto_por=?, resuelto_en=? WHERE id=?')
    .bind(nuevoEstado, b.quien, ahora(), subId)
    .run()

  let argsParsed = actual.args
  try {
    argsParsed = typeof actual.args === 'string' ? JSON.parse(actual.args) : actual.args
  } catch {}

  return c.json({
    ok: true,
    id: subId,
    estado: nuevoEstado,
    herramienta: actual.herramienta,
    args: argsParsed,
    nivel: actual.nivel,
    resumen: actual.resumen,
    actor: actual.actor,
    contexto: actual.contexto,
    impacto: actual.impacto,
    resuelto_por: b.quien
  })
}
app.post('/:id/resolver', resolverConfirmacion)
app.post('/:id', resolverConfirmacion)

export default app
