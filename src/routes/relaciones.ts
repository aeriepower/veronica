// Grafo de nodos: listado/alta de relaciones y Blast Radius (analisis de
// impacto). CTE recursiva segun arquitectura-jarvis-asistente.md seccion 6.3.
// Usa las columnas ya desplegadas en D1 (origen/destino, no origen_id/
// destino_id) mas tier/is_blocking anadidas por migration_a3_blast_radius.sql.
import { Hono } from 'hono'
import type { Env } from '../types'
import { CrearRelacionSchema, RELACION_TIPOS } from '../types/relaciones'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

const SEVERIDAD_ORDEN = ['CRITICAL_BLOCKING', 'BLOCKING', 'CRITICAL_DEGRADABLE', 'DEGRADABLE', 'NONE'] as const
type Severidad = (typeof SEVERIDAD_ORDEN)[number]

type FilaImpacto = {
  nodo_id: string
  nombre: string
  tipo: string
  tier: string
  distancia: number
  ruta: string
  es_bloqueante_acumulado: number
  severidad: Severidad
}

const app = new Hono<{ Bindings: Env }>()

// GET /relaciones?nodo=<id>&tipo=<tipo>
app.get('/', async (c) => {
  const db = c.env.DB
  const nodo = c.req.query('nodo')
  const tipoRel = c.req.query('tipo')
  if (tipoRel && !(RELACION_TIPOS as readonly string[]).includes(tipoRel)) {
    return c.json({ error: `tipo invalido: debe ser uno de ${RELACION_TIPOS.join(', ')}` }, 400)
  }
  let q
  if (nodo && tipoRel) {
    q = await db.prepare('SELECT * FROM relaciones WHERE (origen = ? OR destino = ?) AND tipo = ? ORDER BY creado DESC').bind(nodo, nodo, tipoRel).all()
  } else if (nodo) {
    q = await db.prepare('SELECT * FROM relaciones WHERE origen = ? OR destino = ? ORDER BY creado DESC').bind(nodo, nodo).all()
  } else if (tipoRel) {
    q = await db.prepare('SELECT * FROM relaciones WHERE tipo = ? ORDER BY creado DESC').bind(tipoRel).all()
  } else {
    q = await db.prepare('SELECT * FROM relaciones ORDER BY creado DESC').all()
  }
  return c.json(q.results)
})

// POST /relaciones
app.post('/', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)
  const parsed = CrearRelacionSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data
  const relId = b.id || id('r')
  await db.prepare(
    'INSERT INTO relaciones (id, origen, destino, tipo, descripcion, confianza, is_blocking, creado, autor) VALUES (?,?,?,?,?,?,?,?,?)'
  ).bind(relId, b.origen, b.destino, b.tipo, b.descripcion || null, b.confianza, b.is_blocking ? 1 : 0, ahora(), b.autor || null).run()
  return c.json({ id: relId })
})

// GET /relaciones/impacto?nodo=<id> — Blast Radius (upstream: quien se rompe si <id> cambia/falla)
app.get('/impacto', async (c) => {
  const db = c.env.DB
  const nodoId = c.req.query('nodo')
  if (!nodoId) {
    return c.json({ error: 'falta el parametro ?nodo=' }, 400)
  }

  const target: any = await db.prepare('SELECT id FROM nodos WHERE id = ?').bind(nodoId).first()
  if (!target) {
    return c.json({ error: `nodo '${nodoId}' no encontrado` }, 404)
  }

  const q = await db.prepare(`
    WITH RECURSIVE blast_radius(nodo_id, nombre, tipo, tier, ruta, distancia, es_bloqueante_acumulado) AS (
      SELECT n.id, n.nombre, n.tipo, n.tier, n.id, 0, 1
      FROM nodos n
      WHERE n.id = ?1

      UNION ALL

      SELECT n.id, n.nombre, n.tipo, n.tier,
             br.ruta || ' -> ' || n.id,
             br.distancia + 1,
             (br.es_bloqueante_acumulado AND r.is_blocking)
      FROM blast_radius br
      JOIN relaciones r ON r.destino = br.nodo_id
      JOIN nodos n ON n.id = r.origen
      WHERE br.ruta NOT LIKE '%' || n.id || '%'
        AND br.distancia < 6
    )
    SELECT
      nodo_id, nombre, tipo, tier, distancia, ruta, es_bloqueante_acumulado,
      CASE
        WHEN es_bloqueante_acumulado = 1 AND tier = 'critical' THEN 'CRITICAL_BLOCKING'
        WHEN es_bloqueante_acumulado = 1 THEN 'BLOCKING'
        WHEN tier = 'critical' THEN 'CRITICAL_DEGRADABLE'
        ELSE 'DEGRADABLE'
      END AS severidad
    FROM blast_radius
    WHERE distancia > 0
    ORDER BY
      CASE WHEN es_bloqueante_acumulado = 1 AND tier = 'critical' THEN 0
           WHEN es_bloqueante_acumulado = 1 THEN 1
           WHEN tier = 'critical' THEN 2 ELSE 3 END,
      distancia ASC
  `).bind(nodoId).all<FilaImpacto>()

  const filas = q.results

  const impactChain = filas.map((f) => ({
    node_id: f.nodo_id,
    nombre: f.nombre,
    tipo: f.tipo,
    distancia: f.distancia,
    path: f.ruta,
    is_blocking: !!f.es_bloqueante_acumulado,
    severity: f.severidad,
  }))

  const maxSeverity: Severidad = filas.length
    ? SEVERIDAD_ORDEN.find((s) => filas.some((f) => f.severidad === s)) || 'NONE'
    : 'NONE'

  const criticalNodesImpacted = filas.filter((f) => f.tier === 'critical').map((f) => f.nodo_id)

  const preFlightVerdict = maxSeverity === 'CRITICAL_BLOCKING' ? 'BLOCKED_REQUIRES_CONFIRMATION' : 'PROCEED'

  const guardrails: string[] =
    preFlightVerdict === 'BLOCKED_REQUIRES_CONFIRMATION'
      ? [
          'No desplegar en caliente; requiere confirmación N3 de David (POST /confirmaciones).',
          'Verificar compatibilidad hacia atrás con los sistemas críticos listados en critical_nodes_impacted.',
          'Realizar backup previo (workflow de n8n, metadata de Salesforce, etc.) antes de modificar.',
        ]
      : filas.length
        ? ['Sin bloqueos críticos; revisar de todas formas los nodos DEGRADABLE listados en impact_chain.']
        : ['Sin nodos afectados detectados en el grafo.']

  return c.json({
    target_node: nodoId,
    blast_radius_summary: {
      total_affected_nodes: filas.length,
      max_severity: maxSeverity,
      critical_nodes_impacted: criticalNodesImpacted,
    },
    impact_chain: impactChain,
    pre_flight_verdict: preFlightVerdict,
    actionable_guardrails: guardrails,
  })
})

export default app
