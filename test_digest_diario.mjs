// Prueba de humo para el digest diario (Tarea [D3-SILENCIO-DIGESTS-DIARIOS]).
// Sin frameworks.
//
// Uso:
//   node test_digest_diario.mjs
//   BASE_URL=http://localhost:8787 node test_digest_diario.mjs   (contra wrangler dev)
import assert from 'node:assert/strict'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

// Factores tunados para caer en el canal 'digest_diario' (0.35 <= I < 0.55),
// igual que el escenario 8 de test_silencio_motor.mjs.
const FACTORES_DIGEST = { R: 0.35, U: 0.3, Conf: 0.9, C: 0.4, S: 0.5, D: 0, Ign: 0 }

async function registrarEvento(marcador, indice) {
  const res = await fetch(`${BASE_URL}/silencio/eventos`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      titulo: `evento-${marcador}-${indice}`,
      resumen: `resumen simulado ${indice} de la prueba D3`,
      factores: FACTORES_DIGEST,
    }),
  })
  assert.equal(res.status, 200, `esperaba 200 al registrar evento ${indice}, recibido ${res.status}`)
  const body = await res.json()
  assert.equal(body.canal, 'digest_diario', `el evento ${indice} debe caer en canal digest_diario, cayo en '${body.canal}'`)
  return body.id
}

async function main() {
  const marcador = `pruebaD3${Date.now()}`

  // 1. Insertar 3 eventos simulados con canal='digest_diario' y estado='pendiente'.
  const ids = []
  for (let i = 1; i <= 3; i++) ids.push(await registrarEvento(marcador, i))
  console.log(`OK: 3 eventos registrados en digest_diario (${ids.join(', ')})`)

  // 2 y 3. Invocar generarDigest via POST /silencio/digest/generar y comprobar
  // el formato Chief of Staff esperado.
  const resDigest = await fetch(`${BASE_URL}/silencio/digest/generar`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ momento: 'matutino' }),
  })
  assert.equal(resDigest.status, 200, `esperaba 200 al generar el digest, recibido ${resDigest.status}`)
  const digest = await resDigest.json()

  assert.equal(digest.ok, true, 'la respuesta debe traer ok=true')
  assert.equal(digest.momento, 'matutino', 'debe respetar el momento solicitado')
  assert.ok(digest.totalEventos >= 3, `totalEventos (${digest.totalEventos}) debe incluir al menos los 3 eventos insertados`)
  assert.ok(digest.briefing.includes('◈ J.A.R.V.I.S. · BRIEFING DE APERTURA (08:30)'), 'debe traer el encabezado de apertura')
  assert.ok(digest.briefing.includes('eventos secundarios retenidos'), 'debe traer la linea de metricas')
  for (let i = 1; i <= 3; i++) {
    assert.ok(digest.briefing.includes(`evento-${marcador}-${i}`), `el briefing debe listar el evento ${i}`)
  }
  for (const eid of ids) {
    assert.ok(digest.despachados.includes(eid), `el evento ${eid} debe quedar entre los despachados`)
  }
  console.log('OK: generarDigest compila los 3 eventos en el formato Chief of Staff esperado')

  // 4. Comprobar que los 3 eventos quedan marcados como 'despachado'.
  const resPendiente = await fetch(`${BASE_URL}/silencio/digest-pendiente`, { headers })
  assert.equal(resPendiente.status, 200, `esperaba 200 al listar pendientes, recibido ${resPendiente.status}`)
  const pendientes = await resPendiente.json()
  for (const eid of ids) {
    assert.ok(!pendientes.some((e) => e.id === eid), `el evento ${eid} no debe seguir pendiente tras el digest`)
  }
  console.log('OK: los 3 eventos quedan despachados (fuera de digest-pendiente)')

  // GET /silencio/digest/ultimo debe reflejar el briefing recien generado.
  const resUltimo = await fetch(`${BASE_URL}/silencio/digest/ultimo`, { headers })
  assert.equal(resUltimo.status, 200, `esperaba 200 en digest/ultimo, recibido ${resUltimo.status}`)
  const ultimo = await resUltimo.json()
  assert.ok(ultimo.texto.includes(marcador), 'digest/ultimo debe devolver el briefing recien generado')
  console.log('OK: GET /silencio/digest/ultimo devuelve el briefing recien generado')

  // 5. Segunda invocacion (sin eventos pendientes) produce el mensaje nominal.
  const resNominal = await fetch(`${BASE_URL}/silencio/digest/generar`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ momento: 'matutino' }),
  })
  assert.equal(resNominal.status, 200, `esperaba 200 en la segunda invocacion, recibido ${resNominal.status}`)
  const nominal = await resNominal.json()
  assert.equal(nominal.totalEventos, 0, 'la segunda invocacion no debe encontrar eventos pendientes')
  assert.equal(
    nominal.briefing,
    '◈ BRIEFING MATUTINO: Sin incidencias retenidas. Todos los sistemas operando en rango nominal.',
    'sin eventos pendientes debe devolver el mensaje sobrio de orden nominal'
  )
  console.log('OK: segunda invocacion sin eventos pendientes produce el mensaje de orden nominal')
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
