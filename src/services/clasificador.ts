// Clasificador de nodos (entity resolution ligera) antes de escribir en `nodos`.
// v2 (29-sep-2026): compara nombre + alias + identificador + tipo + descripcion,
// trabaja sobre un INDICE EN MEMORIA (1 lectura a D1 por peticion, no una por
// item) para que las cargas por lotes sean baratas. Sin dependencias externas.
import type { Env } from '../types'

export type CandidatoNodo = { id: string; nombre: string; tipo: string; score: number; motivo: string }
export type ResultadoClasificacion = { decision: 'existe_exacto' | 'posible_duplicado' | 'nuevo'; candidatos: CandidatoNodo[] }

export type EntradaClasificar = {
  nombre: string
  tipo?: string
  descripcion?: string
  alias?: string[]
  identificador?: string
}

// Quita acentos, minusculas, separadores a espacio. "JARVIS-Core" == "Jarvis Core ".
export function normalizarNombre(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()
}

export function normalizarIdentificador(s: string): string {
  return s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\.git$/, '').replace(/\/+$/, '')
}

type Perfil = { n: number; m: Map<string, number> }

function perfil(s: string): Perfil {
  const m = new Map<string, number>()
  let n = 0
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2)
    m.set(g, (m.get(g) || 0) + 1)
    n++
  }
  return { n, m }
}

// Dice sobre bigramas con cota superior barata (descarta pares muy distintos en longitud).
function dice(a: Perfil, b: Perfil, sa: string, sb: string): number {
  if (sa === sb) return 1
  if (a.n === 0 || b.n === 0) return 0
  if ((2 * Math.min(a.n, b.n)) / (a.n + b.n) < 0.7) return 0
  const [chico, grande] = a.m.size <= b.m.size ? [a, b] : [b, a]
  let inter = 0
  for (const [g, c] of chico.m) inter += Math.min(c, grande.m.get(g) || 0)
  return (2 * inter) / (a.n + b.n)
}

// API historica (usada por tests): similitud entre dos cadenas ya normalizadas.
export function similitud(a: string, b: string): number {
  return dice(perfil(a), perfil(b), a, b)
}

const STOP = new Set(['para', 'como', 'esta', 'este', 'entre', 'sobre', 'desde', 'donde', 'todo', 'todos', 'cada', 'tiene', 'usado', 'usada', 'sirve', 'nodo', 'app'])
export function tokensDescripcion(s: string | null | undefined): Set<string> {
  const out = new Set<string>()
  if (!s) return out
  for (const t of normalizarNombre(s).split(' ')) if (t.length > 3 && !STOP.has(t)) out.add(t)
  return out
}

export type NodoIndice = {
  id: string
  nombre: string
  tipo: string
  tier: string
  norm: string
  nombres: { s: string; p: Perfil; esAlias: boolean }[]
  alias: string[]
  identificador: string | null
  desc: string | null
  descTokens: Set<string>
  estado: string
  data: string | null
  padres: string[] // ids de nodos que lo contienen / donde se ejecuta
}

export type Indice = {
  nodos: NodoIndice[]
  porId: Map<string, NodoIndice>
  porNombre: Map<string, NodoIndice> // nombre normalizado y alias -> nodo
  relSet: Set<string> // origen|destino|tipo
}

export function nuevoNodoIndice(f: {
  id: string; nombre: string; tipo: string; tier?: string; descripcion?: string | null; alias?: string[]
  identificador?: string | null; estado?: string; data?: string | null
}): NodoIndice {
  const alias = f.alias || []
  const norm = normalizarNombre(f.nombre)
  return {
    id: f.id, nombre: f.nombre, tipo: f.tipo, tier: f.tier || 'standard', norm,
    nombres: [{ s: norm, p: perfil(norm), esAlias: false }, ...alias.map((a) => { const s = normalizarNombre(a); return { s, p: perfil(s), esAlias: true } })],
    alias,
    identificador: f.identificador ? normalizarIdentificador(f.identificador) : null,
    desc: f.descripcion || null,
    descTokens: tokensDescripcion(f.descripcion),
    estado: f.estado || 'activo',
    data: f.data || null,
    padres: [],
  }
}

export function anadirAlIndice(ix: Indice, n: NodoIndice) {
  ix.nodos.push(n)
  ix.porId.set(n.id, n)
  for (const x of n.nombres) if (x.s && !ix.porNombre.has(x.s)) ix.porNombre.set(x.s, n)
}

function parseAlias(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return []
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [] } catch { return [] }
}

// 2 consultas a D1 (nodos + relaciones) por peticion, sea cual sea el tamano del lote.
export async function cargarIndice(db: Env['DB']): Promise<Indice> {
  const [n, r] = await db.batch([
    db.prepare('SELECT id, nombre, tipo, tier, descripcion, alias, identificador, estado, data FROM nodos'),
    db.prepare('SELECT origen, destino, tipo FROM relaciones'),
  ])
  const ix: Indice = { nodos: [], porId: new Map(), porNombre: new Map(), relSet: new Set() }
  for (const f of n.results as any[]) {
    anadirAlIndice(ix, nuevoNodoIndice({ ...f, descripcion: f.descripcion, alias: parseAlias(f.alias) }))
  }
  for (const rel of r.results as any[]) {
    ix.relSet.add(`${rel.origen}|${rel.destino}|${rel.tipo}`)
    // jerarquia: hijo se_ejecuta_en padre / padre contiene hijo
    if (rel.tipo === 'se_ejecuta_en') ix.porId.get(rel.origen)?.padres.push(rel.destino)
    else if (rel.tipo === 'contiene') ix.porId.get(rel.destino)?.padres.push(rel.origen)
  }
  return ix
}

// Umbrales (calibrados a mano):
//  >= 0.95 mismo nodo | >= 0.70 posible duplicado | < 0.70 nuevo
const UMBRAL_EXACTO = 0.95
const UMBRAL_DUPLICADO = 0.7
const PENALIZA_TIPO = 0.9
const numeros = (s: string) => (s.match(/\d+/g) || []).join(',')
const JACCARD_DESC = 0.6

export function clasificarContraIndice(ix: Indice, e: EntradaClasificar): ResultadoClasificacion {
  const nombres = [e.nombre, ...(e.alias || [])].map((x) => { const s = normalizarNombre(x); return { s, p: perfil(s) } })
  const ident = e.identificador ? normalizarIdentificador(e.identificador) : null
  const dTokens = tokensDescripcion(e.descripcion)
  const candidatos: CandidatoNodo[] = []

  for (const n of ix.nodos) {
    let score = 0
    let motivo = ''
    if (ident && n.identificador === ident) {
      score = 1; motivo = 'identificador igual'
    } else {
      if (n.estado === 'deprecado') continue
      for (const a of nombres) for (const b of n.nombres) {
        let d = dice(a.p, b.p, a.s, b.s)
        // "worker 1" y "worker 2" no son el mismo nodo: si los numeros difieren, nunca es exacto.
        if (d >= UMBRAL_EXACTO && d < 1 && numeros(a.s) !== numeros(b.s)) d = 0.9
        if (d > score) { score = d; motivo = b.esAlias ? `alias parecido a "${b.s}"` : 'nombre parecido' }
      }
      if (e.tipo && n.tipo !== e.tipo && score > 0) { score *= PENALIZA_TIPO; motivo += ` (tipo distinto: ${n.tipo})` }
      if (dTokens.size >= 3 && n.descTokens.size >= 3) {
        let inter = 0
        for (const t of dTokens) if (n.descTokens.has(t)) inter++
        const j = inter / (dTokens.size + n.descTokens.size - inter)
        if (j >= JACCARD_DESC && score < 0.72) { score = 0.72; motivo = `descripcion parecida (${j.toFixed(2)})` }
      }
    }
    if (score >= UMBRAL_DUPLICADO) candidatos.push({ id: n.id, nombre: n.nombre, tipo: n.tipo, score: Math.round(score * 100) / 100, motivo })
  }
  candidatos.sort((a, b) => b.score - a.score)
  const top = candidatos.slice(0, 5)
  const mejor = top[0]
  const decision: ResultadoClasificacion['decision'] =
    mejor && mejor.score >= UMBRAL_EXACTO ? 'existe_exacto' : top.length > 0 ? 'posible_duplicado' : 'nuevo'
  return { decision, candidatos: top }
}

// Compatibilidad con la firma anterior.
export async function clasificarNodo(db: Env['DB'], nombre: string, tipo?: string): Promise<ResultadoClasificacion> {
  return clasificarContraIndice(await cargarIndice(db), { nombre, tipo })
}
