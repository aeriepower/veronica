// Esquemas Zod de "nodos" (mapa de dependencias / grafo de infraestructura).
// [MCP-A13]: antes tipo era texto libre sin validar y POST /nodos no
// aceptaba tier (solo se marcaba critical a mano por SQL). Prerrequisito
// de nodo_crear/nodo_listar en contrato-mcp-veronica.md.
// [CLASIFICADOR-NODOS, 29-sep-2026]: `forzar` permite saltarse el bloqueo
// por posible_duplicado cuando el agente ya comprobo que es un nodo
// realmente distinto (ver ../services/clasificador.ts).
import { z } from 'zod'

export const NODO_TIPOS = ['software', 'hardware', 'credencial', 'pilar', 'servicio_externo', 'componente_codigo'] as const
export const NODO_TIERS = ['standard', 'critical'] as const

export const CrearNodoSchema = z.object({
  id: z.string().min(1).optional(),
  nombre: z.string().min(1),
  tipo: z.enum(NODO_TIPOS),
  descripcion: z.string().optional(),
  tier: z.enum(NODO_TIERS).default('standard'),
  autor: z.string().optional(),
  forzar: z.boolean().optional(),
})

export type CrearNodo = z.infer<typeof CrearNodoSchema>
