// Prueba de humo para /memoria (Tarea [A4-WORKER-MEMORIA-API]).
// Sin frameworks.
//
// Uso:
//   node test_memoria_api.mjs
//   BASE_URL=http://localhost:8787 node test_memoria_api.mjs   (contra wrangler dev)
import assert from 'node:assert/strict'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function main() {
  // Prueba 1: payload invalido (falta autor, capa erronea) -> 400
  const res1 = await fetch(`${BASE_URL}/memoria`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ capa: 'no-existe', texto: 'texto de prueba invalida', etiquetas: ['meta-sistema'] }),
  })
  assert.equal(res1.status, 400, `esperaba 400 en payload invalido, recibido ${res1.status}`)
  console.log('OK: payload invalido (falta autor, capa erronea) rechazado con 400')

  // Prueba 2: ingesta canonica valida
  const marcador = `pruebaA4memoria${Date.now()}`
  const texto = `Marcador de prueba automatizada de la tarea A4-WORKER-MEMORIA-API: ${marcador}`
  const res2 = await fetch(`${BASE_URL}/memoria`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: `test-a4-${Date.now()}`,
      capa: 'semantica',
      texto,
      autor: 'antigravity',
      etiquetas: ['meta-sistema'],
    }),
  })
  assert.equal(res2.status, 200, `esperaba 200 en ingesta valida, recibido ${res2.status}`)
  const body2 = await res2.json()
  assert.ok(body2.id, 'debe devolver id de la observacion')
  assert.ok(body2.item_id, 'debe devolver item_id')
  console.log(`OK: ingesta canonica creada (id=${body2.id}, item_id=${body2.item_id})`)

  // Prueba 3: busqueda lexica FTS5 recupera el recuerdo recien insertado
  const inicio = performance.now()
  const res3 = await fetch(`${BASE_URL}/memoria/buscar?q=${encodeURIComponent(marcador)}`, { headers })
  const latenciaMs = performance.now() - inicio
  assert.equal(res3.status, 200, `esperaba 200 en busqueda, recibido ${res3.status}`)
  const resultados = await res3.json()
  assert.ok(Array.isArray(resultados), 'la busqueda debe devolver un array')
  const encontrado = resultados.find((r) => r.id === body2.id)
  assert.ok(encontrado, `debe encontrar la observacion ${body2.id} recien insertada`)
  const maxLatencia = BASE_URL.includes('localhost') ? 35 : 1000
  assert.ok(latenciaMs < maxLatencia, `latencia de busqueda ${latenciaMs.toFixed(2)}ms supera el limite de ${maxLatencia}ms`)
  console.log(`OK: busqueda FTS5 recupera el recuerdo recien insertado (${latenciaMs.toFixed(2)}ms, max permitido: ${maxLatencia}ms)`)
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
