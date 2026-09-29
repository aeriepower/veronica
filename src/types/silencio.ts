// Esquemas Zod del motor de silencio inteligente (interrupcion selectiva).
// Ver Santo Grial Fase D y Tarea [D1-SILENCIO-MOTOR-INTERRUPCION].
import { z } from 'zod'

export const FactoresInterrupcionSchema = z.object({
  R: z.number().min(0).max(1), // Riesgo tecnico
  U: z.number().min(0).max(1), // Urgencia temporal
  Conf: z.number().min(0).max(1), // Certeza / confianza en la informacion
  C: z.number().min(0).max(1), // Coste de no intervenir / oportunidad
  S: z.number().min(0).max(1).default(0.5), // Contexto sensorial / presencia
  D: z.number().min(0).max(1).default(0), // Deep Work / concentracion en IDE
  Ign: z.number().min(0).max(1).default(0), // Fatiga por avisos recientes
})

export type FactoresInterrupcion = z.infer<typeof FactoresInterrupcionSchema>

export const CANALES_SALIDA = ['critica_inmediata', 'oportunista', 'digest_diario', 'descarte_pasivo'] as const
export type CanalSalida = (typeof CANALES_SALIDA)[number]

export type ResultadoInterrupcion = {
  score: number
  canal: CanalSalida
  factores: FactoresInterrupcion
  corazonada: boolean
  detalles: string
}

// POST /silencio/eventos — registra un evento ya evaluado (o a evaluar
// server-side) en silencio_eventos.
export const RegistrarEventoSchema = z.object({
  titulo: z.string().min(1),
  resumen: z.string().optional(),
  factores: FactoresInterrupcionSchema,
})

export type RegistrarEvento = z.infer<typeof RegistrarEventoSchema>

// POST /silencio/digest-despachado — sin ids, despacha todo el digest
// pendiente; con ids, solo esos eventos.
export const DespacharDigestSchema = z.object({
  ids: z.array(z.string()).optional(),
})

export type DespacharDigest = z.infer<typeof DespacharDigestSchema>

// POST /silencio/digest/generar
export const GenerarDigestSchema = z.object({
  momento: z.enum(['matutino', 'nocturno']),
})

export type GenerarDigest = z.infer<typeof GenerarDigestSchema>

// POST /silencio/corazonada/evaluar
export const EvaluarCorazonadaSchema = z.object({
  titulo: z.string().min(1),
  detalle: z.string().min(1),
  R: z.number().min(0).max(1),
  Conf: z.number().min(0).max(1),
})

export type EvaluarCorazonada = z.infer<typeof EvaluarCorazonadaSchema>
