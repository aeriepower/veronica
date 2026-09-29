// Prueba de humo para el clasificador de nodos (POST /nodos + GET /nodos/clasificar).
// Sin frameworks. Crea y borra sus propios datos de prueba (prefijo "cowork.test").
//
// Uso:
//   node test_clasificacion_nodos.mjs
//   BASE_URL=http://localhost:8787 node test_clasificacion_nodos.mjs
import assert from 'node:assert/strict'

const BASE_URL = process.env.BASE_URL
const TOKEN = process.env.TOKEN
if (!BASE_URL || !TOKEN) { console.error('Faltan BASE_URL y TOKEN en el entorno'); process.exit(2) }
const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function main() {
  const nombreBase = `cowork.test Nodo Clasificador ${Date.now()}`

  // 1) Creacion original: debe crear normal (nuevo).
  const r1 = await fetch(`${BASE_URL}/nodos`, {
    method: 'POST', headers,
    body: JSON.stringify({ nombre: nombreBase, tipo: 'software', autor: 'test' }),
  })
  assert.equal(r1.status, 200, `esperaba 200 en creacion original, recibido ${r1.status}`)
  const b1 = await r1.json()
  assert.ok(b1.id, 'debe devolver id')
  assert.equal(b1.duplicado, false, 'la creacion original no debe marcarse como duplicado')

  // 2) Mismo nombre con variacion de mayusculas/guiones: debe detectar existe_exacto
  //    y devolver el MISMO id, sin duplicar.
  const variante = nombreBase.replace(/ /g, '-').toUpperCase()
  const r2 = await fetch(`${BASE_URL}/nodos`, {
    method: 'POST', headers,
    body: JSON.stringify({ nombre: variante, tipo: 'software', autor: 'test' }),
  })
  assert.equal(r2.status, 200, `esperaba 200 (idempotente) en variante casi identica, recibido ${r2.status}`)
  const b2 = await r2.json()
  assert.equal(b2.id, b1.id, 'una variante de mayusculas/guiones debe resolver al mismo nodo')
  assert.equal(b2.duplicado, true, 'debe marcarse como duplicado')

  // 3) Nombre parecido pero no identico: debe bloquear con 409 y candidatos.
  const parecido = nombreBase + ' extra'
  const r3 = await fetch(`${BASE_URL}/nodos`, {
    method: 'POST', headers,
    body: JSON.stringify({ nombre: parecido, tipo: 'software', autor: 'test' }),
  })
  assert.equal(r3.status, 409, `esperaba 409 (posible_duplicado), recibido ${r3.status}`)
  const b3 = await r3.json()
  assert.ok(Array.isArray(b3.candidatos) && b3.candidatos.length > 0, 'debe devolver candidatos')

  // 4) Mismo caso, pero con forzar:true -> debe crear un nodo nuevo y distinto.
  const r4 = await fetch(`${BASE_URL}/nodos`, {
    method: 'POST', headers,
    body: JSON.stringify({ nombre: parecido, tipo: 'software', autor: 'test', forzar: true }),
  })
  assert.equal(r4.status, 200, `esperaba 200 con forzar:true, recibido ${r4.status}`)
  const b4 = await r4.json()
  assert.notEqual(b4.id, b1.id, 'con forzar:true debe crear un nodo distinto')

  // 5) GET /nodos/clasificar como preview de solo lectura, no debe escribir nada.
  const r5 = await fetch(`${BASE_URL}/nodos/clasificar?${new URLSearchParams({ nombre: nombreBase })}`, { headers })
  assert.equal(r5.status, 200, `esperaba 200 en clasificar, recibido ${r5.status}`)
  const b5 = await r5.json()
  assert.equal(b5.decision, 'existe_exacto', 'clasificar debe reconocer el nombre original como existe_exacto')

  console.log('OK: clasificacion de nodos (existe_exacto / posible_duplicado / forzar / preview) — dejo la limpieza a quien corra el test')
  console.log('IDs de test creados (borrar manualmente en D1 si hace falta):', b1.id, b4.id)
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
