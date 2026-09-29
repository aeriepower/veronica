// Esquemas Zod de "objetivos" (bus de tareas asincronas entre pilares).
// Ver AGENTS.md seccion 6 y Tarea [A5-WORKER-OBJETIVOS].
import { z } from 'zod'

export const ASIGNABLES = ['antigravity', 'claude', 'jarvis', 'david'] as const
export const CREADORES = ['antigravity', 'claude', 'jarvis', 'david', 'candyla-sentinel'] as const
export const PRIORIDADES = ['critica', 'alta', 'media', 'baja'] as const
export const ESTADOS = ['pendiente', 'en_progreso', 'en_curso', 'bloqueado', 'completado', 'hecho', 'cancelado'] as const

export const CrearObjetivoSchema = z
  .object({
    titulo: z.string().min(3),
    descripcion: z.string().optional(),
    asignado_a: z.enum(ASIGNABLES).optional(),
    responsable: z.enum(ASIGNABLES).optional(),
    creado_por: z.enum(CREADORES).default('antigravity'),
    prioridad: z.enum(PRIORIDADES).default('media'),
    timeout: z.number().optional(),
    idempotency_key: z.string().optional(),
    avisar_al_terminar: z.boolean().default(false),
  })
  .refine((v) => v.asignado_a || v.responsable, {
    message: 'falta asignado_a (o su alias responsable)',
    path: ['asignado_a'],
  })
  .transform((v) => ({ ...v, asignado_a: (v.asignado_a ?? v.responsable) as (typeof ASIGNABLES)[number] }))

export type CrearObjetivo = z.infer<typeof CrearObjetivoSchema>

export const ActualizarObjetivoSchema = z.object({
  estado: z.enum(ESTADOS),
  quien: z.string().optional(),
  resultado_json: z.any().optional(),
  artefactos: z.union([z.array(z.string()), z.string()]).optional(),
})

export type ActualizarObjetivo = z.infer<typeof ActualizarObjetivoSchema>
