// Esquemas Zod de telemetria de IA (torre de control de cuotas de 5h).
// Ver AGENTS.md seccion 6, arquitectura-jarvis-asistente.md seccion 8.4 y
// Tarea [A7-WORKER-TELEMETRIA-CUOTAS].
import { z } from 'zod'

export const PROVEEDORES = ['claude_pro', 'gemini', 'nvidia'] as const

// Snapshot completo desde pc-watcher (claude/antigravity/geminiLive) o evento
// puntual (proveedor + tokens/latencia de una llamada individual).
export const AiTelemetriaSchema = z.object({
  actor: z.string().default('pc-watcher'),
  motores: z.record(z.any()).optional(),
  proveedor: z.enum(PROVEEDORES).optional(),
  tokens_in: z.number().optional(),
  tokens_out: z.number().optional(),
  latencia_ms: z.number().optional(),
})

export type AiTelemetria = z.infer<typeof AiTelemetriaSchema>

export type SemaforoColor = 'verde' | 'amarillo' | 'rojo'

export type SemaforoCuotas = {
  claude_pro: SemaforoColor
  reset_en_horas?: number
  recomendacion: string
}

export type AiLimitsResponse = {
  configured: boolean
  hayDatos: boolean
  ts: string
  actor: string
  motores: Record<string, any>
  semaforo_cuotas: SemaforoCuotas
}
