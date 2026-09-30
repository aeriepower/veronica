// Servidor MCP (Model Context Protocol) de Veronica: capa fina sobre el
// mismo Worker Hono, Streamable HTTP en modo stateless (una peticion POST
// JSON-RPC 2.0 -> una respuesta JSON; sin sesion, sin SSE - valido para un
// servidor sin estado por peticion segun la especificacion). Cada tool
// llama al mismo sub-app Hono que ya atiende el endpoint REST equivalente
// via app.request(), nunca logica duplicada. Ver contrato-mcp-veronica.md.
import { Hono } from 'hono'
import type { Env } from '../types'
import { TOOLS } from './tools'
import memoria from '../routes/memoria'
import nodos from '../routes/nodos'
import relaciones from '../routes/relaciones'
import objetivos from '../routes/objetivos'
import confirmaciones from '../routes/confirmaciones'
import leases from '../routes/leases'
import registro from '../routes/registro'
import resumen from '../routes/resumen'
import listas from '../routes/listas'
import grafo from '../routes/grafo'

const SERVER_NAME = 'veronica'
const SERVER_VERSION = '1.1.0'
const PROTOCOL_VERSION = '2025-06-18'

type JsonRpcRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any }
type JsonRpcResponse = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string; data?: unknown } }

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    p.set(k, String(v))
  }
  const s = p.toString()
  return s ? `?${s}` : ''
}

async function callApp(app: { request: (input: string, init?: RequestInit, env?: any, ctx?: any) => Response | Promise<Response> }, path: string, init: RequestInit | undefined, env: Env, ctx?: ExecutionContext) {
  const res = await app.request(path, init, env, ctx)
  const status = res.status
  let body: unknown = null
  try {
    body = await res.json()
  } catch {
    body = await res.text().catch(() => null)
  }
  return { status, body }
}

// Cada handler recibe los argumentos ya validados solo por JSON Schema en el
// cliente (tools/list); el servidor sigue validando con el mismo Zod que ya
// usa el REST - nunca confia solo en lo que declaro el esquema MCP.
const HANDLERS: Record<string, (args: any, env: Env, ctx?: ExecutionContext) => Promise<{ status: number; body: unknown }>> = {
  memoria_listar: (a, env, ctx) => callApp(memoria, qs({ capa: a.capa, estado: a.estado, autor: a.autor, tag: a.tag }), {}, env, ctx),
  memoria_buscar: (a, env, ctx) => callApp(memoria, `/buscar${qs({ q: a.consulta })}`, {}, env, ctx),
  memoria_esquema: (_a, env, ctx) => callApp(memoria, '/esquema', {}, env, ctx),
  memoria_recordar: (a, env, ctx) =>
    callApp(memoria, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  memoria_corregir: (a, env, ctx) =>
    callApp(memoria, '/corregir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  memoria_olvidar: (a, env, ctx) =>
    callApp(memoria, '/olvidar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  memoria_curar: (a, env, ctx) =>
    callApp(memoria, '/curacion/ejecutar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a || {}) }, env, ctx),

  lista_anadir: (a, env, ctx) =>
    callApp(listas, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  lista_listar: (a, env, ctx) => callApp(listas, `/${encodeURIComponent(a.lista)}`, {}, env, ctx),

  nodo_crear: (a, env, ctx) =>
    callApp(nodos, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  nodo_listar: (a, env, ctx) => callApp(nodos, qs({ tipo: a.tipo }), {}, env, ctx),
  nodo_clasificar: (a, env, ctx) =>
    callApp(nodos, '/clasificar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  nodo_lote: (a, env, ctx) =>
    callApp(nodos, '/lote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),

  relacion_crear: (a, env, ctx) =>
    callApp(relaciones, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  relacion_listar: (a, env, ctx) => callApp(relaciones, qs({ nodo: a.nodo, tipo: a.tipo }), {}, env, ctx),
  analizar_impacto: (a, env, ctx) => callApp(relaciones, `/impacto${qs({ nodo: a.nodo })}`, {}, env, ctx),

  objetivo_crear: (a, env, ctx) =>
    callApp(objetivos, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  objetivo_listar: (a, env, ctx) =>
    a.id ? callApp(objetivos, `/${encodeURIComponent(a.id)}`, {}, env, ctx) : callApp(objetivos, qs({ estado: a.estado, asignado_a: a.asignado_a }), {}, env, ctx),
  objetivo_actualizar_estado: (a, env, ctx) =>
    callApp(
      objetivos,
      `/${encodeURIComponent(a.id)}/estado`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: a.estado, quien: a.quien, resultado_json: a.resultado_json, artefactos: a.artefactos }) },
      env, ctx
    ),

  confirmacion_crear: (a, env, ctx) =>
    callApp(confirmaciones, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  confirmacion_listar: (_a, env, ctx) => callApp(confirmaciones, '/pendientes', {}, env, ctx),
  confirmacion_resolver: (a, env, ctx) =>
    callApp(
      confirmaciones,
      `/${encodeURIComponent(a.id)}/resolver`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: a.decision, quien: a.quien, motivo: a.motivo }) },
      env, ctx
    ),

  lease_adquirir: (a, env, ctx) =>
    callApp(leases, '/adquirir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  lease_liberar: (a, env, ctx) =>
    callApp(leases, '/liberar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  lease_listar: (_a, env, ctx) => callApp(leases, '/', {}, env, ctx),

  registro_escribir: (a, env, ctx) =>
    callApp(registro, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  registro_consultar: (a, env, ctx) => callApp(registro, qs({ n: a.n }), {}, env, ctx),

  // [D1-MEMORIA-GRAFO] grafo vivo: planificacion, puente memoria<->nodos, propuestas
  planificar_cambio: (a, env, ctx) =>
    callApp(grafo, '/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  plan_cerrar: (a, env, ctx) =>
    callApp(grafo, `/plan/${encodeURIComponent(a.plan_id)}/cerrar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ tocados: a.tocados, autor: a.autor, notas: a.notas }) }, env, ctx),
  grafo_exportar: (a, env, ctx) => callApp(grafo, `/exportar${qs({ parte: a.parte, desde: a.desde, limite: a.limite, descripciones: a.descripciones ? 1 : '' })}`, {}, env, ctx),
  relacion_lote: (a, env, ctx) =>
    callApp(grafo, '/relaciones/lote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  memoria_por_nodo: (a, env, ctx) => callApp(grafo, `/memoria/${encodeURIComponent(a.nodo)}${qs({ vecinos: a.vecinos ? 1 : '', max: a.max })}`, {}, env, ctx),
  memoria_enlazar_lote: (a, env, ctx) =>
    callApp(grafo, '/memoria/enlazar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),
  propuesta_listar: (a, env, ctx) => callApp(grafo, `/propuestas${qs({ estado: a.estado, clase: a.clase, limite: a.limite })}`, {}, env, ctx),
  propuesta_resolver: (a, env, ctx) =>
    callApp(grafo, '/propuestas/resolver', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env, ctx),

  resumen_cargar: (a, env, ctx) => callApp(resumen, qs({ agente_id: a.agente_id }), {}, env, ctx),
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

async function handleRpc(req: JsonRpcRequest, env: Env, ctx?: ExecutionContext): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null

  if (req.method === 'initialize') {
    return ok(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
    })
  }

  // Notificacion (sin id): no lleva respuesta.
  if (req.method === 'notifications/initialized') {
    return null
  }

  if (req.method === 'tools/list') {
    return ok(id, { tools: TOOLS })
  }

  if (req.method === 'tools/call') {
    const name: string = req.params?.name
    const args = req.params?.arguments || {}
    const handler = HANDLERS[name]
    if (!handler) {
      return err(id, -32602, `tool desconocida: '${name}'`)
    }
    try {
      const { status, body } = await handler(args, env, ctx)
      const isError = status >= 400
      return ok(id, {
        content: [{ type: 'text', text: JSON.stringify(body) }],
        isError,
      })
    } catch (e: any) {
      return ok(id, { content: [{ type: 'text', text: JSON.stringify({ error: e?.message || String(e) }) }], isError: true })
    }
  }

  return err(id, -32601, `metodo no soportado: '${req.method}'`)
}

// ExecutionContext solo existe dentro de un fetch real (no en tests con app.request).
function safeCtx(c: any): ExecutionContext | undefined {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}

const app = new Hono<{ Bindings: Env }>()

// POST /mcp — Streamable HTTP, modo stateless (un JSON-RPC por peticion).
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (body === null) {
    return c.json(err(null, -32700, 'JSON malformado'), 400)
  }

  // Soporta tanto una peticion suelta como un batch (array) - la spec JSON-RPC 2.0 permite ambos.
  const isBatch = Array.isArray(body)
  const requests: JsonRpcRequest[] = isBatch ? body : [body]

  const respuestas = (await Promise.all(requests.map((r) => handleRpc(r, c.env, safeCtx(c))))).filter((r): r is JsonRpcResponse => r !== null)

  if (respuestas.length === 0) {
    // Solo notificaciones: sin contenido que devolver (202 Accepted).
    return c.body(null, 202)
  }

  return c.json(isBatch ? respuestas : respuestas[0])
})

export default app
