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

const SERVER_NAME = 'veronica'
const SERVER_VERSION = '1.0.0'
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

async function callApp(app: { request: (input: string, init?: RequestInit, env?: Env) => Response | Promise<Response> }, path: string, init: RequestInit | undefined, env: Env) {
  const res = await app.request(path, init, env)
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
const HANDLERS: Record<string, (args: any, env: Env) => Promise<{ status: number; body: unknown }>> = {
  memoria_listar: (a, env) => callApp(memoria, qs({ capa: a.capa, estado: a.estado, autor: a.autor, tag: a.tag }), {}, env),
  memoria_buscar: (a, env) => callApp(memoria, `/buscar${qs({ q: a.consulta })}`, {}, env),
  memoria_esquema: (_a, env) => callApp(memoria, '/esquema', {}, env),
  memoria_recordar: (a, env) =>
    callApp(memoria, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  memoria_corregir: (a, env) =>
    callApp(memoria, '/corregir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  memoria_olvidar: (a, env) =>
    callApp(memoria, '/olvidar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  memoria_curar: (a, env) =>
    callApp(memoria, '/curacion/ejecutar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a || {}) }, env),

  lista_anadir: (a, env) =>
    callApp(listas, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  lista_listar: (a, env) => callApp(listas, `/${encodeURIComponent(a.lista)}`, {}, env),

  nodo_crear: (a, env) =>
    callApp(nodos, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  nodo_listar: (a, env) => callApp(nodos, qs({ tipo: a.tipo }), {}, env),
  nodo_clasificar: (a, env) =>
    callApp(nodos, '/clasificar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  nodo_lote: (a, env) =>
    callApp(nodos, '/lote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),

  relacion_crear: (a, env) =>
    callApp(relaciones, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  relacion_listar: (a, env) => callApp(relaciones, qs({ nodo: a.nodo, tipo: a.tipo }), {}, env),
  analizar_impacto: (a, env) => callApp(relaciones, `/impacto${qs({ nodo: a.nodo })}`, {}, env),

  objetivo_crear: (a, env) =>
    callApp(objetivos, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  objetivo_listar: (a, env) =>
    a.id ? callApp(objetivos, `/${encodeURIComponent(a.id)}`, {}, env) : callApp(objetivos, qs({ estado: a.estado, asignado_a: a.asignado_a }), {}, env),
  objetivo_actualizar_estado: (a, env) =>
    callApp(
      objetivos,
      `/${encodeURIComponent(a.id)}/estado`,
      { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ estado: a.estado, quien: a.quien, resultado_json: a.resultado_json, artefactos: a.artefactos }) },
      env
    ),

  confirmacion_crear: (a, env) =>
    callApp(confirmaciones, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  confirmacion_listar: (_a, env) => callApp(confirmaciones, '/pendientes', {}, env),
  confirmacion_resolver: (a, env) =>
    callApp(
      confirmaciones,
      `/${encodeURIComponent(a.id)}/resolver`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision: a.decision, quien: a.quien, motivo: a.motivo }) },
      env
    ),

  lease_adquirir: (a, env) =>
    callApp(leases, '/adquirir', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  lease_liberar: (a, env) =>
    callApp(leases, '/liberar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  lease_listar: (_a, env) => callApp(leases, '/', {}, env),

  registro_escribir: (a, env) =>
    callApp(registro, '/', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(a) }, env),
  registro_consultar: (a, env) => callApp(registro, qs({ n: a.n }), {}, env),

  resumen_cargar: (a, env) => callApp(resumen, qs({ agente_id: a.agente_id }), {}, env),
}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result }
}

function err(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } }
}

async function handleRpc(req: JsonRpcRequest, env: Env): Promise<JsonRpcResponse | null> {
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
      const { status, body } = await handler(args, env)
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

  const respuestas = (await Promise.all(requests.map((r) => handleRpc(r, c.env)))).filter((r): r is JsonRpcResponse => r !== null)

  if (respuestas.length === 0) {
    // Solo notificaciones: sin contenido que devolver (202 Accepted).
    return c.body(null, 202)
  }

  return c.json(isBatch ? respuestas : respuestas[0])
})

export default app
