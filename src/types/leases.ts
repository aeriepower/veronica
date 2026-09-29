// Esquemas Zod de "leases" (exclusion mutua distribuida entre pilares sobre
// un recurso compartido). Ver AGENTS.md seccion 0 y Tarea [A8-D1-LEASES].
import { z } from 'zod'

export const TITULARES = ['antigravity', 'claude', 'jarvis'] as const

// Acepta recurso/recurso_id y titular/propietario como alias, y
// ttl_segundos/timeout para la duracion del lease en segundos.
export const AdquirirLeaseSchema = z.preprocess(
  (raw: any) => ({
    recurso: raw?.recurso ?? raw?.recurso_id,
    titular: raw?.titular ?? raw?.propietario,
    ttl_segundos: raw?.ttl_segundos ?? raw?.timeout,
    motivo: raw?.motivo,
  }),
  z.object({
    recurso: z.string().min(2),
    titular: z.enum(TITULARES),
    ttl_segundos: z.number().positive().default(300),
    motivo: z.string().optional(),
  })
)

export type AdquirirLease = z.infer<typeof AdquirirLeaseSchema>

// Libera por (recurso + titular) o por lease_id.
export const LiberarLeaseSchema = z.preprocess(
  (raw: any) => ({
    recurso: raw?.recurso,
    titular: raw?.titular ?? raw?.propietario,
    lease_id: raw?.lease_id,
  }),
  z
    .object({
      recurso: z.string().min(2).optional(),
      titular: z.enum(TITULARES).optional(),
      lease_id: z.string().optional(),
    })
    .refine((b) => b.lease_id || (b.recurso && b.titular), {
      message: 'se requiere lease_id, o recurso y titular',
    })
)

export type LiberarLease = z.infer<typeof LiberarLeaseSchema>
