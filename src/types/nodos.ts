// Esquemas Zod de "nodos" (mapa de dependencias / grafo de infraestructura).
// Vocabulario cerrado de tipos ampliado el 29-sep-2026 (migration_c2).
import { z } from 'zod'

export const NODO_TIPOS = [
  'software', 'hardware', 'credencial', 'pilar', 'servicio_externo', 'componente_codigo',
  'repositorio', 'base_datos', 'workflow', 'documento', 'persona', 'bloqueador', 'herramienta',
] as const
export const NODO_TIERS = ['standard', 'critical'] as const
export const NODO_ESTADOS = ['activo', 'deprecado', 'bloqueado'] as const

const DATA_MAX = 8000

// `data`: JSON libre (objeto) con los campos del nodo. Se acepta objeto o
// string JSON; siempre se guarda como string JSON de objeto (max 8 KB).
export const DataSchema = z
  .union([z.string(), z.record(z.any())])
  .transform((v, ctx) => {
    let obj: unknown = v
    if (typeof v === 'string') {
      try { obj = JSON.parse(v) } catch { ctx.addIssue({ code: 'custom', message: 'data no es JSON valido' }); return z.NEVER }
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      ctx.addIssue({ code: 'custom', message: 'data debe ser un objeto JSON' }); return z.NEVER
    }
    const s = JSON.stringify(obj)
    if (s.length > DATA_MAX) { ctx.addIssue({ code: 'custom', message: `data supera ${DATA_MAX} caracteres` }); return z.NEVER }
    return s
  })

const campos = {
  nombre: z.string().min(1),
  descripcion: z.string().optional(),
  autor: z.string().optional(),
  origen: z.string().optional(),
  identificador: z.string().min(1).optional(),
  alias: z.array(z.string().min(1)).max(20).optional(),
  estado: z.enum(NODO_ESTADOS).optional(),
  data: DataSchema.optional(),
}

export const CrearNodoSchema = z.object({
  id: z.string().min(1).optional(),
  ...campos,
  tipo: z.enum(NODO_TIPOS),
  tier: z.enum(NODO_TIERS).default('standard'),
  forzar: z.boolean().optional(),
})

export const ClasificarNodoSchema = z.object({
  ...campos,
  tipo: z.enum(NODO_TIPOS).optional(),
  tier: z.enum(NODO_TIERS).optional(),
  ia: z.boolean().optional(),
})

export const ItemLoteSchema = z.object({
  id: z.string().min(1).optional(),
  ...campos,
  tipo: z.enum(NODO_TIPOS).optional(),
  tier: z.enum(NODO_TIERS).optional(),
  forzar: z.boolean().optional(),
})

export const RelacionLoteSchema = z.object({
  origen: z.string().min(1),
  destino: z.string().min(1),
  tipo: z.enum(['se_ejecuta_en', 'contiene', 'instancia_de', 'depende_de', 'llama_a', 'secret_share', 'conectado_a']),
  descripcion: z.string().optional(),
  confianza: z.enum(['baja', 'media', 'alta']).default('media'),
  is_blocking: z.boolean().default(true),
})

export const LoteSchema = z.object({
  lote_id: z.string().min(1).max(64).optional(),
  modo: z.enum(['simular', 'aplicar']).default('simular'),
  ia: z.boolean().default(false),
  actualizar: z.boolean().default(false),
  sugerencias: z.boolean().default(true),
  autor: z.string().optional(),
  origen: z.string().optional(),
  items: z.array(ItemLoteSchema).min(1).max(100),
  relaciones: z.array(RelacionLoteSchema).max(300).optional(),
})

export type CrearNodo = z.infer<typeof CrearNodoSchema>
export type ClasificarNodo = z.infer<typeof ClasificarNodoSchema>
export type ItemLote = z.infer<typeof ItemLoteSchema>
export type Lote = z.infer<typeof LoteSchema>
