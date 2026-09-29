// Resumen cold-start: contexto operativo completo en una unica peticion HTTP
// paralela para cualquier pilar (agente_id opcional). Ver AGENTS.md seccion 6,
// arquitectura-jarvis-asistente.md seccion 8.1 y Tarea [A9-WORKER-COLDSTART].
// Lee memoria desde las tablas canonicas (memory_observations/memory_items/
// memory_item_tags), no desde la tabla legacy "memoria" (Tarea
// [A12-DECOMMISSIONING-D1]).
import { Hono } from 'hono'
import type { Env } from '../types'
import { obtenerSemaforoCuotas } from './telemetria'

const app = new Hono<{ Bindings: Env }>()

// GET /resumen?agente_id=<id>
app.get('/', async (c) => {
  const db = c.env.DB
  const agenteId = c.req.query('agente_id')
  const inicio = performance.now()

  const [memorias, objetivos, confirmacionesPendientes, nodos, relaciones, semaforoCuotas] = await Promise.all([
    db
      .prepare(
        `SELECT mo.id, mo.capa, mo.texto, mo.origen, mo.confianza, mo.autor, mo.fecha,
                COALESCE(GROUP_CONCAT(mt.nombre), '') as etiquetas
         FROM memory_observations mo
         LEFT JOIN memory_item_tags mit ON mit.item_id = mo.item_id
         LEFT JOIN memory_tags mt ON mt.id = mit.tag_id
         WHERE mo.estado = 'activo'
         GROUP BY mo.id
         ORDER BY mo.fecha DESC`
      )
      .all<any>(),
    db
      .prepare("SELECT * FROM objetivos WHERE estado NOT IN ('hecho','completado','cancelado') ORDER BY actualizado DESC LIMIT 20")
      .all<any>(),
    db
      .prepare("SELECT * FROM confirmaciones WHERE estado='pendiente' AND (timeout IS NULL OR timeout > unixepoch()) ORDER BY creado DESC")
      .all<any>(),
    db.prepare('SELECT * FROM nodos ORDER BY nombre').all<any>(),
    db.prepare('SELECT * FROM relaciones ORDER BY creado DESC').all<any>(),
    obtenerSemaforoCuotas(db),
  ])

  const durMs = performance.now() - inicio
  c.header('Server-Timing', `db;dur=${durMs.toFixed(1)}`)

  return c.json({
    agente_id: agenteId || 'general',
    timestamp: Date.now(),
    memorias_prioritarias: memorias.results.slice(0, 15).map((m: any) => ({
      id: m.id,
      tipo: m.capa,
      resumen: (m.texto || '').slice(0, 120),
      texto: m.texto,
      etiquetas: (m.etiquetas || '').split(',').filter(Boolean),
      confianza: m.confianza === 'alta' ? 1.0 : m.confianza === 'media' ? 0.8 : 0.5,
    })),
    objetivos_abiertos: objetivos.results.map((o: any) => ({
      id: o.id,
      titulo: o.titulo,
      descripcion: o.descripcion,
      estado: o.estado,
      prioridad: o.prioridad || 'media',
      asignado_a: o.asignado_a || o.responsable,
      creado_por: o.creado_por,
      timeout: o.timeout,
    })),
    confirmaciones_n3_pendientes: confirmacionesPendientes.results.map((cf: any) => ({
      id: cf.id,
      herramienta: cf.herramienta,
      accion: cf.herramienta,
      resumen: cf.resumen,
      nivel: cf.nivel,
      contexto: cf.contexto || '',
      impacto: cf.impacto || '',
      timeout: cf.timeout,
    })),
    semaforo_cuotas: semaforoCuotas,
    // Compatibilidad total con clientes actuales:
    memoria: memorias.results,
    objetivos: objetivos.results,
    confirmaciones_pendientes: confirmacionesPendientes.results,
    nodos: nodos.results,
    relaciones: relaciones.results,
  })
})

export default app
