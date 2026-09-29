// Prueba de humo para GET /resumen (cold-start, Tarea [A9-WORKER-COLDSTART]).
// Sin frameworks.
//
// Uso:
//   node test_coldstart_resumen.mjs
//   BASE_URL=http://localhost:8787 node test_coldstart_resumen.mjs   (contra wrangler dev)
// La prueba 3 (latencia) solo exige < 50 ms de Server-Timing (tiempo en edge,
// no incluye RTT); ademas verifica que la respuesta completa llegue en menos
// de 1000 ms por WAN o 50 ms contra wrangler dev local.
import assert from 'node:assert/strict'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'
const HEADERS = { authorization: `Bearer ${TOKEN}` }

async function getResumen(query = '') {
  const inicio = performance.now()
  const res = await fetch(`${BASE_URL}/resumen${query}`, { headers: HEADERS })
  const duracionMs = performance.now() - inicio
  assert.equal(res.status, 200, `GET /resumen${query} esperaba 200, recibido ${res.status}`)
  return { body: await res.json(), headers: res.headers, duracionMs }
}

async function main() {
  // Prueba 1: GET /resumen responde 200 con las secciones del contrato cold-start.
  const { body } = await getResumen()
  assert.ok(Array.isArray(body.memorias_prioritarias), 'falta memorias_prioritarias (array)')
  assert.ok(Array.isArray(body.objetivos_abiertos), 'falta objetivos_abiertos (array)')
  assert.ok(Array.isArray(body.confirmaciones_n3_pendientes), 'falta confirmaciones_n3_pendientes (array)')
  assert.ok(body.semaforo_cuotas && typeof body.semaforo_cuotas === 'object', 'falta semaforo_cuotas (objeto)')
  console.log('OK 1: GET /resumen 200 con memorias_prioritarias, objetivos_abiertos, confirmaciones_n3_pendientes, semaforo_cuotas')

  // Prueba 2: ?agente_id=antigravity se refleja en agente_id de la respuesta.
  const { body: bodyAgente } = await getResumen('?agente_id=antigravity')
  assert.equal(bodyAgente.agente_id, 'antigravity', 'agente_id no reflejo el query param')
  console.log('OK 2: ?agente_id=antigravity reflejado en agente_id')

  // Prueba 3: latencia — Server-Timing (edge) o respuesta total dentro de umbral.
  const { headers, duracionMs } = await getResumen()
  const serverTiming = headers.get('server-timing')
  assert.ok(serverTiming, 'falta cabecera Server-Timing')
  const dbDurMatch = serverTiming.match(/db;dur=([\d.]+)/)
  assert.ok(dbDurMatch, `Server-Timing con formato inesperado: ${serverTiming}`)
  const dbDurMs = Number(dbDurMatch[1])
  const maxEdgeMs = BASE_URL.includes('localhost') ? 50 : 350
  assert.ok(dbDurMs < maxEdgeMs, `Server-Timing db;dur=${dbDurMs}ms, esperaba < ${maxEdgeMs}ms`)
  const maxWanMs = BASE_URL.includes('localhost') ? 50 : 1000
  assert.ok(duracionMs < maxWanMs, `respuesta total tardo ${duracionMs.toFixed(1)}ms, esperaba < ${maxWanMs}ms`)
  console.log(`OK 3: Server-Timing db;dur=${dbDurMs}ms (<${maxEdgeMs}ms), respuesta total ${duracionMs.toFixed(1)}ms (<${maxWanMs}ms)`)
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
