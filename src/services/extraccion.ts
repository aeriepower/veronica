// Extractor de grafo a partir de texto de memoria. Funciones PURAS (sin D1):
//   analizarTexto(ix, texto, titulo?) -> menciones de nodos existentes + relaciones
//   explicitas ("X se ejecuta en Y", "X depende de Y"...).
// Reglas primero (deterministas, baratas); la IA (extraerIA) solo propone
// entidades NUEVAS y siempre queda como propuesta, nunca se aplica sola.
import type { Env } from '../types'
import { normalizarNombre, normalizarIdentificador, type Indice, type NodoIndice } from './clasificador'
import { NODO_TIPOS } from '../types/nodos'
import { RELACION_TIPOS } from '../types/relaciones'

export type RelTipo = (typeof RELACION_TIPOS)[number]
export type Mencion = { nodoId: string; nombre: string; fuerza: number; ocurrencias: number; enTitulo: boolean }
export type RelExtraida = { origen: string; destino: string; tipo: RelTipo; evidencia: string; confianza: number }
export type Analisis = { menciones: Mencion[]; relaciones: RelExtraida[] }

const MIN_CLAVE = 4

// Claves de busqueda de un nodo: nombre, alias y nombre sin parentesis.
function clavesNodo(n: NodoIndice): string[] {
  const out = new Set<string>()
  for (const x of n.nombres) if (x.s.length >= MIN_CLAVE) out.add(x.s)
  const sinParen = n.nombre.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  if (sinParen && sinParen !== n.nombre) {
    const s = normalizarNombre(sinParen)
    if (s.length >= MIN_CLAVE) out.add(s)
  }
  return [...out]
}

export type IndiceClaves = Map<string, NodoIndice[]>

export function construirClaves(ix: Indice): IndiceClaves {
  const m: IndiceClaves = new Map()
  for (const n of ix.nodos) {
    if (n.estado === 'deprecado') continue
    for (const k of clavesNodo(n)) {
      const l = m.get(k) || []
      if (!l.includes(n)) l.push(n)
      m.set(k, l)
    }
  }
  return m
}

type Hit = { start: number; end: number; nodo: NodoIndice; sent: number }

function buscarEnFrase(claves: IndiceClaves, ns: string, sent: number): Hit[] {
  const pad = ` ${ns} `
  const hits: Hit[] = []
  for (const [k, nodos] of claves) {
    if (nodos.length !== 1) continue // clave ambigua entre varios nodos: no se adivina
    const needle = ` ${k} `
    let from = 0
    for (;;) {
      const i = pad.indexOf(needle, from)
      if (i < 0) break
      hits.push({ start: i + 1, end: i + 1 + k.length, nodo: nodos[0], sent })
      from = i + 1
    }
  }
  // Solape: gana el mas largo ("Herramientas Jarvis: terminal" gana a "Jarvis").
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)
  const aceptados: Hit[] = []
  for (const h of hits) if (!aceptados.some((a) => h.start < a.end && a.start < h.end)) aceptados.push(h)
  return aceptados.sort((a, b) => a.start - b.start)
}

export function dividirFrases(texto: string): string[] {
  return texto.split(/(?<=[.!?;])\s+|\n+/).map((s) => s.trim()).filter(Boolean)
}

type Verbo = { re: RegExp; tipo: RelTipo; inv?: boolean }
const VERBOS: Verbo[] = [
  { re: /\b(se ejecuta en|corre en|corre sobre|vive en|esta desplegad[oa] en|desplegad[oa] en|alojad[oa] en|hospedad[oa] en|funciona en|se despliega en)\b/, tipo: 'se_ejecuta_en' },
  { re: /\b(depende de|requiere|necesita|se apoya en)\b/, tipo: 'depende_de' },
  { re: /\b(es requerid[oa] por|es necesari[oa] para)\b/, tipo: 'depende_de', inv: true },
  { re: /\b(llama a|invoca|consume|consulta|usa|utiliza|escribe en|lee de|envia a|habla con)\b/, tipo: 'llama_a' },
  { re: /\b(es usad[oa] por|es llamad[oa] por|es consumid[oa] por|lo usa|lo consume)\b/, tipo: 'llama_a', inv: true },
  { re: /\b(contiene|incluye|se compone de|engloba)\b/, tipo: 'contiene' },
  { re: /\b(forma parte de|esta dentro de|pertenece a)\b/, tipo: 'contiene', inv: true },
  { re: /\b(es una instancia de|instancia de)\b/, tipo: 'instancia_de' },
  { re: /\b(comparte (el |la )?(secreto|token|credencial|clave)( con)?)\b/, tipo: 'secret_share' },
  { re: /\b(conectad[oa] (a|con)|integrad[oa] con|sincroniza con|se conecta (a|con))\b/, tipo: 'conectado_a' },
]
const CONJ = /^(y tambien|y ademas|ademas|tambien|y|e)\b\s*/
const NEGACION = /\b(no|nunca|ya no|dejo de|dejó de|sin)\b/
const MAX_PALABRAS_HUECO = 5

export function analizarTexto(ix: Indice, texto: string, titulo?: string, claves: IndiceClaves = construirClaves(ix)): Analisis {
  const porNodo = new Map<string, Mencion>()
  const relaciones: RelExtraida[] = []
  const vistoRel = new Set<string>()

  const frases = dividirFrases(texto)
  frases.forEach((raw, sent) => {
    const ns = normalizarNombre(raw)
    if (!ns) return
    const hits = buscarEnFrase(claves, ns, sent)
    for (const h of hits) {
      const m = porNodo.get(h.nodo.id) || { nodoId: h.nodo.id, nombre: h.nodo.nombre, fuerza: 0.5, ocurrencias: 0, enTitulo: false }
      m.ocurrencias++
      m.fuerza = Math.min(0.95, 0.55 + 0.15 * (m.ocurrencias - 1))
      porNodo.set(h.nodo.id, m)
    }
    // Relaciones entre menciones consecutivas de la misma frase. Coordinacion:
    // "X se ejecuta en Y y depende de Z" -> el sujeto de la 2a relacion sigue siendo X.
    const pad = ` ${ns} `
    let sujeto: Hit | null = null
    for (let i = 0; i + 1 < hits.length; i++) {
      const b = hits[i + 1]
      const hueco = pad.slice(hits[i].end, b.start).trim()
      const coord = CONJ.test(hueco)
      const a: Hit = coord && sujeto ? sujeto : hits[i]
      const huecoVerbo = coord ? hueco.replace(CONJ, '').trim() : hueco
      let hecho: Hit | null = null
      if (a.nodo.id !== b.nodo.id && huecoVerbo && huecoVerbo.split(' ').length <= MAX_PALABRAS_HUECO && !NEGACION.test(huecoVerbo)) {
        for (const v of VERBOS) {
          if (!v.re.test(huecoVerbo)) continue
          const [o, d] = v.inv ? [b.nodo, a.nodo] : [a.nodo, b.nodo]
          const key = `${o.id}|${d.id}|${v.tipo}`
          if (!vistoRel.has(key)) {
            vistoRel.add(key)
            relaciones.push({ origen: o.id, destino: d.id, tipo: v.tipo, evidencia: raw.slice(0, 200), confianza: 0.8 })
          }
          hecho = v.inv ? null : a
          break
        }
      }
      sujeto = hecho
    }
  })

  // Identificadores externos (URL de repo, nombre de Worker...) en el texto crudo.
  const bajo = texto.toLowerCase()
  for (const n of ix.nodos) {
    if (n.estado === 'deprecado' || !n.identificador || n.identificador.length < 8) continue
    if (bajo.includes(n.identificador) || bajo.includes(normalizarIdentificador(n.identificador))) {
      const m = porNodo.get(n.id) || { nodoId: n.id, nombre: n.nombre, fuerza: 0.5, ocurrencias: 0, enTitulo: false }
      m.ocurrencias++
      m.fuerza = Math.max(m.fuerza, 0.95)
      porNodo.set(n.id, m)
    }
  }

  // El titulo del item ("de que va" la memoria) sube la fuerza.
  if (titulo) {
    const ns = normalizarNombre(titulo)
    for (const h of buscarEnFrase(claves, ns, 0)) {
      const m = porNodo.get(h.nodo.id) || { nodoId: h.nodo.id, nombre: h.nodo.nombre, fuerza: 0.5, ocurrencias: 0, enTitulo: false }
      m.enTitulo = true
      m.fuerza = Math.max(m.fuerza, 0.9)
      porNodo.set(h.nodo.id, m)
    }
  }

  return { menciones: [...porNodo.values()].sort((a, b) => b.fuerza - a.fuerza), relaciones }
}

// ---------------------------------------------------------------------------
// IA (Workers AI): SOLO entidades nuevas y relaciones candidatas -> propuestas.
// ---------------------------------------------------------------------------
export type EntidadIA = { nombre: string; tipo: string; evidencia: string }
export type RelacionIA = { origen: string; destino: string; tipo: RelTipo }

export async function extraerIA(env: Env, texto: string, conocidos: string[]): Promise<{ entidades: EntidadIA[]; relaciones: RelacionIA[] } | null> {
  if (!env.AI) return null
  const prompt =
    `Eres un catalogador de infraestructura. Del texto extrae SOLO sistemas, servicios, repositorios, workflows, bases de datos, hardware o componentes de codigo concretos y duraderos ` +
    `(nunca personas, fechas, ideas ni acciones). Tipos validos: ${NODO_TIPOS.join(', ')}. Relaciones validas: ${RELACION_TIPOS.join(', ')}. ` +
    `Ya existen estos nodos (no los repitas): ${conocidos.slice(0, 60).join('; ')}. ` +
    `Responde SOLO JSON: {"entidades":[{"nombre":"","tipo":"","evidencia":"frase corta del texto"}],"relaciones":[{"origen":"","destino":"","tipo":""}]}. ` +
    `Maximo 4 entidades y 4 relaciones; si no hay nada claro devuelve listas vacias. Texto: """${texto.slice(0, 1500)}"""`
  try {
    const r: any = await Promise.race([
      env.AI.run('@cf/meta/llama-3.1-8b-instruct' as any, { messages: [{ role: 'user', content: prompt }], max_tokens: 400 } as any),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000)),
    ])
    return parsearIA(typeof r?.response === 'string' ? r.response : '')
  } catch {
    return null
  }
}

export function parsearIA(txt: string): { entidades: EntidadIA[]; relaciones: RelacionIA[] } | null {
  const m = txt.match(/\{[\s\S]*\}/)
  if (!m) return null
  let j: any
  try { j = JSON.parse(m[0]) } catch { return null }
  const tiposN = NODO_TIPOS as readonly string[]
  const tiposR = RELACION_TIPOS as readonly string[]
  const entidades: EntidadIA[] = (Array.isArray(j.entidades) ? j.entidades : [])
    .filter((e: any) => e && typeof e.nombre === 'string' && e.nombre.trim().length >= 3 && e.nombre.length <= 80 && tiposN.includes(e.tipo))
    .slice(0, 4)
    .map((e: any) => ({ nombre: e.nombre.trim(), tipo: e.tipo, evidencia: String(e.evidencia || '').slice(0, 200) }))
  const relaciones: RelacionIA[] = (Array.isArray(j.relaciones) ? j.relaciones : [])
    .filter((r: any) => r && typeof r.origen === 'string' && typeof r.destino === 'string' && tiposR.includes(r.tipo) && r.origen !== r.destino)
    .slice(0, 4)
    .map((r: any) => ({ origen: r.origen.trim(), destino: r.destino.trim(), tipo: r.tipo }))
  return { entidades, relaciones }
}
