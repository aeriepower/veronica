// Listas (hoy: "ideas") no son una tabla aparte: son memoria filtrada por
// etiqueta 'idea'. Reutiliza exactamente la misma logica de POST/GET
// /memoria (via app.request(), sin tocar D1 por su cuenta) en vez de
// duplicarla. [MCP-A13]
//
// Corrige el bug documentado en la hoja de ruta: el cliente local de Jarvis
// (anadir_a_lista) fija la etiqueta 'candyla' a fuego para cualquier idea,
// tenga o no que ver con Candyla. Aqui 'candyla' solo se aplica si el
// llamante lo pide explicitamente via etiqueta_proyecto.
import { Hono } from 'hono'
import { z } from 'zod'
import type { Env } from '../types'
import memoria from './memoria'

export const LISTAS = ['ideas'] as const
const ETIQUETAS_PROYECTO = ['candyla', 'atiendo', 'jarvis-app', 'meta-sistema'] as const

const AnadirListaSchema = z.object({
  lista: z.enum(LISTAS),
  texto: z.string().min(3),
  etiqueta_proyecto: z.enum(ETIQUETAS_PROYECTO).optional(),
  autor: z.enum(['antigravity', 'claude', 'jarvis', 'david']).default('jarvis'),
})

const app = new Hono<{ Bindings: Env }>()

// GET /listas/:lista
app.get('/:lista', async (c) => {
  const lista = c.req.param('lista')
  if (!(LISTAS as readonly string[]).includes(lista)) {
    return c.json({ error: `lista invalida: debe ser una de ${LISTAS.join(', ')}` }, 400)
  }
  const res = await memoria.request('/?tag=idea&estado=activo', {}, c.env)
  return res
})

// POST /listas
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = AnadirListaSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data
  const etiquetas = b.etiqueta_proyecto ? ['idea', b.etiqueta_proyecto] : ['idea']

  const res = await memoria.request(
    '/',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        capa: 'semantica',
        texto: b.texto,
        origen: 'david',
        autor: b.autor,
        etiquetas,
      }),
    },
    c.env
  )
  return res
})

export default app
