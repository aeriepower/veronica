// Esquemas Zod de "confirmaciones" (pasarela HITL N3). Ver AGENTS.md seccion
// 6 y Tarea [A6-WORKER-CONFIRMACIONES].
import { z } from 'zod'

export const NIVELES = ['N1', 'N2', 'N3'] as const
export const ACTORES = ['antigravity', 'claude', 'jarvis'] as const

export const CrearConfirmacionSchema = z.object({
  herramienta: z.string().min(1),
  args: z.union([z.record(z.any()), z.string()]).optional(),
  nivel: z.enum(NIVELES).default('N3'),
  resumen: z.string().min(3),
  actor: z.enum(ACTORES).default('jarvis'),
  contexto: z.string().optional(),
  impacto: z.string().optional(),
  // Timestamp unix (segundos) o duracion en segundos desde ahora. Resuelto en
  // la ruta: valores < 1_000_000 se tratan como offset; default 1800 (30 min).
  timeout: z.number().optional(),
})

export type CrearConfirmacion = z.infer<typeof CrearConfirmacionSchema>

export const ResolverConfirmacionSchema = z.object({
  decision: z.enum(['aprobar', 'rechazar']),
  quien: z.string().default('david'),
  motivo: z.string().optional(),
})

export type ResolverConfirmacion = z.infer<typeof ResolverConfirmacionSchema>
