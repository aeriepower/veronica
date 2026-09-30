// Rutas del grafo "vivo": planificar_cambio (mapa mental de lo que hay que
// tocar), plan_cerrar (aprendizaje), grafo_exportar, relacion_lote,
// puente memoria<->nodos y propuestas del extractor. Todo se expone tambien
// como tool MCP via app.request() (ver mcp/index.ts y mcp/tools.ts); la
// logica vive en services/planificador.ts (pura) y services/memoria_grafo.ts.
import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'
import { cargarIndice, clasificarContraIndice, normalizarNombre, tokensDescripcion, type Indice } from '../services/clasificador'
import { analizarTexto } from '../services/extraccion'
import { planificar, agrupar, severidad, type Grafo, type ItemPlan } from '../services/planificador'
import {
  cargarGrafo, recuerdosDeNodos, reprocesar, resolverPropuestas, nuevoId, LOTE_AUTO,
} from '../services/memoria_grafo'
import { RelacionLoteSchema } from '../types/nodos'

const ahora = () => new Date().toISOString()
const MAX_RESPUESTA = 20000 // caracteres: tope duro de cualquier respuesta MCP de este modulo

const app = new Hono<{ Bindings: Env }>()

// ---------------------------------------------------------------------------
// Resolucion de semillas
// ---------------------------------------------------------------------------
type Candidato = { id: string; nombre: string; tipo: string; score?: number }

function resolverRef(ix: Indice, ref: string): { nodo?: Candidato; candidatos: Candidato[] } {
  const n = ix.porId.get(ref) || ix.porNombre.get(normalizarNombre(ref))
  if (n) return { nodo: { id: n.id, nombre: n.nombre, tipo: n.tipo }, candidatos: [] }
  const cl = clasificarContraIndice(ix, { nombre: ref })
  return { candidatos: cl.candidatos.map((c) => ({ id: c.id, nombre: c.nombre, tipo: c.tipo, score: c.score })) }
}

// Sin menciones exactas en la tarea: candidatos por solapamiento de palabras.
function candidatosPorPalabras(ix: Indice, tarea: string, max = 6): Candidato[] {
  const toks = tokensDescripcion(tarea)
  if (!toks.size) return []
  const punt = ix.nodos
    .filter((n) => n.estado !== 'deprecado')
    .map((n) => {
      let s = 0
      for (const t of toks) { if (n.norm.split(' ').includes(t)) s += 2; else if (n.descTokens.has(t)) s += 1 }
      return { n, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
  return punt.map((x) => ({ id: x.n.id, nombre: x.n.nombre, tipo: x.n.tipo, score: x.s }))
}

const PlanSchema = z.object({
  tarea: z.string().min(3).max(2000).optional(),
  nodos: z.array(z.string().min(1)).max(20).optional(),
  autor: z.enum(['antigravity', 'claude', 'jarvis', 'david']).optional(),
  profundidad: z.number().int().min(1).max(8).default(5),
  umbral: z.number().min(0.05).max(0.9).default(0.25),
  contexto: z.boolean().default(true),
  detalle: z.boolean().default(false),
})

function compacto(i: ItemPlan, detalle: boolean) {
  return detalle
    ? { id: i.id, nombre: i.nombre, tipo: i.tipo, tier: i.tier, dist: i.distancia, rel: i.relevancia, via: i.via }
    : { id: i.id, nombre: i.nombre, tipo: i.tipo, rel: i.relevancia, via: i.via }
}

function grado(g: Grafo, id: string) {
  return (g.salientes.get(id)?.length || 0) + (g.entrantes.get(id)?.length || 0)
}

// POST /grafo/plan
app.post('/plan', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const p = PlanSchema.safeParse(body)
  if (!p.success) return c.json({ error: 'payload invalido', detalles: p.error.flatten() }, 400)
  const b = p.data
  if (!b.tarea && !b.nodos?.length) return c.json({ error: 'indica tarea (texto) y/o nodos (nombres o ids)' }, 400)

  const db = c.env.DB
  const ix = await cargarIndice(db)
  const semillas = new Map<string, Candidato>()
  const sinResolver: { ref: string; candidatos: Candidato[] }[] = []

  for (const ref of b.nodos || []) {
    const r = resolverRef(ix, ref)
    if (r.nodo) semillas.set(r.nodo.id, r.nodo)
    else sinResolver.push({ ref, candidatos: r.candidatos })
  }
  if (b.tarea) {
    const an = analizarTexto(ix, b.tarea)
    for (const m of an.menciones.slice(0, 8)) {
      const n = ix.porId.get(m.nodoId)!
      semillas.set(n.id, { id: n.id, nombre: n.nombre, tipo: n.tipo })
    }
  }

  if (semillas.size === 0) {
    return c.json({
      plan_id: null,
      semillas_vacias: true,
      mensaje: 'No he podido identificar de que nodos trata la tarea. Elige de candidatos y repite con nodos:[...] (o describe la tarea con los nombres de los sistemas).',
      candidatos: b.tarea ? candidatosPorPalabras(ix, b.tarea) : [],
      sin_resolver: sinResolver,
    })
  }

  const g = await cargarGrafo(db)
  const plan = planificar(g, [...semillas.keys()], { profundidad: b.profundidad, umbral: b.umbral })
  const { grupos, recortados } = agrupar(plan, 20)

  const avisos: string[] = []
  for (const s of plan.semillas) {
    const gr = grado(g, s.id)
    if (gr < 2) avisos.push(`"${s.nombre}" tiene solo ${gr} relacion(es): el mapa ahi es pobre, no te fies de que este completo.`)
  }
  if (plan.hubs.length) avisos.push(`Nodos muy conectados no expandidos (revisalos a mano si te importan): ${plan.hubs.slice(0, 8).join(', ')}.`)
  if (recortados) avisos.push(`${recortados} nodos de menor relevancia omitidos por tamano; usa un umbral mas alto o nodos mas concretos.`)
  if (sinResolver.length) avisos.push(`No resueltos: ${sinResolver.map((s) => s.ref).join(', ')} (ver sin_resolver).`)

  const criticos = plan.items.filter((i) => i.tier === 'critical' && i.relevancia >= 0.5)
  const semCriticas = plan.semillas.filter((s) => g.nodos.get(s.id)?.tier === 'critical')
  const bloqueo = plan.items.some((i) => severidad(i) === 'CRITICAL_BLOCKING' && i.relevancia >= 0.5) || semCriticas.length > 0
  const veredicto = bloqueo ? 'REQUIERE_CONFIRMACION' : 'PROCEDER'

  let contexto: unknown[] = []
  if (b.contexto) {
    const rel = new Map<string, number>()
    for (const s of plan.semillas) rel.set(s.id, 1)
    for (const i of plan.items) if (i.relevancia >= UMBRAL_CONTEXTO) rel.set(i.id, i.relevancia)
    contexto = await recuerdosDeNodos(db, rel, 8)
  }

  const planId = nuevoId('pl')
  const respuesta: Record<string, unknown> = {
    plan_id: planId,
    semillas: plan.semillas,
    resumen: {
      afectados: plan.items.length,
      tocar: grupos.tocar.length, desplegar: grupos.desplegar.length, verificar: grupos.verificar.length,
      docs: grupos.docs.length, riesgos: grupos.riesgos.length, dudoso: grupos.dudoso.length,
      criticos: criticos.map((i) => i.nombre),
    },
    veredicto,
    ...(bloqueo ? { accion: 'Nodos criticos afectados: pide confirmacion N3 a David (confirmacion_crear) antes de actuar.' } : {}),
    tocar: grupos.tocar.map((i) => compacto(i, b.detalle)),
    desplegar: grupos.desplegar.map((i) => compacto(i, b.detalle)),
    verificar: grupos.verificar.map((i) => compacto(i, b.detalle)),
    docs: grupos.docs.map((i) => compacto(i, b.detalle)),
    riesgos: grupos.riesgos.map((i) => compacto(i, b.detalle)),
    dudoso: grupos.dudoso.map((i) => compacto(i, b.detalle)),
    contexto,
    avisos,
    ...(sinResolver.length ? { sin_resolver: sinResolver } : {}),
    siguiente_paso: 'Cuando termines, llama a plan_cerrar con plan_id y los nodos que realmente tocaste: asi el mapa aprende lo que faltaba.',
  }
  recortarRespuesta(respuesta)

  const ids = plan.items.map((i) => i.id)
  await db
    .prepare('INSERT INTO planes_cambio (id, tarea, autor, semillas, resultado, creado) VALUES (?,?,?,?,?,?)')
    .bind(planId, b.tarea || null, b.autor || null, JSON.stringify(plan.semillas), JSON.stringify({ ids, roles: Object.fromEntries(plan.items.map((i) => [i.id, [i.rol, i.relevancia]])) }), ahora())
    .run()

  return c.json(respuesta)
})

const UMBRAL_CONTEXTO = 0.3

// Recorta listas hasta que la respuesta cabe en MAX_RESPUESTA caracteres.
function recortarRespuesta(r: Record<string, unknown>) {
  const listas = ['dudoso', 'contexto', 'docs', 'verificar', 'desplegar', 'riesgos', 'tocar']
  let guard = 0
  while (JSON.stringify(r).length > MAX_RESPUESTA && guard++ < 200) {
    const l = listas.map((k) => r[k] as unknown[]).filter((a) => Array.isArray(a) && a.length > 3).sort((a, b) => b.length - a.length)[0]
    if (!l) break
    l.pop()
    r.recortado = true
  }
}

// POST /grafo/plan/:id/cerrar
const CerrarSchema = z.object({
  tocados: z.array(z.string().min(1)).max(100),
  autor: z.enum(['antigravity', 'claude', 'jarvis', 'david']).optional(),
  notas: z.string().max(1000).optional(),
})
app.post('/plan/:id/cerrar', async (c) => {
  const db = c.env.DB
  const planId = c.req.param('id')
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const p = CerrarSchema.safeParse(body)
  if (!p.success) return c.json({ error: 'payload invalido', detalles: p.error.flatten() }, 400)

  const fila = await db.prepare('SELECT * FROM planes_cambio WHERE id = ?').bind(planId).first<any>()
  if (!fila) return c.json({ error: `plan '${planId}' no encontrado` }, 404)
  if (fila.cerrado) return c.json({ error: 'plan ya cerrado', cierre: JSON.parse(fila.cierre) }, 409)

  const ix = await cargarIndice(db)
  const semillas: { id: string; nombre: string }[] = JSON.parse(fila.semillas)
  const res = JSON.parse(fila.resultado) as { ids: string[]; roles: Record<string, [string, number]> }
  const previstos = new Set<string>([...res.ids, ...semillas.map((s) => s.id)])

  const tocados = new Map<string, string>()
  const sinResolver: string[] = []
  for (const ref of p.data.tocados) {
    const n = ix.porId.get(ref) || ix.porNombre.get(normalizarNombre(ref))
    if (n) tocados.set(n.id, n.nombre); else sinResolver.push(ref)
  }
  const aciertos = [...tocados.keys()].filter((id) => previstos.has(id))
  const faltaron = [...tocados.entries()].filter(([id]) => !previstos.has(id)).map(([id, nombre]) => ({ id, nombre }))
  const fuertes = [...previstos].filter((id) => (res.roles[id]?.[1] ?? 0) >= 0.5 && ['tocar', 'desplegar'].includes(res.roles[id]?.[0]))
  const sobraron = fuertes.filter((id) => !tocados.has(id) && ix.porId.has(id)).map((id) => ix.porId.get(id)!.nombre).slice(0, 15)

  const t = ahora()
  const stmts: D1PreparedStatement[] = []
  let propuestas = 0
  for (const f of faltaron) {
    const sem = semillas[0]
    if (!sem || sem.id === f.id) continue
    propuestas++
    stmts.push(
      db.prepare("INSERT OR IGNORE INTO propuestas_grafo (id, clase, clave, payload, observacion_id, evidencia, confianza, fuente, estado, creado) VALUES (?,'relacion',?,?,NULL,?,0.4,'plan','pendiente',?)")
        .bind(nuevoId('pg'), `rel:${sem.id}|${f.id}|conectado_a`, JSON.stringify({ origen: sem.id, destino: f.id, tipo: 'conectado_a' }), `plan ${planId}: se tuvo que tocar "${f.nombre}" y el mapa no lo preveia desde "${sem.nombre}"`.slice(0, 300), t)
    )
  }
  const cierre = {
    aciertos: aciertos.length, faltaron: faltaron.map((f) => f.nombre), sobraron, sin_resolver: sinResolver,
    precision: fuertes.length ? Math.round((aciertos.length / Math.max(1, tocados.size)) * 100) / 100 : null,
    recall: tocados.size ? Math.round((aciertos.length / tocados.size) * 100) / 100 : null,
    notas: p.data.notas || null,
  }
  stmts.push(db.prepare('UPDATE planes_cambio SET cierre = ?, cerrado = ? WHERE id = ?').bind(JSON.stringify(cierre), t, planId))
  await db.batch(stmts)
  return c.json({ plan_id: planId, ...cierre, propuestas_creadas: propuestas, aviso: propuestas ? 'Relaciones sugeridas guardadas como propuestas (propuesta_listar / propuesta_resolver).' : undefined })
})

// ---------------------------------------------------------------------------
// Exportar grafo (paginado): base del visor vivo
// ---------------------------------------------------------------------------
app.get('/exportar', async (c) => {
  const db = c.env.DB
  const parte = c.req.query('parte') === 'relaciones' ? 'relaciones' : 'nodos'
  const desde = Math.max(0, parseInt(c.req.query('desde') || '0', 10) || 0)
  const limite = Math.min(500, Math.max(1, parseInt(c.req.query('limite') || '200', 10) || 200))
  const conDesc = c.req.query('descripciones') === '1'
  const tabla = parte === 'nodos' ? 'nodos' : 'relaciones'
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).first<{ n: number }>())?.n || 0
  const sql =
    parte === 'nodos'
      ? `SELECT id, nombre, tipo, tier, estado${conDesc ? ', substr(descripcion,1,160) AS descripcion' : ''} FROM nodos ORDER BY id LIMIT ? OFFSET ?`
      : 'SELECT origen, destino, tipo, is_blocking FROM relaciones ORDER BY id LIMIT ? OFFSET ?'
  const filas = (await db.prepare(sql).bind(limite, desde).all()).results || []
  const siguiente = desde + filas.length < total ? desde + filas.length : null
  return c.json({ parte, total, desde, siguiente, [parte]: filas })
})

// ---------------------------------------------------------------------------
// relacion_lote
// ---------------------------------------------------------------------------
const RelLoteSchema = z.object({
  lote_id: z.string().min(1).max(64).optional(),
  modo: z.enum(['simular', 'aplicar']).default('simular'),
  autor: z.string().optional(),
  relaciones: z.array(RelacionLoteSchema).min(1).max(300),
})
app.post('/relaciones/lote', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const p = RelLoteSchema.safeParse(body)
  if (!p.success) return c.json({ error: 'payload invalido', detalles: p.error.flatten() }, 400)
  const b = p.data
  const aplicar = b.modo === 'aplicar'
  const lote = b.lote_id || nuevoId('lote')
  const ix = await cargarIndice(db)
  const t = ahora()
  const stmts: D1PreparedStatement[] = []
  const out: { origen: string; destino: string; tipo: string; resultado: string; motivo?: string }[] = []
  for (const r of b.relaciones) {
    const no = ix.porId.get(r.origen) || ix.porNombre.get(normalizarNombre(r.origen))
    const nd = ix.porId.get(r.destino) || ix.porNombre.get(normalizarNombre(r.destino))
    if (!no || !nd) { out.push({ origen: r.origen, destino: r.destino, tipo: r.tipo, resultado: 'sin_resolver', motivo: !no ? `origen "${r.origen}" no existe` : `destino "${r.destino}" no existe` }); continue }
    if (no.id === nd.id) { out.push({ origen: no.nombre, destino: nd.nombre, tipo: r.tipo, resultado: 'omitida', motivo: 'origen = destino' }); continue }
    const key = `${no.id}|${nd.id}|${r.tipo}`
    if (ix.relSet.has(key)) { out.push({ origen: no.nombre, destino: nd.nombre, tipo: r.tipo, resultado: 'ya_existe' }); continue }
    ix.relSet.add(key)
    out.push({ origen: no.nombre, destino: nd.nombre, tipo: r.tipo, resultado: 'creada' })
    if (aplicar) {
      stmts.push(db.prepare('INSERT INTO relaciones (id, origen, destino, tipo, descripcion, confianza, is_blocking, creado, autor, lote) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .bind(nuevoId('r'), no.id, nd.id, r.tipo, r.descripcion || null, r.confianza, r.is_blocking ? 1 : 0, t, b.autor || null, lote))
    }
  }
  let error: string | null = null
  if (aplicar) {
    try { for (let k = 0; k < stmts.length; k += 50) await db.batch(stmts.slice(k, k + 50)) } catch (e: any) { error = String(e?.message || e) }
  }
  const cuenta = (x: string) => out.filter((o) => o.resultado === x).length
  return c.json({
    lote_id: lote, modo: b.modo, aplicado: aplicar && !error, error_escritura: error,
    resumen: { total: out.length, creadas: cuenta('creada'), ya_existen: cuenta('ya_existe'), sin_resolver: cuenta('sin_resolver'), omitidas: cuenta('omitida') },
    relaciones: out.filter((o) => o.resultado !== 'creada' || out.length <= 60).slice(0, 80),
    deshacer: `DELETE /nodos/lote/${lote}?confirmar=true`,
  }, error ? 500 : 200)
})

// ---------------------------------------------------------------------------
// Puente memoria <-> nodos
// ---------------------------------------------------------------------------
// GET /grafo/memoria/:nodo?vecinos=1&max=10
app.get('/memoria/:nodo', async (c) => {
  const db = c.env.DB
  const ref = decodeURIComponent(c.req.param('nodo'))
  const ix = await cargarIndice(db)
  const r = resolverRef(ix, ref)
  if (!r.nodo) return c.json({ error: `nodo '${ref}' no encontrado`, candidatos: r.candidatos }, 404)
  const max = Math.min(30, Math.max(1, parseInt(c.req.query('max') || '10', 10) || 10))
  const rel = new Map<string, number>([[r.nodo.id, 1]])
  if (c.req.query('vecinos') === '1') {
    const g = await cargarGrafo(db)
    for (const i of planificar(g, [r.nodo.id], { profundidad: 1, umbral: 0.3 }).items) rel.set(i.id, i.relevancia)
  }
  const recuerdos = await recuerdosDeNodos(db, rel, max, 400)
  return c.json({ nodo: r.nodo, vecinos_incluidos: c.req.query('vecinos') === '1', recuerdos })
})

// POST /grafo/memoria/enlazar  {modo, enlaces:[{nodo, observacion, tipo?, fuerza?}]}  o  {auto:true, ...}
const EnlazarSchema = z.object({
  modo: z.enum(['simular', 'aplicar']).default('simular'),
  auto: z.boolean().default(false),
  ia: z.boolean().default(false),
  desde: z.number().int().min(0).default(0),
  limite: z.number().int().min(1).max(200).default(100),
  incluir_archivadas: z.boolean().default(false),
  enlaces: z.array(z.object({
    nodo: z.string().min(1), observacion: z.string().min(1),
    tipo: z.enum(['sobre', 'menciona']).default('menciona'), fuerza: z.number().min(0).max(1).default(0.8),
  })).max(300).optional(),
})
app.post('/memoria/enlazar', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const p = EnlazarSchema.safeParse(body)
  if (!p.success) return c.json({ error: 'payload invalido', detalles: p.error.flatten() }, 400)
  const b = p.data
  const aplicar = b.modo === 'aplicar'
  if (b.auto) return c.json(await reprocesar(c.env, { aplicar, ia: b.ia, desde: b.desde, limite: b.limite, incluir_archivadas: b.incluir_archivadas }))
  if (!b.enlaces?.length) return c.json({ error: 'indica enlaces:[...] o auto:true' }, 400)
  const db = c.env.DB
  const ix = await cargarIndice(db)
  const t = ahora()
  const stmts: D1PreparedStatement[] = []
  const out: { nodo: string; observacion: string; resultado: string }[] = []
  for (const e of b.enlaces) {
    const n = ix.porId.get(e.nodo) || ix.porNombre.get(normalizarNombre(e.nodo))
    const o = await db.prepare('SELECT id FROM memory_observations WHERE id = ?').bind(e.observacion).first()
    if (!n || !o) { out.push({ nodo: e.nodo, observacion: e.observacion, resultado: !n ? 'nodo_no_existe' : 'observacion_no_existe' }); continue }
    out.push({ nodo: n.nombre, observacion: e.observacion, resultado: 'enlazada' })
    if (aplicar) stmts.push(db.prepare("INSERT INTO nodo_memoria (id, nodo_id, observacion_id, tipo, fuerza, origen, creado) VALUES (?,?,?,?,?,'manual',?) ON CONFLICT(nodo_id, observacion_id) DO UPDATE SET tipo=excluded.tipo, fuerza=excluded.fuerza, origen='manual'").bind(nuevoId('nm'), n.id, e.observacion, e.tipo, e.fuerza, t))
  }
  for (let k = 0; k < stmts.length; k += 50) await db.batch(stmts.slice(k, k + 50))
  return c.json({ modo: b.modo, resumen: { enlazadas: out.filter((o) => o.resultado === 'enlazada').length, fallidas: out.filter((o) => o.resultado !== 'enlazada').length }, enlaces: out.slice(0, 80) })
})

// ---------------------------------------------------------------------------
// Propuestas del extractor
// ---------------------------------------------------------------------------
app.get('/propuestas', async (c) => {
  const db = c.env.DB
  const estado = c.req.query('estado') || 'pendiente'
  const clase = c.req.query('clase')
  const limite = Math.min(100, Math.max(1, parseInt(c.req.query('limite') || '30', 10) || 30))
  const where = ['estado = ?']; const binds: unknown[] = [estado]
  if (clase) { where.push('clase = ?'); binds.push(clase) }
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM propuestas_grafo WHERE ${where.join(' AND ')}`).bind(...binds).first<{ n: number }>())?.n || 0
  const filas = (await db.prepare(`SELECT id, clase, payload, evidencia, confianza, fuente, observacion_id, creado FROM propuestas_grafo WHERE ${where.join(' AND ')} ORDER BY confianza DESC, creado DESC LIMIT ?`).bind(...binds, limite).all<any>()).results || []
  const ix = await cargarIndice(db)
  const nombre = (id: string) => ix.porId.get(id)?.nombre || id
  return c.json({
    total, mostradas: filas.length,
    propuestas: filas.map((f) => {
      const pl = JSON.parse(f.payload)
      return { id: f.id, clase: f.clase, ...(f.clase === 'relacion' ? { origen: nombre(pl.origen), destino: nombre(pl.destino), tipo: pl.tipo } : { nombre: pl.nombre, tipo: pl.tipo }), confianza: f.confianza, fuente: f.fuente, evidencia: f.evidencia, observacion: f.observacion_id }
    }),
  })
})

const ResolverSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  decision: z.enum(['aprobar', 'rechazar']),
  quien: z.enum(['antigravity', 'claude', 'jarvis', 'david']),
})
app.post('/propuestas/resolver', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const p = ResolverSchema.safeParse(body)
  if (!p.success) return c.json({ error: 'payload invalido', detalles: p.error.flatten() }, 400)
  return c.json(await resolverPropuestas(c.env, p.data.ids, p.data.decision, p.data.quien))
})

export default app
export { LOTE_AUTO }
