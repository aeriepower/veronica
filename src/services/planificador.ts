// Motor de planificacion de cambios (funcion PURA, sin D1).
//   planificar(grafo, semillas, opciones) -> nodos afectados, cada uno UNA vez,
//   con distancia, relevancia (0-1), motivo (camino corto) y rol
//   (tocar / desplegar / verificar / docs / riesgos).
// Recorrido tipo Dijkstra sobre producto de pesos (mejor camino por nodo, sin
// ciclos ni duplicados). Cada tipo de relacion propaga el cambio de forma
// distinta segun el SENTIDO en que se recorre; ver REGLAS.
//
// Convencion de la tabla: (origen -tipo-> destino), p. ej. "X se_ejecuta_en H"
// = origen X, destino H; "A depende_de B" = origen A, destino B.

export type NodoG = { id: string; nombre: string; tipo: string; tier: string; estado?: string }
export type AristaG = { origen: string; destino: string; tipo: string; is_blocking?: number | boolean }
export type Grafo = { nodos: Map<string, NodoG>; salientes: Map<string, AristaG[]>; entrantes: Map<string, AristaG[]> }

export type Rol = 'tocar' | 'desplegar' | 'verificar' | 'docs' | 'riesgos'
export type ItemPlan = {
  id: string
  nombre: string
  tipo: string
  tier: string
  distancia: number
  relevancia: number
  rol: Rol
  via: string
  bloqueante: boolean
}
export type Plan = {
  semillas: { id: string; nombre: string; tipo: string }[]
  items: ItemPlan[]
  omitidos_por_ruido: number
  hubs: string[]
}

export type Opciones = { profundidad?: number; umbral?: number; hub_grado?: number }

// Como se propaga un cambio segun el tipo y el sentido de recorrido.
//  fwd: se recorre de origen a destino; rev: de destino a origen.
type Regla = { peso: number; rol: Rol }
const REGLAS: Record<string, { fwd: Regla; rev: Regla }> = {
  // A contiene B: si cambia A, B se ve afectado; si cambia B, revisar A.
  contiene: { fwd: { peso: 0.8, rol: 'tocar' }, rev: { peso: 0.5, rol: 'verificar' } },
  // I instancia_de C: si cambia la clase C, hay que actualizar TODAS las instancias.
  instancia_de: { fwd: { peso: 0.3, rol: 'verificar' }, rev: { peso: 0.9, rol: 'desplegar' } },
  // A depende_de B: si cambia B, se rompe A.
  depende_de: { fwd: { peso: 0.3, rol: 'verificar' }, rev: { peso: 0.85, rol: 'verificar' } },
  // A llama_a B: si cambia el contrato de B, se rompe A.
  llama_a: { fwd: { peso: 0.3, rol: 'verificar' }, rev: { peso: 0.7, rol: 'verificar' } },
  // S se_ejecuta_en H: si cambia H, se afecta S; si cambia S, hay que desplegarlo en H.
  se_ejecuta_en: { fwd: { peso: 0.6, rol: 'desplegar' }, rev: { peso: 0.8, rol: 'verificar' } },
  // Simetricas.
  secret_share: { fwd: { peso: 0.7, rol: 'riesgos' }, rev: { peso: 0.7, rol: 'riesgos' } },
  conectado_a: { fwd: { peso: 0.4, rol: 'verificar' }, rev: { peso: 0.4, rol: 'verificar' } },
}

// Nodos por los que nunca se sigue expandiendo (siguen apareciendo si los alcanza un camino).
const TIPOS_TERMINALES = new Set(['persona'])

export function construirGrafo(nodos: NodoG[], aristas: AristaG[]): Grafo {
  const g: Grafo = { nodos: new Map(), salientes: new Map(), entrantes: new Map() }
  for (const n of nodos) g.nodos.set(n.id, n)
  for (const a of aristas) {
    if (!g.nodos.has(a.origen) || !g.nodos.has(a.destino) || a.origen === a.destino) continue
    ;(g.salientes.get(a.origen) || g.salientes.set(a.origen, []).get(a.origen)!).push(a)
    ;(g.entrantes.get(a.destino) || g.entrantes.set(a.destino, []).get(a.destino)!).push(a)
  }
  return g
}

function grado(g: Grafo, id: string): number {
  return (g.salientes.get(id)?.length || 0) + (g.entrantes.get(id)?.length || 0)
}

function rolPorNodo(n: NodoG, rolArista: Rol): Rol {
  if (n.tipo === 'documento') return 'docs'
  if (n.tipo === 'credencial' || n.tipo === 'bloqueador') return 'riesgos'
  if (n.tipo === 'hardware') return 'desplegar' // maquinas/instancias: hay que desplegar o reiniciar ahi
  if (rolArista === 'desplegar' && (n.tipo === 'documento' || n.tipo === 'persona')) return 'verificar'
  return rolArista
}

type Estado = { id: string; score: number; dist: number; prev?: string; via?: string; rol: Rol; bloq: boolean }

export function planificar(g: Grafo, semillasIds: string[], op: Opciones = {}): Plan {
  const profundidad = op.profundidad ?? 5
  const umbral = op.umbral ?? 0.25
  const hubGrado = op.hub_grado ?? 14
  const semillas = semillasIds.filter((s) => g.nodos.has(s))
  const semSet = new Set(semillas)

  const mejor = new Map<string, Estado>()
  for (const s of semillas) mejor.set(s, { id: s, score: 1, dist: 0, rol: 'tocar', bloq: true })
  // Cola de prioridad simple (grafo pequeno): se extrae el de mayor score.
  const cola: Estado[] = [...mejor.values()]
  const cerrado = new Set<string>()
  const hubs = new Set<string>()
  let omitidos = 0

  while (cola.length) {
    let bi = 0
    for (let i = 1; i < cola.length; i++) if (cola[i].score > cola[bi].score) bi = i
    const cur = cola.splice(bi, 1)[0]
    if (cerrado.has(cur.id)) continue
    cerrado.add(cur.id)
    if (cur.dist >= profundidad) continue
    const nodo = g.nodos.get(cur.id)!
    if (!semSet.has(cur.id)) {
      if (TIPOS_TERMINALES.has(nodo.tipo)) continue
      if (grado(g, cur.id) > hubGrado) { hubs.add(nodo.nombre); continue } // hub: se reporta, no se expande
    }

    const vecinos: { a: AristaG; sentido: 'fwd' | 'rev' }[] = [
      ...(g.salientes.get(cur.id) || []).map((a) => ({ a, sentido: 'fwd' as const })),
      ...(g.entrantes.get(cur.id) || []).map((a) => ({ a, sentido: 'rev' as const })),
    ]
    for (const { a, sentido } of vecinos) {
      const regla = REGLAS[a.tipo]?.[sentido]
      if (!regla) continue
      const otroId = sentido === 'fwd' ? a.destino : a.origen
      if (cerrado.has(otroId)) continue
      const otro = g.nodos.get(otroId)
      if (!otro || otro.estado === 'deprecado') continue
      // Un hub solo transmite por relaciones fuertes: evita "todo cuelga de GitHub".
      const score = cur.score * regla.peso
      if (score < umbral) { omitidos++; continue }
      const previo = mejor.get(otroId)
      if (previo && previo.score >= score) continue
      const nombreCur = nodo.nombre
      const flecha = sentido === 'fwd' ? `${nombreCur} -${a.tipo}-> ${otro.nombre}` : `${otro.nombre} -${a.tipo}-> ${nombreCur}`
      const est: Estado = {
        id: otroId,
        score,
        dist: cur.dist + 1,
        prev: cur.id,
        via: flecha,
        rol: rolPorNodo(otro, regla.rol),
        bloq: cur.bloq && (a.is_blocking === undefined ? true : !!a.is_blocking),
      }
      mejor.set(otroId, est)
      cola.push(est)
    }
  }

  const items: ItemPlan[] = []
  for (const e of mejor.values()) {
    if (semSet.has(e.id)) continue
    const n = g.nodos.get(e.id)!
    items.push({
      id: n.id,
      nombre: n.nombre,
      tipo: n.tipo,
      tier: n.tier,
      distancia: e.dist,
      relevancia: Math.round(e.score * 100) / 100,
      rol: e.rol,
      via: e.via || '',
      bloqueante: e.bloq,
    })
  }
  items.sort((a, b) => b.relevancia - a.relevancia || a.distancia - b.distancia || a.nombre.localeCompare(b.nombre))
  return {
    semillas: semillas.map((s) => ({ id: s, nombre: g.nodos.get(s)!.nombre, tipo: g.nodos.get(s)!.tipo })),
    items,
    omitidos_por_ruido: omitidos,
    hubs: [...hubs],
  }
}

// Severidad al estilo analizar_impacto (compatibilidad con el contrato v1).
export type Severidad = 'CRITICAL_BLOCKING' | 'BLOCKING' | 'CRITICAL_DEGRADABLE' | 'DEGRADABLE' | 'NONE'
export function severidad(i: ItemPlan): Severidad {
  if (i.bloqueante && i.tier === 'critical') return 'CRITICAL_BLOCKING'
  if (i.bloqueante) return 'BLOCKING'
  if (i.tier === 'critical') return 'CRITICAL_DEGRADABLE'
  return 'DEGRADABLE'
}

export type Grupos = Record<Rol, ItemPlan[]> & { dudoso: ItemPlan[] }
export const UMBRAL_DUDOSO = 0.4

// Reparte los items en grupos de accion y aplica topes de tamano.
export function agrupar(plan: Plan, tope = 20): { grupos: Grupos; recortados: number } {
  const grupos: Grupos = { tocar: [], desplegar: [], verificar: [], docs: [], riesgos: [], dudoso: [] }
  let recortados = 0
  for (const i of plan.items) {
    const dest = i.relevancia < UMBRAL_DUDOSO ? grupos.dudoso : grupos[i.rol]
    if (dest.length >= tope) { recortados++; continue }
    dest.push(i)
  }
  return { grupos, recortados }
}
