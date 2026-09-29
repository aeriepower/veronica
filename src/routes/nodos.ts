// Nodos del grafo de infraestructura (sistemas, servicios, credenciales
// logicas, dispositivos). Extraido de index.ts para poder reutilizar la
// misma logica desde MCP via app.request() sin duplicarla (contrato-mcp-
// veronica.md: "MCP debe llamar a las mismas funciones internas que ya usa
// el Worker, nunca tocar D1 por su cuenta"). [MCP-A13].
import { Hono } from 'hono'
import type { Env } from '../types'
import { CrearNodoSchema, NODO_TIPOS } from '../types/nodos'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

const app = new Hono<{ Bindings: Env }>()

// GET /nodos?tipo=
app.get('/', async (c) => {
  const db = c.env.DB
  const tipo = c.req.query('tipo')
  if (tipo && !(NODO_TIPOS as readonly string[]).includes(tipo)) {
    return c.json({ error: `tipo invalido: debe ser uno de ${NODO_TIPOS.join(', ')}` }, 400)
  }
  const q = tipo
    ? await db.prepare('SELECT * FROM nodos WHERE tipo = ? ORDER BY nombre').bind(tipo).all()
    : await db.prepare('SELECT * FROM nodos ORDER BY nombre').all()
  return c.json(q.results)
})

// POST /nodos
app.post('/', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = CrearNodoSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data
  const nodoId = b.id || id('n')
  await db
    .prepare('INSERT INTO nodos (id, nombre, tipo, descripcion, tier, creado, autor) VALUES (?,?,?,?,?,?,?)')
    .bind(nodoId, b.nombre, b.tipo, b.descripcion || null, b.tier, ahora(), b.autor || null)
    .run()
  return c.json({ id: nodoId })
})

export default app
