// Esquemas Zod de la memoria canonica (memory_items/memory_observations).
// Acepta tanto el vocabulario propio (nombre/capa/texto) como el alias
// ingles usado por otras piezas del ecosistema (subject_key/memory_type/
// object_text), y normaliza ambos a la forma canonica. Ver AGENTS.md
// seccion 6 y Tarea [A4-WORKER-MEMORIA-API].
//
// [MCP-A13] Anadido ESTADOS_MEMORIA (antes "estado" no tenia constante
// propia, a diferencia de capa/origen/confianza/autor) y la etiqueta
// 'personal' (gustos/preferencias de David sin proyecto asociado) -
// contrato-mcp-veronica.md, tabla de prerrequisitos de Fase 1.
import { z } from 'zod'

export const CAPAS = ['episodica', 'semantica', 'procedimental'] as const
export const ORIGENES = ['david', 'inferido', 'herramienta'] as const
export const CONFIANZAS = ['baja', 'media', 'alta'] as const
export const AUTORES = ['antigravity', 'claude', 'jarvis', 'david'] as const
export const ESTADOS_MEMORIA = ['activo', 'archivado'] as const
export const ETIQUETAS_VALIDAS = ['candyla', 'atiendo', 'jarvis-app', 'arquitectura', 'autonomo', 'meta-sistema', 'idea', 'personal'] as const

const MEMORY_TYPE_A_CAPA: Record<string, (typeof CAPAS)[number]> = {
  episodic: 'episodica',
  semantic: 'semantica',
  procedural: 'procedimental',
}

const etiquetasSchema = z
  .union([z.array(z.string()), z.string()])
  .optional()
  .transform((v) => {
    if (!v) return ['meta-sistema' as const]
    const rawArr = typeof v === 'string' ? v.split(',').map((s) => s.trim()) : v
    const validas = rawArr.filter((t): t is (typeof ETIQUETAS_VALIDAS)[number] =>
      (ETIQUETAS_VALIDAS as readonly string[]).includes(t)
    )
    return validas.length > 0 ? validas : (['meta-sistema' as const])
  })
  .default(['meta-sistema'])

const camposBase = {
  nombre: z.string().min(2).optional(),
  subject_key: z.string().min(2).optional(),
  capa: z.enum(CAPAS).optional(),
  memory_type: z.enum(['episodic', 'semantic', 'procedural']).optional(),
  texto: z.string().min(3).optional(),
  object_text: z.string().min(3).optional(),
  origen: z.enum(ORIGENES).default('herramienta'),
  confianza: z.enum(CONFIANZAS).default('media'),
  autor: z.enum(AUTORES).default('jarvis'),
  etiquetas: etiquetasSchema,
  revisar: z.string().optional(),
}

function refinarCapaYTexto(v: { capa?: string; memory_type?: string; texto?: string; object_text?: string }, ctx: z.RefinementCtx) {
  if (!v.capa && !v.memory_type) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'falta capa (o memory_type)', path: ['capa'] })
  }
  if (!v.texto && !v.object_text) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'falta texto (o object_text)', path: ['texto'] })
  }
}

function canonizar<T extends { nombre?: string; subject_key?: string; capa?: string; memory_type?: string; texto?: string; object_text?: string }>(
  v: T
) {
  return {
    nombre: v.nombre ?? v.subject_key,
    capa: (v.capa ?? MEMORY_TYPE_A_CAPA[v.memory_type as string]) as (typeof CAPAS)[number],
    texto: (v.texto ?? v.object_text) as string,
    origen: (v as unknown as { origen: (typeof ORIGENES)[number] }).origen,
    confianza: (v as unknown as { confianza: (typeof CONFIANZAS)[number] }).confianza,
    autor: (v as unknown as { autor: (typeof AUTORES)[number] }).autor,
    etiquetas: (v as unknown as { etiquetas: (typeof ETIQUETAS_VALIDAS)[number][] }).etiquetas,
    revisar: (v as unknown as { revisar?: string }).revisar,
  }
}

export const MemoriaIngestaCanonicaSchema = z
  .object(camposBase)
  .superRefine(refinarCapaYTexto)
  .transform(canonizar)

export type MemoriaIngestaCanonica = z.infer<typeof MemoriaIngestaCanonicaSchema>

export const MemoriaCorregirSchema = z
  .object({ ...camposBase, id: z.string().min(1) })
  .superRefine(refinarCapaYTexto)
  .transform((v) => ({ ...canonizar(v), id: v.id }))

export type MemoriaCorregir = z.infer<typeof MemoriaCorregirSchema>

export const MemoriaOlvidarSchema = z.object({
  id: z.string().min(1),
  motivo: z.string().optional(),
  autor: z.enum(AUTORES).default('jarvis'),
})

export type MemoriaOlvidar = z.infer<typeof MemoriaOlvidarSchema>

// [MCP-A13] GET /memoria?capa=&estado=&autor=&tag= no validaba nada (el
// valor se metia directo en el SQL: "capa=semantico" no daba error, solo
// encontraba menos de lo debido, en silencio). contrato-mcp-veronica.md
// lo marca como prerrequisito bloqueante de memoria_listar.
export const MemoriaListarQuerySchema = z.object({
  capa: z.enum(CAPAS).optional(),
  estado: z.enum(ESTADOS_MEMORIA).default('activo'),
  autor: z.enum(AUTORES).optional(),
  tag: z.enum(ETIQUETAS_VALIDAS).optional(),
})

export type MemoriaListarQuery = z.infer<typeof MemoriaListarQuerySchema>
