// Prueba de humo para /confirmaciones (Tarea [A6-WORKER-CONFIRMACIONES]).
// Requiere migration_a6_confirmaciones.sql ya aplicada. Sin frameworks.
//
// Uso:
//   node test_confirmaciones_api.mjs
//   BASE_URL=http://localhost:8787 node test_confirmaciones_api.mjs   (contra wrangler dev)
import assert from 'node:assert/strict'
import { setTimeout as esperar } from 'node:timers/promises'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function main() {
  // Prueba 1: timeout corto (2s) -> pasado ese tiempo, GET /confirmaciones/:id la marca expirada
  const res1a = await fetch(`${BASE_URL}/confirmaciones`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      herramienta: 'test.expira',
      resumen: `Prueba A6 expiracion ${Date.now()}`,
      nivel: 'N3',
      timeout: 2,
    }),
  })
  assert.equal(res1a.status, 200, `esperaba 200 al crear, recibido ${res1a.status}`)
  const body1a = await res1a.json()
  assert.ok(body1a.id, 'debe devolver id')
  assert.ok(body1a.timeout > Math.floor(Date.now() / 1000), 'timeout devuelto debe ser un unix futuro')

  await esperar(3000)

  const res1b = await fetch(`${BASE_URL}/confirmaciones/${body1a.id}`, { headers })
  assert.equal(res1b.status, 200)
  const body1b = await res1b.json()
  assert.equal(body1b.estado, 'expirada', 'debe expirar tras pasar el timeout')
  console.log(`OK: confirmacion ${body1a.id} expira automaticamente al pasar el timeout`)

  // Prueba 2: crear estandar, resolver con 'aprobar', verificar estado y resuelto_por
  const res2a = await fetch(`${BASE_URL}/confirmaciones`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      herramienta: 'test.aprobar',
      resumen: `Prueba A6 aprobacion ${Date.now()}`,
      nivel: 'N3',
      contexto: 'contexto de prueba',
      impacto: 'impacto de prueba',
    }),
  })
  assert.equal(res2a.status, 200)
  const body2a = await res2a.json()
  const confirmacionId = body2a.id

  const res2b = await fetch(`${BASE_URL}/confirmaciones/${confirmacionId}/resolver`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ decision: 'aprobar' }),
  })
  assert.equal(res2b.status, 200, `esperaba 200 al resolver, recibido ${res2b.status}`)
  const body2b = await res2b.json()
  assert.equal(body2b.estado, 'aprobada')

  const res2c = await fetch(`${BASE_URL}/confirmaciones/${confirmacionId}`, { headers })
  const body2c = await res2c.json()
  assert.equal(body2c.estado, 'aprobada')
  assert.equal(body2c.resuelto_por, 'david', 'quien debe usar el default "david"')
  assert.ok(body2c.resuelto_en, 'debe registrar resuelto_en')
  console.log(`OK: confirmacion ${confirmacionId} se aprueba y registra resuelto_por/resuelto_en`)

  // Prueba 3: GET /confirmaciones/pendientes solo devuelve las no resueltas ni expiradas
  const res3a = await fetch(`${BASE_URL}/confirmaciones`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      herramienta: 'test.pendiente',
      resumen: `Prueba A6 pendiente ${Date.now()}`,
      nivel: 'N3',
    }),
  })
  const body3a = await res3a.json()
  const pendienteId = body3a.id

  const res3b = await fetch(`${BASE_URL}/confirmaciones/pendientes`, { headers })
  assert.equal(res3b.status, 200)
  const pendientes = await res3b.json()
  assert.ok(Array.isArray(pendientes), 'debe devolver un array')

  const ids = pendientes.map((p) => p.id)
  assert.ok(ids.includes(pendienteId), 'debe incluir la confirmacion recien creada')
  assert.ok(!ids.includes(body1a.id), 'no debe incluir la confirmacion expirada')
  assert.ok(!ids.includes(confirmacionId), 'no debe incluir la confirmacion ya aprobada')
  console.log('OK: GET /confirmaciones/pendientes solo devuelve las no resueltas ni expiradas')
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
