// Prueba de clasificador v2 + nodo_lote. Sin frameworks.
//   TOKEN=... BASE_URL=http://localhost:8799 node test_lote_nodos.mjs
// Crea solo datos con lote_id "cowork-test-*" y los deshace al final (DELETE /nodos/lote/:id).
import assert from 'node:assert/strict'

const BASE_URL = process.env.BASE_URL
const TOKEN = process.env.TOKEN
if (!BASE_URL || !TOKEN) { console.error('Faltan BASE_URL y TOKEN en el entorno'); process.exit(2) }
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const post = async (p, b) => { const r = await fetch(BASE_URL + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() } }
const get = async (p) => (await fetch(BASE_URL + p, { headers: H })).json()

const loteId = `cowork-test-${Date.now()}`
const antes = (await get('/nodos')).length

// 1) clasificar: solo nombre -> nuevo + sugerido
const c1 = await post('/nodos/clasificar', { nombre: 'controladorApexAgenteIA' })
assert.equal(c1.s, 200)
assert.equal(c1.j.decision, 'nuevo')
console.log('sugerido:', JSON.stringify(c1.j.sugerido))
assert.equal(c1.j.sugerido.tipo.valor, 'componente_codigo')
assert.equal(c1.j.sugerido.tema.valor, 'agente-ia')
assert.equal(c1.j.sugerido.tecnologia.valor, 'apex')

// 2) identificador igual -> existe_exacto aunque el nombre no se parezca
const c2 = await post('/nodos/clasificar', { nombre: 'Veronica backup', identificador: 'github.com/aeriepower/veronica' })
console.log('identificador:', c2.j.decision)

// 3) lote en simulacion: no escribe
const items = [
  { nombre: 'controladorApexAgenteIA', descripcion: undefined },
  { nombre: 'ControladorApexAgenteIA' }, // duplicado dentro del lote
  { nombre: 'repo-veronica' },
  { nombre: 'Org Salesforce Candyla' },
  { nombre: 'zzzqqq' },
  { nombre: 'cowork.test.critico', tipo: 'software', tier: 'critical' },
  { nombre: 'cowork.test.worker.nuevo', tipo: 'software', alias: ['cwtw'], data: { endpoints: ['/a', '/b'] } },
]
const sim = await post('/nodos/lote', { lote_id: loteId, modo: 'simular', items })
assert.equal(sim.s, 200)
console.log('simular:', JSON.stringify(sim.j.resumen))
assert.equal((await get('/nodos')).length, antes, 'simular no debe escribir')
const porNombre = Object.fromEntries(sim.j.items.map((x) => [x.i, x]))
assert.equal(porNombre[0].resultado, 'creado')
assert.equal(porNombre[1].resultado, 'existente', 'duplicado intra-lote')
assert.equal(porNombre[2].resultado, 'existente')
assert.equal(porNombre[3].resultado, 'pendiente')
assert.equal(porNombre[4].resultado, 'incompleto')
assert.equal(porNombre[5].resultado, 'pendiente')
assert.equal(porNombre[6].resultado, 'creado')
assert.ok(sim.j.relaciones.some((r) => r.resultado === 'creada' && r.destino.includes('candyla-salesforce') || r.destino === 'Org Salesforce de Candyla'), 'relacion con padre sugerido')

// 4) aplicar
const ap = await post('/nodos/lote', { lote_id: loteId, modo: 'aplicar', autor: 'test', origen: 'test_lote_nodos.mjs', items })
assert.equal(ap.s, 200, JSON.stringify(ap.j))
assert.equal(ap.j.aplicado, true)
assert.equal((await get('/nodos')).length, antes + 2)
const nodos = await get('/nodos')
const nuevo = nodos.find((n) => n.nombre === 'controladorApexAgenteIA')
assert.equal(nuevo.tipo, 'componente_codigo')
assert.equal(nuevo.lote, loteId)
assert.equal(JSON.parse(nuevo.data).tema, 'agente-ia')
const rels = await get(`/relaciones?nodo=${nuevo.id}`)
assert.equal(rels.length, 1)
assert.equal(rels[0].tipo, 'se_ejecuta_en')

// 5) idempotencia
const ap2 = await post('/nodos/lote', { lote_id: loteId, modo: 'aplicar', items })
assert.equal(ap2.j.resumen.creados, 0)
assert.equal((await get('/nodos')).length, antes + 2)

// 6) rendimiento: 100 items nuevos
const pal = () => Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8)
const cien = Array.from({ length: 100 }, () => ({ nombre: `cowork.test.${pal()}`, tipo: 'software' }))
const t = Date.now()
const big = await post('/nodos/lote', { lote_id: loteId + '-100', modo: 'aplicar', items: cien })
console.log(`100 items: ${Date.now() - t} ms totales, servidor ${big.j.resumen.ms} ms, creados ${big.j.resumen.creados}`)
assert.ok(big.j.resumen.creados >= 90, 'casi todos nuevos: ' + big.j.resumen.creados)
// numeros distintos no son duplicado exacto
const num = await post('/nodos/clasificar', { nombre: 'worker 2', tipo: 'software' }); console.log('numeros:', num.j.decision)

// 7) deshacer
for (const id of [loteId, loteId + '-100']) {
  const d = await fetch(`${BASE_URL}/nodos/lote/${id}?confirmar=true`, { method: 'DELETE', headers: H })
  assert.equal(d.status, 200)
}
assert.equal((await get('/nodos')).length, antes, 'deshacer restaura el estado')
console.log('OK')
