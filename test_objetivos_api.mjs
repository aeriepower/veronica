// Prueba de humo para /objetivos (Tarea [A5-WORKER-OBJETIVOS]).
// Sin frameworks.
//
// Uso:
//   node test_objetivos_api.mjs
//   BASE_URL=http://localhost:8787 node test_objetivos_api.mjs   (contra wrangler dev)
import assert from 'node:assert/strict'
import crypto from 'node:crypto'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function main() {
  // Prueba 1: idempotencia — misma Idempotency-Key dos veces -> mismo id, sin duplicar fila
  const claveIdempotencia = `test-a5-idem-${crypto.randomUUID()}`
  const payloadCreacion = {
    titulo: `Objetivo de prueba A5 ${Date.now()}`,
    asignado_a: 'claude',
    creado_por: 'antigravity',
  }

  const res1a = await fetch(`${BASE_URL}/objetivos`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': claveIdempotencia },
    body: JSON.stringify(payloadCreacion),
  })
  assert.equal(res1a.status, 200, `esperaba 200 en primer POST, recibido ${res1a.status}`)
  const body1a = await res1a.json()
  assert.ok(body1a.id, 'debe devolver id en la primera creacion')

  const res1b = await fetch(`${BASE_URL}/objetivos`, {
    method: 'POST',
    headers: { ...headers, 'idempotency-key': claveIdempotencia },
    body: JSON.stringify(payloadCreacion),
  })
  assert.equal(res1b.status, 200, `esperaba 200 en replay idempotente, recibido ${res1b.status}`)
  assert.equal(res1b.headers.get('x-idempotent-replay'), 'true', 'debe marcar el replay con X-Idempotent-Replay: true')
  const body1b = await res1b.json()
  assert.equal(body1b.id, body1a.id, 'el replay idempotente debe devolver el mismo id, no duplicar la fila')
  console.log(`OK: idempotencia en POST /objetivos (id=${body1a.id}, sin duplicado)`)

  const objetivoId = body1a.id

  // Prueba 2: transicion de estados pendiente -> en_progreso -> completado con resultado_json
  const res2a = await fetch(`${BASE_URL}/objetivos/${objetivoId}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'en_progreso', quien: 'claude' }),
  })
  assert.equal(res2a.status, 200, `esperaba 200 en transicion a en_progreso, recibido ${res2a.status}`)
  const body2a = await res2a.json()
  assert.equal(body2a.estado_anterior, 'pendiente')
  assert.equal(body2a.estado_nuevo, 'en_progreso')

  const resultado = { resumen: 'prueba automatizada A5 completada', ok: true }
  const res2b = await fetch(`${BASE_URL}/objetivos/${objetivoId}/estado`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ estado: 'completado', quien: 'claude', resultado_json: resultado, artefactos: ['test_objetivos_api.mjs'] }),
  })
  assert.equal(res2b.status, 200, `esperaba 200 en transicion a completado, recibido ${res2b.status}`)
  const body2b = await res2b.json()
  assert.equal(body2b.estado_anterior, 'en_progreso')
  assert.equal(body2b.estado_nuevo, 'completado')

  const res2c = await fetch(`${BASE_URL}/objetivos/${objetivoId}`, { headers })
  assert.equal(res2c.status, 200)
  const body2c = await res2c.json()
  assert.equal(body2c.estado, 'completado')
  assert.deepEqual(body2c.resultado_json, resultado, 'resultado_json debe persistirse y devolverse ya parseado')
  assert.equal(body2c.historial.length, 3, 'el historial debe acumular pendiente -> en_progreso -> completado')
  console.log('OK: transicion de estados pendiente -> en_progreso -> completado con resultado_json')

  // Prueba 3: GET /objetivos filtrando por asignado_a encuentra el objetivo recien creado
  const res3 = await fetch(`${BASE_URL}/objetivos?asignado_a=claude`, { headers })
  assert.equal(res3.status, 200, `esperaba 200 en filtro por asignado_a, recibido ${res3.status}`)
  const resultados3 = await res3.json()
  assert.ok(Array.isArray(resultados3), 'el filtro debe devolver un array')
  const encontrado = resultados3.find((o) => o.id === objetivoId)
  assert.ok(encontrado, `debe encontrar el objetivo ${objetivoId} al filtrar por asignado_a=claude`)
  console.log('OK: GET /objetivos?asignado_a=claude devuelve el objetivo recien creado')
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
