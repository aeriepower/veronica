// Vocabulario cerrado de "relaciones.tipo" (contrato-mcp-veronica.md,
// prerrequisito de relacion_crear/relacion_listar). Agrupado por categoria
// semantica: estructural/jerarquia, dependencia operativa (alimenta blast
// radius), credencial, integracion. [MCP-A13].
import { z } from 'zod'

export const RELACION_TIPOS = ['se_ejecuta_en', 'contiene', 'instancia_de', 'depende_de', 'llama_a', 'secret_share', 'conectado_a'] as const

export const CrearRelacionSchema = z.object({
  id: z.string().min(1).optional(),
  origen: z.string().min(1),
  destino: z.string().min(1),
  tipo: z.enum(RELACION_TIPOS),
  descripcion: z.string().optional(),
  confianza: z.enum(['baja', 'media', 'alta']).default('media'),
  is_blocking: z.boolean().default(true),
  autor: z.string().optional(),
})

export type CrearRelacion = z.infer<typeof CrearRelacionSchema>
