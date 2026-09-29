// Nodos del grafo de infraestructura. Reutilizado por MCP via app.request().
// [CLASIFICADOR-NODOS v2, 29-sep-2026]: clasifica por nombre/alias/identificador/
// tipo/descripcion contra un indice en memoria, completa campos de nodos nuevos
// (sugerido) y admite carga por lotes (POST /nodos/lote) con 2 lecturas y
// escrituras en db.batch() para que sembrar cientos de nodos sea cuestion de segundos.
import { Hono } from 'hono'
import type { Env } from '../types'
import { CrearNodoSchema, ClasificarNodoSchema, LoteSchema, NODO_TIPOS, type ItemLote } from '../types/nodos'
import { cargarIndice, clasificarContraIndice, anadirAlIndice, nuevoNodoIndice, normalizarNombre, normalizarIdentificador, type Indice } from '../services/clasificador'
import { sugerir, inferirIA, type Sugerido } from '../services/inferencia'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
const ahora = () => new Date().toISOString()

const CONF_TIPO = 0.6
const CONF_REL = 0.75
const CONF_TEMA = 0.6
const MAX_IA = 25

const app = new Hono<{ Bindings: Env }>()

function sugeridoPlano(s: Sugerido) {
  return s
}

// GET /nodos?tipo=&estado=
app.get('/', async (c) => {
  const db = c.env.DB
  const tipo = c.req.query('tipo')
  const estado = c.req.query('estado')
  if (tipo && !(NODO_TIPOS as readonly string[]).includes(tipo)) {
    return c.json({ error: `tipo invalido: debe ser uno de ${NODO_TIPOS.join(', ')}` }, 400)
  }
  const where: string[] = []
  const binds: string[] = []
  if (tipo) { where.push('tipo = ?'); binds.push(tipo) }
  if (estado) { where.push('estado = ?'); binds.push(estado) }
  const sql = `SELECT * FROM nodos${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY nombre`
  const q = await db.prepare(sql).bind(...binds).all()
  return c.json(q.results)
})

async function clasificarConSugerencias(c: any, entrada: any, ia: boolean) {
  const ix = await cargarIndice(c.env.DB)
  const r = clasificarContraIndice(ix, entrada)
  if (r.decision !== 'nuevo') return { ...r }
  const sugerido = sugerir(ix, entrada)
  if (ia && c.env.AI) {
    const g = await inferirIA(c.env, entrada, ix.nodos.slice(0, 15).map((n) => n.nombre))
    if (g?.descripcion) sugerido.descripcion = { valor: g.descripcion, confianza: 0.6, motivo: 'IA (Workers AI)' }
    if (g?.tema && !sugerido.tema) sugerido.tema = { valor: g.tema, confianza: 0.5, motivo: 'IA (Workers AI)' }
  }
  return { ...r, sugerido: sugeridoPlano(sugerido) }
}

// GET /nodos/clasificar?nombre=&tipo=  (compatibilidad)
app.get('/clasificar', async (c) => {
  const nombre = c.req.query('nombre')
  const tipo = c.req.query('tipo')
  if (!nombre) return c.json({ error: 'falta el parametro ?nombre=' }, 400)
  if (tipo && !(NODO_TIPOS as readonly string[]).includes(tipo)) {
    return c.json({ error: `tipo invalido: debe ser uno de ${NODO_TIPOS.join(', ')}` }, 400)
  }
  return c.json(await clasificarConSugerencias(c, { nombre, tipo }, false))
})

// POST /nodos/clasificar — solo lectura, acepta todos los campos
app.post('/clasificar', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const p = ClasificarNodoSchema.safeParse(body)
  if (!p.success) return c.json({ error: 'payload invalido', detalles: p.error.flatten() }, 400)
  const { ia, ...entrada } = p.data
  return c.json(await clasificarConSugerencias(c, { ...entrada, data: undefined }, !!ia))
})

const INSERT_NODO =
  'INSERT OR IGNORE INTO nodos (id, nombre, tipo, descripcion, tier, creado, autor, origen, identificador, alias, estado, data, lote) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'

// POST /nodos
app.post('/', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const parsed = CrearNodoSchema.safeParse(body)
  if (!parsed.success) return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  const b = parsed.data

  const ix = await cargarIndice(db)
  const cl = clasificarContraIndice(ix, b)
  if (cl.decision === 'existe_exacto') {
    return c.json({ id: cl.candidatos[0].id, duplicado: true, motivo: cl.candidatos[0].motivo, candidatos: cl.candidatos })
  }
  if (cl.decision === 'posible_duplicado' && !b.forzar) {
    return c.json(
      { error: 'posible_duplicado', mensaje: 'Hay nodos existentes parecidos. Revisa candidatos o reintenta con forzar:true si es realmente distinto.', candidatos: cl.candidatos },
      409
    )
  }
  const nodoId = b.id || id('n')
  await db
    .prepare(INSERT_NODO)
    .bind(nodoId, b.nombre, b.tipo, b.descripcion || null, b.tier, ahora(), b.autor || null, b.origen || null,
      b.identificador ? normalizarIdentificador(b.identificador) : null, b.alias ? JSON.stringify(b.alias) : null, b.estado || 'activo', b.data || null, null)
    .run()
  return c.json({ id: nodoId, duplicado: false })
})

type Resultado = {
  i: number
  nombre: string
  resultado: 'creado' | 'existente' | 'actualizado' | 'pendiente' | 'incompleto'
  id?: string
  tipo?: string
  motivo?: string
  candidatos?: unknown
  inferido?: string[]
}

// POST /nodos/lote
app.post('/lote', async (c) => {
  const t0 = Date.now()
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const p = LoteSchema.safeParse(body)
  if (!p.success) return c.json({ error: 'payload invalido', detalles: p.error.flatten() }, 400)
  const b = p.data
  const aplicar = b.modo === 'aplicar'
  const lote = b.lote_id || id('lote')
  const creado = ahora()

  const ix: Indice = await cargarIndice(db)
  const resultados: Resultado[] = []
  type Nuevo = { it: ItemLote; res: Resultado; nodoId: string; tipo: string; sug: Sugerido; data: Record<string, unknown>; desc: string | null; inferido: string[] }
  const nuevos: Nuevo[] = []
  const stmts: D1PreparedStatement[] = []
  let actualizados = 0

  // Pasada A: clasificar en memoria (el indice crece con los nuevos: detecta duplicados dentro del propio lote)
  b.items.forEach((it, i) => {
    const res: Resultado = { i, nombre: it.nombre, resultado: 'pendiente' }
    resultados.push(res)
    const cl = clasificarContraIndice(ix, it)

    if (cl.decision === 'existe_exacto') {
      const ex = ix.porId.get(cl.candidatos[0].id)!
      res.resultado = 'existente'; res.id = ex.id; res.motivo = cl.candidatos[0].motivo
      if (b.actualizar && aplicar) {
        const alias = new Set(ex.alias)
        for (const a of it.alias || []) alias.add(a)
        if (normalizarNombre(it.nombre) !== ex.norm) alias.add(it.nombre)
        let dataNueva: string | null = ex.data
        if (it.data) {
          let viejo: Record<string, unknown> = {}
          try { viejo = ex.data ? JSON.parse(ex.data) : {} } catch { /* ignorar */ }
          dataNueva = JSON.stringify({ ...viejo, ...JSON.parse(it.data) })
        }
        stmts.push(
          db.prepare('UPDATE nodos SET alias=?, data=?, descripcion=COALESCE(descripcion,?), origen=COALESCE(origen,?), identificador=COALESCE(identificador,?) WHERE id=?')
            .bind(alias.size ? JSON.stringify([...alias]) : null, dataNueva, it.descripcion || null, it.origen || b.origen || null,
              it.identificador ? normalizarIdentificador(it.identificador) : null, ex.id)
        )
        res.resultado = 'actualizado'; actualizados++
      }
      return
    }
    if (cl.decision === 'posible_duplicado' && !it.forzar) {
      res.resultado = 'pendiente'; res.motivo = 'posible_duplicado'; res.candidatos = cl.candidatos.slice(0, 3)
      return
    }
    // nuevo (o forzado)
    const sug = sugerir(ix, it)
    const inferido: string[] = []
    let tipo = it.tipo
    if (!tipo && sug.tipo && sug.tipo.confianza >= CONF_TIPO) { tipo = sug.tipo.valor as ItemLote['tipo']; inferido.push('tipo') }
    if (!tipo) { res.resultado = 'incompleto'; res.motivo = 'no se pudo inferir el tipo con confianza; indicalo en el item'; return }
    if (it.tier === 'critical' && !it.forzar) { res.resultado = 'pendiente'; res.motivo = 'tier critical requiere revision (usa forzar:true tras revisarlo)'; return }

    const data: Record<string, unknown> = it.data ? JSON.parse(it.data) : {}
    if (sug.tema && sug.tema.confianza >= CONF_TEMA && data.tema === undefined) { data.tema = sug.tema.valor; inferido.push('tema') }
    if (sug.tecnologia && data.tecnologia === undefined) { data.tecnologia = sug.tecnologia.valor; inferido.push('tecnologia') }

    const nodoId = it.id || id('n')
    const nuevo = nuevoNodoIndice({ id: nodoId, nombre: it.nombre, tipo, tier: it.tier, descripcion: it.descripcion, alias: it.alias, identificador: it.identificador, estado: it.estado })
    anadirAlIndice(ix, nuevo)
    res.resultado = 'creado'; res.id = nodoId; res.tipo = tipo
    nuevos.push({ it, res, nodoId, tipo, sug, data, desc: it.descripcion || null, inferido })
  })

  // Pasada B: IA solo para nuevos sin descripcion (en paralelo, tope MAX_IA)
  if (b.ia && c.env.AI) {
    const pend = nuevos.filter((n) => !n.desc).slice(0, MAX_IA)
    const ctx = ix.nodos.slice(0, 15).map((n) => n.nombre)
    for (let k = 0; k < pend.length; k += 8) {
      await Promise.all(pend.slice(k, k + 8).map(async (n) => {
        const g = await inferirIA(c.env, { nombre: n.it.nombre, tipo: n.tipo }, ctx)
        if (g?.descripcion) { n.desc = g.descripcion; n.inferido.push('descripcion') }
        if (g?.tema && n.data.tema === undefined) { n.data.tema = g.tema; n.inferido.push('tema') }
      }))
    }
  }
  // sin IA, la descripcion sugerida (plantilla) solo se devuelve, no se guarda

  // Pasada C: sentencias de insercion de nodos
  for (const n of nuevos) {
    if (n.inferido.length) n.data.inferido = n.inferido
    n.res.inferido = n.inferido
    if (aplicar) {
      const hayData = Object.keys(n.data).length > 0
      stmts.push(
        db.prepare(INSERT_NODO).bind(n.nodoId, n.it.nombre, n.tipo, n.desc, n.it.tier || 'standard', creado, n.it.autor || b.autor || null,
          n.it.origen || b.origen || null, n.it.identificador ? normalizarIdentificador(n.it.identificador) : null,
          n.it.alias?.length ? JSON.stringify(n.it.alias) : null, n.it.estado || 'activo', hayData ? JSON.stringify(n.data) : null, lote)
      )
    }
  }

  // Relaciones: explicitas + sugeridas (padre con confianza alta). Se resuelven contra el indice ya completo.
  const relOut: { origen: string; destino: string; tipo: string; resultado: string; motivo?: string }[] = []
  const relStmts: D1PreparedStatement[] = []
  const resolver = (ref: string) => ix.porId.get(ref) || ix.porNombre.get(normalizarNombre(ref))
  const aniadirRel = (o: string, d: string, tipo: string, desc: string | null, conf: string, blocking: boolean) => {
    const no = resolver(o), nd = resolver(d)
    if (!no || !nd) { relOut.push({ origen: o, destino: d, tipo, resultado: 'sin_resolver', motivo: !no ? `origen "${o}" no existe` : `destino "${d}" no existe` }); return }
    const key = `${no.id}|${nd.id}|${tipo}`
    if (ix.relSet.has(key)) { relOut.push({ origen: no.nombre, destino: nd.nombre, tipo, resultado: 'ya_existe' }); return }
    ix.relSet.add(key)
    relOut.push({ origen: no.nombre, destino: nd.nombre, tipo, resultado: 'creada' })
    if (aplicar) {
      relStmts.push(
        db.prepare('INSERT INTO relaciones (id, origen, destino, tipo, descripcion, confianza, is_blocking, creado, autor, lote) VALUES (?,?,?,?,?,?,?,?,?,?)')
          .bind(id('r'), no.id, nd.id, tipo, desc, conf, blocking ? 1 : 0, creado, b.autor || null, lote)
      )
    }
  }
  for (const r of b.relaciones || []) aniadirRel(r.origen, r.destino, r.tipo, r.descripcion || null, r.confianza, r.is_blocking)
  if (b.sugerencias) {
    for (const n of nuevos) {
      const pd = n.sug.padre
      if (pd && pd.confianza >= CONF_REL && (n.tipo === 'componente_codigo' || n.tipo === 'workflow')) {
        aniadirRel(n.nodoId, pd.valor.id, 'se_ejecuta_en', `inferido: ${pd.motivo}`, pd.confianza >= 0.8 ? 'alta' : 'media', true)
        n.res.inferido = [...(n.res.inferido || []), 'padre']
      }
    }
  }

  // Escritura: todo en batches de 50 sentencias (una ida y vuelta por batch)
  let errores: string | null = null
  if (aplicar) {
    const todas = [...stmts, ...relStmts]
    try {
      for (let k = 0; k < todas.length; k += 50) await db.batch(todas.slice(k, k + 50))
    } catch (e: any) {
      errores = String(e?.message || e)
    }
  }

  const cuenta = (r: Resultado['resultado']) => resultados.filter((x) => x.resultado === r).length
  return c.json(
    {
      lote_id: lote,
      modo: b.modo,
      aplicado: aplicar && !errores,
      error_escritura: errores,
      resumen: {
        items: b.items.length,
        creados: cuenta('creado'),
        existentes: cuenta('existente'),
        actualizados,
        pendientes: cuenta('pendiente'),
        incompletos: cuenta('incompleto'),
        relaciones_creadas: relOut.filter((r) => r.resultado === 'creada').length,
        relaciones_omitidas: relOut.filter((r) => r.resultado !== 'creada').length,
        ms: Date.now() - t0,
      },
      items: resultados,
      relaciones: relOut,
    },
    errores ? 500 : 200
  )
})

// DELETE /nodos/lote/:lote?confirmar=true — deshace un lote (nodos y relaciones creados en el).
app.delete('/lote/:lote', async (c) => {
  const db = c.env.DB
  const lote = c.req.param('lote')
  const n = await db.prepare('SELECT COUNT(*) AS n FROM nodos WHERE lote = ?').bind(lote).first<{ n: number }>()
  const r = await db.prepare('SELECT COUNT(*) AS n FROM relaciones WHERE lote = ?').bind(lote).first<{ n: number }>()
  if (c.req.query('confirmar') !== 'true') {
    return c.json({ lote, nodos: n?.n || 0, relaciones: r?.n || 0, mensaje: 'Simulacion. Repite con ?confirmar=true para borrar. Las relaciones de otros lotes que apunten a estos nodos tambien se borran (ON DELETE CASCADE).' })
  }
  await db.batch([db.prepare('DELETE FROM relaciones WHERE lote = ?').bind(lote), db.prepare('DELETE FROM nodos WHERE lote = ?').bind(lote)])
  return c.json({ lote, borrados: { nodos: n?.n || 0, relaciones: r?.n || 0 } })
})

export default app
