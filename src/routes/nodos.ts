// Nodos del grafo de infraestructura (sistemas, servicios, credenciales
// logicas, dispositivos). Extraido de index.ts para poder reutilizar la
// misma logica desde MCP via app.request() sin duplicarla (contrato-mcp-
// veronica.md: "MCP debe llamar a las mismas funciones internas que ya usa
// el Worker, nunca tocar D1 por su cuenta"). [MCP-A13].
//
// [CLASIFICADOR-NODOS, 29-sep-2026]: antes de insertar, POST /nodos ahora
// clasifica el nombre contra los nodos existentes (ver
// ../services/clasificador.ts) para no repetir el incidente del 28-sep
// (2 nodos duplicados por no comparar antes de crear, AGENTS.md seccion
// 13). Implementa a escala minima "propuesta_MCP_gestione_la_BBDD.md".
import { Hono } from 'hono'
import type { Env } from '../types'
import { CrearNodoSchema, NODO_TIPOS } from '../types/nodos'
import { clasificarNodo } from '../services/clasificador'

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

// GET /nodos/clasificar?nombre=&tipo= — preview de solo lectura: no escribe
// nada. Devuelve decision (existe_exacto|posible_duplicado|nuevo) y hasta
// 5 candidatos puntuados por similitud. Pensada para que un agente
// compruebe antes de llamar a nodo_crear cuando tiene dudas.
app.get('/clasificar', async (c) => {
  const db = c.env.DB
  const nombre = c.req.query('nombre')
  const tipo = c.req.query('tipo')
  if (!nombre) {
    return c.json({ error: 'falta el parametro ?nombre=' }, 400)
  }
  if (tipo && !(NODO_TIPOS as readonly string[]).includes(tipo)) {
    return c.json({ error: `tipo invalido: debe ser uno de ${NODO_TIPOS.join(', ')}` }, 400)
  }
  const resultado = await clasificarNodo(db, nombre, tipo)
  return c.json(resultado)
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

  const clasificacion = await clasificarNodo(db, b.nombre, b.tipo)

  if (clasificacion.decision === 'existe_exacto') {
    // Idempotente: no duplica, devuelve el nodo ya existente.
    return c.json({ id: clasificacion.candidatos[0].id, duplicado: true, motivo: 'nombre normalizado ya existe', candidatos: clasificacion.candidatos })
  }

  if (clasificacion.decision === 'posible_duplicado' && !b.forzar) {
    return c.json(
      {
        error: 'posible_duplicado',
        mensaje: 'Hay nodos existentes con nombre parecido. Revisa candidatos o reintenta con forzar:true si es realmente distinto.',
        candidatos: clasificacion.candidatos,
      },
      409
    )
  }

  const nodoId = b.id || id('n')
  await db
    .prepare('INSERT INTO nodos (id, nombre, tipo, descripcion, tier, creado, autor) VALUES (?,?,?,?,?,?,?)')
    .bind(nodoId, b.nombre, b.tipo, b.descripcion || null, b.tier, ahora(), b.autor || null)
    .run()
  return c.json({ id: nodoId, duplicado: false })
})

export default app
