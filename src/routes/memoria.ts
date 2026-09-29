// Memoria canonica (memory_items/memory_observations/memory_item_tags).
// La Fase A (Tarea [A4-WORKER-MEMORIA-API]) hacia dual-write a la tabla
// legacy "memoria"; la Tarea [A12-DECOMMISSIONING-D1] la retira: este
// endpoint ya no lee ni escribe "memoria".
import { Hono } from 'hono'
import type { Env } from '../types'
import {
  MemoriaIngestaCanonicaSchema,
  MemoriaCorregirSchema,
  MemoriaOlvidarSchema,
  MemoriaListarQuerySchema,
  CAPAS,
  ORIGENES,
  CONFIANZAS,
  AUTORES,
  ESTADOS_MEMORIA,
  ETIQUETAS_VALIDAS,
} from '../types/memoria'
import { ejecutarCuracionNocturna, type TitularCuracion } from '../services/curacion'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

// Slug descriptivo cuando no viene "nombre": primeras palabras del texto,
// o "m_" + timestamp si el texto no aporta caracteres alfanumericos.
function slugDesdeTexto(texto: string): string {
  const slug = texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 40)
  return slug || `m_${Date.now()}`
}

// FTS5 trata "-", '"' y palabras como NOT/AND/OR/NEAR como operadores.
// Entrecomillar cada token como frase literal evita errores de sintaxis
// (p.ej. "nucleo-worker" o un termino que contenga NOT).
function sanitizarFts5(termino: string): string {
  return termino
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' ')
}

const app = new Hono<{ Bindings: Env }>()

// GET /memoria?capa=&estado=&autor=&tag= — [MCP-A13] ahora validado con Zod
// (mismo esquema que MCP vera en memoria_listar): un valor fuera del enum
// da 400 con detalle, nunca "0 resultados" en silencio.
app.get('/', async (c) => {
  const db = c.env.DB
  const parsed = MemoriaListarQuerySchema.safeParse({
    capa: c.req.query('capa'),
    estado: c.req.query('estado'),
    autor: c.req.query('autor'),
    tag: c.req.query('tag'),
  })
  if (!parsed.success) {
    return c.json({ error: 'query invalida', detalles: parsed.error.flatten() }, 400)
  }
  const { capa, estado, autor, tag } = parsed.data

  const condiciones = ['mo.estado = ?']
  const params: unknown[] = [estado]

  if (capa) {
    condiciones.push('mo.capa = ?')
    params.push(capa)
  }
  if (autor) {
    condiciones.push('mo.autor = ?')
    params.push(autor)
  }

  const join = tag ? 'JOIN memory_item_tags mit ON mit.item_id = mo.item_id JOIN memory_tags mt ON mt.id = mit.tag_id' : ''
  if (tag) {
    condiciones.push('mt.nombre = ?')
    params.push(tag)
  }

  const q = await db
    .prepare(
      `SELECT mo.id, mo.item_id, mi.nombre as item_nombre, mo.capa, mo.texto, mo.origen, mo.confianza, mo.autor, mo.fecha
       FROM memory_observations mo
       JOIN memory_items mi ON mi.id = mo.item_id
       ${join}
       WHERE ${condiciones.join(' AND ')}
       ORDER BY mo.fecha DESC`
    )
    .bind(...params)
    .all()

  return c.json(q.results)
})

// GET /memoria/esquema — [MCP-A13] valores validos de cada campo, leidos
// del mismo sitio que los define el esquema Zod: ningun agente (ni MCP ni
// REST) tiene que memorizarlos ni adivinarlos.
app.get('/esquema', (c) =>
  c.json({
    capas: CAPAS,
    origenes: ORIGENES,
    confianzas: CONFIANZAS,
    autores: AUTORES,
    estados: ESTADOS_MEMORIA,
    etiquetas: ETIQUETAS_VALIDAS,
  })
)

// GET /memoria/buscar?q=<termino> — FTS5 (bm25)
app.get('/buscar', async (c) => {
  const db = c.env.DB
  const termino = c.req.query('q')
  if (!termino) return c.json({ error: 'falta el parametro ?q=' }, 400)

  const consulta = sanitizarFts5(termino)
  if (!consulta) return c.json([])

  const q = await db
    .prepare(
      `SELECT mo.id, mo.item_id, mi.nombre as item_nombre, mo.capa, mo.texto, mo.origen, mo.confianza, mo.autor, mo.fecha, bm25(memory_fts) as score
       FROM memory_fts
       JOIN memory_observations mo ON mo.rowid = memory_fts.rowid
       JOIN memory_items mi ON mi.id = mo.item_id
       WHERE memory_fts MATCH ?1 AND mo.estado = 'activo'
       ORDER BY bm25(memory_fts)
       LIMIT 20`
    )
    .bind(consulta)
    .all()

  return c.json(q.results)
})

// POST /memoria
app.post('/', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = MemoriaIngestaCanonicaSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data
  const fecha = ahora()
  const nombreItem = b.nombre || slugDesdeTexto(b.texto)

  const existente: { id: string } | null = await db
    .prepare("SELECT id FROM memory_items WHERE nombre = ? AND estado = 'activo'")
    .bind(nombreItem)
    .first()

  const itemId = existente?.id || id('mi')
  if (!existente) {
    await db
      .prepare("INSERT INTO memory_items (id, nombre, estado, creado, actualizado, autor) VALUES (?,?,'activo',?,?,?)")
      .bind(itemId, nombreItem, fecha, fecha, b.autor)
      .run()
  }

  const observationId = id('mo')

  await db.batch([
    db
      .prepare(
        "INSERT INTO memory_observations (id, item_id, capa, texto, origen, confianza, estado, autor, revisar, fecha) VALUES (?,?,?,?,?,?,'activo',?,?,?)"
      )
      .bind(observationId, itemId, b.capa, b.texto, b.origen, b.confianza, b.autor, b.revisar || null, fecha),
    ...b.etiquetas.map((tag) =>
      db
        .prepare('INSERT OR IGNORE INTO memory_item_tags (item_id, tag_id) SELECT ?, id FROM memory_tags WHERE nombre = ?')
        .bind(itemId, tag)
    ),
  ])

  return c.json({ id: observationId, item_id: itemId })
})

// POST /memoria/corregir
app.post('/corregir', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = MemoriaCorregirSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data

  const anterior: { item_id: string } | null = await db
    .prepare('SELECT item_id FROM memory_observations WHERE id = ?')
    .bind(b.id)
    .first()
  if (!anterior) return c.json({ error: `observacion '${b.id}' no encontrada` }, 404)

  const nuevoId = id('mo')
  const fecha = ahora()

  await db.batch([
    // El INSERT va primero: sustituido_por (abajo) referencia nuevoId por FK,
    // asi que la fila debe existir antes del UPDATE que la referencia.
    db
      .prepare(
        "INSERT INTO memory_observations (id, item_id, capa, texto, origen, confianza, estado, autor, corrige_a, revisar, fecha) VALUES (?,?,?,?,?,?,'activo',?,?,?,?)"
      )
      .bind(nuevoId, anterior.item_id, b.capa, b.texto, b.origen, b.confianza, b.autor, b.id, b.revisar || null, fecha),
    db.prepare("UPDATE memory_observations SET estado='archivado', sustituido_por=? WHERE id=?").bind(nuevoId, b.id),
  ])

  return c.json({ id: nuevoId })
})

// POST /memoria/olvidar
app.post('/olvidar', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = MemoriaOlvidarSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data
  const fecha = ahora()

  await db
    .prepare("UPDATE memory_observations SET estado='archivado', motivo_archivo=?, archivado_por=?, archivado_en=? WHERE id=?")
    .bind(b.motivo || null, b.autor, fecha, b.id)
    .run()

  return c.json({ ok: true })
})

// POST /memoria/curacion/ejecutar — curacion nocturna bajo demanda o por Cron.
app.post('/curacion/ejecutar', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const autor: string | undefined = body?.autor
  if (autor !== undefined && !['antigravity', 'claude', 'jarvis'].includes(autor)) {
    return c.json({ error: "autor invalido: debe ser 'antigravity', 'claude' o 'jarvis'" }, 400)
  }

  const resultado = await ejecutarCuracionNocturna(c.env.DB, autor as TitularCuracion | undefined)
  return c.json(resultado, resultado.ok ? 200 : 409)
})

export default app
