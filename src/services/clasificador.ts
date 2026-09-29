// Clasificador de nodos: entity resolution ligera antes de escribir en la
// tabla canonica `nodos`. Implementa a escala minima la idea de
// "propuesta_MCP_gestione_la_BBDD.md" (el MCP clasifica lo que entra en
// vez de ser un CRUD ciego) y corrige el incidente real del 28-sep-2026
// (AGENTS.md seccion 13: 2 nodos duplicados por no comparar antes de
// crear). Sin dependencias externas: D1/Workers no trae libs de fuzzy
// matching, así que se usa Dice's Coefficient sobre bigramas de
// caracteres, barato y sin necesidad de embeddings para el volumen actual
// (decenas de nodos, no miles).
import type { Env } from '../types'

export type CandidatoNodo = {
  id: string
  nombre: string
  tipo: string
  score: number
}

export type ResultadoClasificacion = {
  decision: 'existe_exacto' | 'posible_duplicado' | 'nuevo'
  candidatos: CandidatoNodo[]
}

// Quita acentos, pasa a minusculas, colapsa separadores (espacios/guiones/
// guion bajo) a un unico espacio y recorta bordes. "JARVIS-Core" y
// "Jarvis Core " normalizan al mismo valor.
export function normalizarNombre(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigramas(s: string): string[] {
  const out: string[] = []
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
  return out
}

// Dice's Coefficient: 2 * |interseccion de bigramas| / (|A| + |B|). 1.0 =
// identico, 0.0 = sin caracteres en comun de dos en dos. Estandar y barato
// para nombres cortos; no sustituye un embedding pero no hace falta uno
// para comparar nombres de nodos de infraestructura.
export function similitud(a: string, b: string): number {
  if (a === b) return 1
  const ba = bigramas(a)
  const bb = bigramas(b)
  if (ba.length === 0 || bb.length === 0) return a === b ? 1 : 0
  const contador = new Map<string, number>()
  for (const g of ba) contador.set(g, (contador.get(g) || 0) + 1)
  let interseccion = 0
  for (const g of bb) {
    const n = contador.get(g) || 0
    if (n > 0) {
      interseccion++
      contador.set(g, n - 1)
    }
  }
  return (2 * interseccion) / (ba.length + bb.length)
}

// Umbrales (calibrados a mano, revisar si dan demasiados falsos positivos/
// negativos con el uso real):
//   >= 0.95 -> se considera el mismo nodo (existe_exacto)
//   >= 0.70 -> posible duplicado, requiere revision o `forzar`
//   <  0.70 -> nuevo
const UMBRAL_EXACTO = 0.95
const UMBRAL_DUPLICADO = 0.7

export async function clasificarNodo(db: Env['DB'], nombre: string, tipo?: string): Promise<ResultadoClasificacion> {
  const objetivo = normalizarNombre(nombre)
  const q = tipo
    ? await db.prepare('SELECT id, nombre, tipo FROM nodos WHERE tipo = ?').bind(tipo).all<{ id: string; nombre: string; tipo: string }>()
    : await db.prepare('SELECT id, nombre, tipo FROM nodos').all<{ id: string; nombre: string; tipo: string }>()

  const candidatos: CandidatoNodo[] = q.results
    .map((n) => ({ id: n.id, nombre: n.nombre, tipo: n.tipo, score: similitud(objetivo, normalizarNombre(n.nombre)) }))
    .filter((c) => c.score >= UMBRAL_DUPLICADO)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)

  const mejor = candidatos[0]
  const decision: ResultadoClasificacion['decision'] =
    mejor && mejor.score >= UMBRAL_EXACTO ? 'existe_exacto' : candidatos.length > 0 ? 'posible_duplicado' : 'nuevo'

  return { decision, candidatos }
}
