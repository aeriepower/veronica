// Prueba de humo para /leases (Tarea [A8-D1-LEASES]). Sin frameworks.
//
// Uso:
//   node test_leases_api.mjs
//   BASE_URL=http://localhost:8787 node test_leases_api.mjs   (contra wrangler dev)
import assert from 'node:assert/strict'
import { setTimeout as esperar } from 'node:timers/promises'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function main() {
  // Prueba 1: adquisicion exitosa de un recurso libre.
  const recurso = `test_singleton_${Date.now()}`
  const res1 = await fetch(`${BASE_URL}/leases/adquirir`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recurso, titular: 'claude', motivo: 'prueba A8' }),
  })
  assert.equal(res1.status, 200, `esperaba 200 al adquirir, recibido ${res1.status}`)
  const body1 = await res1.json()
  assert.equal(body1.acquired, true)
  assert.ok(body1.lease_id, 'debe devolver lease_id')
  console.log(`OK: 'claude' adquiere el lease de ${recurso}`)

  // Prueba 2: otro titular intenta adquirir el mismo recurso -> 409 Conflict.
  const res2 = await fetch(`${BASE_URL}/leases/adquirir`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recurso, titular: 'jarvis' }),
  })
  assert.equal(res2.status, 409, `esperaba 409 al chocar, recibido ${res2.status}`)
  const body2 = await res2.json()
  assert.equal(body2.acquired, false)
  assert.equal(body2.titular_actual, 'claude', 'debe informar quien tiene el lease')
  console.log(`OK: 'jarvis' no puede adquirir ${recurso} mientras 'claude' lo tiene`)

  // Prueba 3: liberar el recurso -> el segundo titular ya puede adquirirlo.
  const res3a = await fetch(`${BASE_URL}/leases/liberar`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recurso, titular: 'claude' }),
  })
  assert.equal(res3a.status, 200, `esperaba 200 al liberar, recibido ${res3a.status}`)
  const body3a = await res3a.json()
  assert.equal(body3a.released, true)

  const res3b = await fetch(`${BASE_URL}/leases/adquirir`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recurso, titular: 'jarvis' }),
  })
  assert.equal(res3b.status, 200, `esperaba 200 tras liberar, recibido ${res3b.status}`)
  const body3b = await res3b.json()
  assert.equal(body3b.acquired, true)
  console.log(`OK: tras liberar, 'jarvis' adquiere ${recurso}`)

  // Prueba 4: expiracion por TTL. Adquirir con ttl_segundos:2, esperar 3s, y
  // verificar que un competidor puede adquirirlo automaticamente al vencer.
  const recursoTtl = `test_ttl_${Date.now()}`
  const res4a = await fetch(`${BASE_URL}/leases/adquirir`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recurso: recursoTtl, titular: 'claude', ttl_segundos: 2 }),
  })
  assert.equal(res4a.status, 200)
  const body4a = await res4a.json()
  assert.equal(body4a.acquired, true)

  await esperar(3000)

  const res4b = await fetch(`${BASE_URL}/leases/adquirir`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ recurso: recursoTtl, titular: 'jarvis' }),
  })
  assert.equal(res4b.status, 200, `esperaba 200 tras expirar por TTL, recibido ${res4b.status}`)
  const body4b = await res4b.json()
  assert.equal(body4b.acquired, true, 'debe poder adquirir tras vencer el TTL del lease anterior')
  console.log(`OK: ${recursoTtl} expira por TTL y 'jarvis' lo adquiere automaticamente`)
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
