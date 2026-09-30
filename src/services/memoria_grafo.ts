// Capa D1 del puente memoria <-> grafo: enlaces nodo_memoria, propuestas del
// extractor, procesado automatico de cada observacion nueva y recuerdos por
// nodo. La logica de reglas vive en extraccion.ts (pura); aqui solo se lee y
// se escribe. Todo el procesado es best-effort: NUNCA debe hacer fallar el
// guardado de una memoria.
import type { Env } from '../types'
import { cargarIndice, clasificarContraIndice, normalizarNombre, nuevoNodoIndice, type Indice } from './clasificador'
import { analizarTexto, extraerIA, construirClaves, type Analisis } from './extraccion'
import { construirGrafo, type Grafo } from './planificador'

export const LOTE_AUTO = 'memoria-auto'

export function nuevoId(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
const ahora = () => new Date().toISOString()

export async function cargarGrafo(db: Env['DB']): Promise<Grafo> {
  const [n, r] = await db.batch([
    db.prepare('SELECT id, nombre, tipo, tier, estado FROM nodos'),
    db.prepare('SELECT origen, destino, tipo, is_blocking FROM relaciones'),
  ])
  return construirGrafo(n.results as any[], r.results as any[])
}

export type ObsFila = {
  id: string
  item_id: string
  item_nombre: string
  capa: string
  texto: string
  origen: string
  confianza: string
  estado: string
}

const SEL_OBS =
  'SELECT mo.id, mo.item_id, mi.nombre AS item_nombre, mo.capa, mo.texto, mo.origen, mo.confianza, mo.estado FROM memory_observations mo JOIN memory_items mi ON mi.id = mo.item_id'

export function esObsIgnorable(o: Pick<ObsFila, 'item_nombre'>): boolean {
  return o.item_nombre.startsWith('curacion-nocturna')
}

export type ResultadoProceso = {
  observacion_id: string
  enlaces: number
  relaciones_aplicadas: number
  propuestas: number
  nodos_creados?: number
}

export type OpcionesProceso = { aplicar?: boolean; ia?: boolean; lote?: string }

// Puede una relacion extraida por reglas aplicarse sin revision?
// Nodo nuevo detectado por IA: se inserta solo si la memoria es de David o de confianza alta
// y el nombre es concreto (>=4 chars, max 80); si no, queda como propuesta.
export function nodoAutoaplicable(o: Pick<ObsFila, 'origen' | 'confianza'>, nombre: string): boolean {
  const n = nombre.trim()
  return n.length >= 4 && n.length <= 80 && (o.origen === 'david' || o.confianza === 'alta')
}

export function relacionAutoaplicable(o: Pick<ObsFila, 'origen' | 'confianza'>, confRel: number): boolean {
  return confRel >= 0.75 && (o.origen === 'david' || o.confianza === 'alta')
}

// Procesa UNA observacion: enlaces nodo_memoria + relaciones (auto o propuesta) + IA opcional.
export async function procesarObservacion(env: Env, o: ObsFila, ix: Indice, op: OpcionesProceso = {}): Promise<ResultadoProceso> {
  const db = env.DB
  const aplicar = op.aplicar !== false
  const res: ResultadoProceso = { observacion_id: o.id, enlaces: 0, relaciones_aplicadas: 0, propuestas: 0 }
  if (o.estado !== 'activo' || esObsIgnorable(o)) return res

  const an: Analisis = analizarTexto(ix, o.texto, o.item_nombre)
  const stmts: D1PreparedStatement[] = []
  const t = ahora()

  for (const m of an.menciones) {
    res.enlaces++
    if (aplicar) {
      stmts.push(
        db
          .prepare("INSERT OR IGNORE INTO nodo_memoria (id, nodo_id, observacion_id, tipo, fuerza, origen, creado) VALUES (?,?,?,?,?,'regla',?)")
          .bind(nuevoId('nm'), m.nodoId, o.id, m.enTitulo ? 'sobre' : 'menciona', Math.round(m.fuerza * 100) / 100, t)
      )
    }
  }

  for (const r of an.relaciones) {
    if (ix.relSet.has(`${r.origen}|${r.destino}|${r.tipo}`)) continue
    if (relacionAutoaplicable(o, r.confianza)) {
      res.relaciones_aplicadas++
      ix.relSet.add(`${r.origen}|${r.destino}|${r.tipo}`)
      if (aplicar) {
        stmts.push(
          db
            .prepare('INSERT INTO relaciones (id, origen, destino, tipo, descripcion, confianza, is_blocking, creado, autor, lote) VALUES (?,?,?,?,?,?,?,?,?,?)')
            .bind(nuevoId('r'), r.origen, r.destino, r.tipo, `memoria ${o.id}: ${r.evidencia}`.slice(0, 300), 'media', 1, t, 'extractor', op.lote || LOTE_AUTO)
        )
      }
    } else {
      res.propuestas++
      if (aplicar) stmts.push(stmtPropuesta(db, 'relacion', `rel:${r.origen}|${r.destino}|${r.tipo}`, { origen: r.origen, destino: r.destino, tipo: r.tipo }, o.id, r.evidencia, r.confianza, 'regla', t))
    }
  }

  if (op.ia && env.AI && o.texto.length >= 40 && o.origen !== 'herramienta') {
    const g = await extraerIA(env, o.texto, ix.nodos.map((n) => n.nombre))
    if (g) {
      for (const e of g.entidades) {
        const cl = clasificarContraIndice(ix, { nombre: e.nombre, tipo: e.tipo })
        if (cl.decision === 'existe_exacto') {
          res.enlaces++
          if (aplicar) stmts.push(db.prepare("INSERT OR IGNORE INTO nodo_memoria (id, nodo_id, observacion_id, tipo, fuerza, origen, creado) VALUES (?,?,?,'menciona',0.6,'ia',?)").bind(nuevoId('nm'), cl.candidatos[0].id, o.id, t))
        } else if (cl.decision === 'nuevo') {
          if (nodoAutoaplicable(o, e.nombre)) {
            // Memoria de David / confianza alta: el nodo nuevo se crea solo (lote memoria-auto, reversible).
            res.nodos_creados = (res.nodos_creados || 0) + 1
            const nid = nuevoId('n')
            ix.nodos.push(nuevoNodoIndice({ id: nid, nombre: e.nombre, tipo: e.tipo }))
            const nn = ix.nodos[ix.nodos.length - 1]
            ix.porId.set(nid, nn); ix.porNombre.set(normalizarNombre(e.nombre), nn)
            if (aplicar) {
              stmts.push(db.prepare("INSERT OR IGNORE INTO nodos (id, nombre, tipo, descripcion, tier, creado, autor, origen, estado, lote) VALUES (?,?,?,?, 'standard', ?, 'extractor', ?, 'activo', ?)").bind(nid, e.nombre, e.tipo, e.evidencia || null, t, `memoria ${o.id}`, op.lote || LOTE_AUTO))
              stmts.push(db.prepare("INSERT OR IGNORE INTO nodo_memoria (id, nodo_id, observacion_id, tipo, fuerza, origen, creado) VALUES (?,?,?,'sobre',0.8,'ia',?)").bind(nuevoId('nm'), nid, o.id, t))
            }
          } else {
            res.propuestas++
            if (aplicar) stmts.push(stmtPropuesta(db, 'nodo', `nodo:${normalizarNombre(e.nombre)}`, { nombre: e.nombre, tipo: e.tipo }, o.id, e.evidencia, 0.5, 'ia', t))
          }
        }
      }
      for (const r of g.relaciones) {
        const no = ix.porNombre.get(normalizarNombre(r.origen)), nd = ix.porNombre.get(normalizarNombre(r.destino))
        if (!no || !nd || no.id === nd.id || ix.relSet.has(`${no.id}|${nd.id}|${r.tipo}`)) continue
        res.propuestas++
        if (aplicar) stmts.push(stmtPropuesta(db, 'relacion', `rel:${no.id}|${nd.id}|${r.tipo}`, { origen: no.id, destino: nd.id, tipo: r.tipo }, o.id, 'sugerida por IA', 0.5, 'ia', t))
      }
    }
  }

  if (aplicar && stmts.length) for (let k = 0; k < stmts.length; k += 50) await db.batch(stmts.slice(k, k + 50))
  return res
}

function stmtPropuesta(db: Env['DB'], clase: 'nodo' | 'relacion', clave: string, payload: unknown, obsId: string, evidencia: string, conf: number, fuente: string, t: string) {
  return db
    .prepare("INSERT OR IGNORE INTO propuestas_grafo (id, clase, clave, payload, observacion_id, evidencia, confianza, fuente, estado, creado) VALUES (?,?,?,?,?,?,?,?, 'pendiente', ?)")
    .bind(nuevoId('pg'), clase, clave, JSON.stringify(payload), obsId, evidencia.slice(0, 300), conf, fuente, t)
}

// Disparador post-guardado: nunca lanza y nunca bloquea el guardado.
export async function procesarObservacionPorId(env: Env, obsId: string, ia = true): Promise<void> {
  try {
    const o = await env.DB.prepare(`${SEL_OBS} WHERE mo.id = ?`).bind(obsId).first<ObsFila>()
    if (!o) return
    const ix = await cargarIndice(env.DB)
    await procesarObservacion(env, o, ix, { ia })
  } catch (e) {
    console.error('extractor memoria->grafo fallo (ignorado):', (e as Error)?.message)
  }
}

// Enlaces explicitos: la memoria nace ya enlazada (campo "nodos").
export async function enlazarExplicito(env: Env, obsId: string, refs: string[], t = ahora()): Promise<{ enlazados: string[]; sin_resolver: string[] }> {
  const ix = await cargarIndice(env.DB)
  const enlazados: string[] = []
  const sin: string[] = []
  const stmts: D1PreparedStatement[] = []
  for (const ref of refs) {
    const n = ix.porId.get(ref) || ix.porNombre.get(normalizarNombre(ref))
    if (!n) { sin.push(ref); continue }
    enlazados.push(n.nombre)
    stmts.push(env.DB.prepare("INSERT INTO nodo_memoria (id, nodo_id, observacion_id, tipo, fuerza, origen, creado) VALUES (?,?,?,'sobre',1,'manual',?) ON CONFLICT(nodo_id, observacion_id) DO UPDATE SET tipo='sobre', fuerza=1, origen='manual'").bind(nuevoId('nm'), n.id, obsId, t))
  }
  if (stmts.length) await env.DB.batch(stmts)
  return { enlazados, sin_resolver: sin }
}

// Reprocesa observaciones existentes (pasada retrospectiva). Paginado por desde/limite.
export async function reprocesar(env: Env, op: { aplicar: boolean; ia: boolean; desde: number; limite: number; incluir_archivadas?: boolean }) {
  const ix = await cargarIndice(env.DB)
  const where = op.incluir_archivadas ? '' : "WHERE mo.estado = 'activo'"
  const total = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM memory_observations mo ${where}`).first<{ n: number }>())?.n || 0
  const filas = (await env.DB.prepare(`${SEL_OBS} ${where} ORDER BY mo.fecha, mo.id LIMIT ? OFFSET ?`).bind(op.limite, op.desde).all<ObsFila>()).results || []
  const tot = { observaciones: filas.length, enlaces: 0, relaciones_aplicadas: 0, propuestas: 0 }
  const detalle: { obs: string; enlaces: number; relaciones: number; propuestas: number }[] = []
  for (const o of filas) {
    const r = await procesarObservacion(env, o, ix, { aplicar: op.aplicar, ia: op.ia })
    tot.enlaces += r.enlaces; tot.relaciones_aplicadas += r.relaciones_aplicadas; tot.propuestas += r.propuestas
    if (r.enlaces || r.relaciones_aplicadas || r.propuestas) detalle.push({ obs: o.id, enlaces: r.enlaces, relaciones: r.relaciones_aplicadas, propuestas: r.propuestas })
  }
  const siguiente = op.desde + filas.length < total ? op.desde + filas.length : null
  return { modo: op.aplicar ? 'aplicar' : 'simular', total, desde: op.desde, siguiente, ...tot, detalle: detalle.slice(0, 40) }
}

// ---------------------------------------------------------------------------
// Recuerdos de un conjunto de nodos, ordenados por utilidad para el plan.
// ---------------------------------------------------------------------------
const PESO_CAPA: Record<string, number> = { episodica: 1, procedimental: 1, semantica: 0.9 }
const PESO_CONF: Record<string, number> = { alta: 1, media: 0.85, baja: 0.6 }

export type Recuerdo = { observacion_id: string; nodo: string; capa: string; fecha: string; texto: string; item: string; puntuacion: number }

export async function recuerdosDeNodos(db: Env['DB'], relevancia: Map<string, number>, max = 8, maxTexto = 280): Promise<Recuerdo[]> {
  const ids = [...relevancia.keys()].slice(0, 60)
  if (!ids.length) return []
  const ph = ids.map(() => '?').join(',')
  const q = await db
    .prepare(
      `SELECT nm.nodo_id, n.nombre AS nodo, nm.fuerza, mo.id AS obs_id, mo.capa, mo.texto, mo.confianza, mo.fecha, mi.nombre AS item
       FROM nodo_memoria nm
       JOIN memory_observations mo ON mo.id = nm.observacion_id AND mo.estado = 'activo'
       JOIN memory_items mi ON mi.id = mo.item_id
       JOIN nodos n ON n.id = nm.nodo_id
       WHERE nm.nodo_id IN (${ph})`
    )
    .bind(...ids)
    .all<any>()
  const ahoraMs = Date.now()
  const porObs = new Map<string, Recuerdo>()
  for (const f of q.results || []) {
    const dias = Math.max(0, (ahoraMs - Date.parse(f.fecha)) / 86400000)
    const rec = Math.exp(-dias / 180) * 0.5 + 0.5
    const p = (relevancia.get(f.nodo_id) || 0) * f.fuerza * (PESO_CAPA[f.capa] ?? 0.9) * (PESO_CONF[f.confianza] ?? 0.8) * rec
    const prev = porObs.get(f.obs_id)
    if (!prev || prev.puntuacion < p) {
      porObs.set(f.obs_id, { observacion_id: f.obs_id, nodo: f.nodo, capa: f.capa, fecha: String(f.fecha).slice(0, 10), texto: String(f.texto).slice(0, maxTexto), item: f.item, puntuacion: Math.round(p * 1000) / 1000 })
    }
  }
  return [...porObs.values()].sort((a, b) => b.puntuacion - a.puntuacion).slice(0, max)
}

// ---------------------------------------------------------------------------
// Propuestas: aprobar aplica; rechazar solo marca.
// ---------------------------------------------------------------------------
export async function resolverPropuestas(env: Env, ids: string[], decision: 'aprobar' | 'rechazar', quien: string) {
  const db = env.DB
  if (!ids.length) return { resueltas: 0, aplicadas: [] as string[], errores: [] as string[] }
  const ph = ids.map(() => '?').join(',')
  const filas = (await db.prepare(`SELECT * FROM propuestas_grafo WHERE id IN (${ph}) AND estado = 'pendiente'`).bind(...ids).all<any>()).results || []
  const t = ahora()
  const aplicadas: string[] = []
  const errores: string[] = []
  const stmts: D1PreparedStatement[] = []
  if (decision === 'aprobar') {
    const ix = await cargarIndice(db)
    for (const f of filas) {
      const p = JSON.parse(f.payload)
      if (f.clase === 'nodo') {
        const cl = clasificarContraIndice(ix, { nombre: p.nombre, tipo: p.tipo })
        if (cl.decision !== 'nuevo') { errores.push(`${f.id}: ya existe algo parecido (${cl.candidatos[0]?.nombre})`); continue }
        const nid = nuevoId('n')
        stmts.push(db.prepare("INSERT OR IGNORE INTO nodos (id, nombre, tipo, descripcion, tier, creado, autor, origen, estado, lote) VALUES (?,?,?,?, 'standard', ?, ?, ?, 'activo', ?)").bind(nid, p.nombre, p.tipo, p.descripcion || null, t, quien, `propuesta ${f.id}`, LOTE_AUTO))
        if (f.observacion_id) stmts.push(db.prepare("INSERT OR IGNORE INTO nodo_memoria (id, nodo_id, observacion_id, tipo, fuerza, origen, creado) VALUES (?,?,?,'sobre',0.8,'ia',?)").bind(nuevoId('nm'), nid, f.observacion_id, t))
      } else {
        if (!ix.porId.has(p.origen) || !ix.porId.has(p.destino)) { errores.push(`${f.id}: nodo inexistente`); continue }
        stmts.push(db.prepare('INSERT INTO relaciones (id, origen, destino, tipo, descripcion, confianza, is_blocking, creado, autor, lote) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(nuevoId('r'), p.origen, p.destino, p.tipo, `propuesta ${f.id}: ${f.evidencia || ''}`.slice(0, 300), 'media', 1, t, quien, LOTE_AUTO))
      }
      aplicadas.push(f.id)
    }
  }
  const marcar = decision === 'aprobar' ? aplicadas : filas.map((f: any) => f.id)
  if (marcar.length) {
    const ph2 = marcar.map(() => '?').join(',')
    stmts.push(db.prepare(`UPDATE propuestas_grafo SET estado = ?, resuelto = ?, resuelto_por = ? WHERE id IN (${ph2})`).bind(decision === 'aprobar' ? 'aprobada' : 'rechazada', t, quien, ...marcar))
  }
  for (let k = 0; k < stmts.length; k += 50) await db.batch(stmts.slice(k, k + 50))
  return { resueltas: marcar.length, aplicadas, errores }
}

export { construirClaves }
