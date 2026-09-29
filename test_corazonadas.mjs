// Prueba de corazonadas tecnicas (Tarea [D4-SILENCIO-CORAZONADAS]).
// Sin frameworks, sin red: llama directamente a evaluarCorazonada (funcion
// pura), igual que hace /silencio/corazonada/evaluar antes de responder.
//
// Uso: node test_corazonadas.mjs
import assert from 'node:assert/strict'
import { evaluarCorazonada } from './src/services/corazonada.ts'

let n = 0
function caso(nombre, evento, verificar) {
  n++
  const r = evaluarCorazonada(evento)
  verificar(r)
  console.log(`OK [${n}] ${nombre} -> esCorazonada=${r.esCorazonada}`)
}

// 1. R=0.60, Conf=0.40 -> califica, certeza 40%, plantillas exactas.
caso(
  'R=0.60 Conf=0.40 califica con plantillas exactas',
  { titulo: 'Latencia creciente en D1', detalle: 'El p95 subio un 30% en la ultima hora', R: 0.6, Conf: 0.4 },
  (r) => {
    assert.equal(r.esCorazonada, true)
    assert.equal(r.certeza, 40)
    assert.equal(
      r.plantillaVerbal,
      'Tengo una corazonada técnica con baja certeza (40%): Latencia creciente en D1. El p95 subio un 30% en la ultima hora; mantengo la monitorización activa.'
    )
    assert.deepEqual(r.plantillaVisual, {
      badge: '◈ CORAZONADA TÉCNICA (40%)',
      sintoma: 'Latencia creciente en D1',
      impacto: 'Riesgo técnico estimado: 60% | Certeza: 40%',
      accion: 'Monitorización activa en segundo plano',
    })
  }
)

// 2. R=0.80, Conf=0.20 -> califica, certeza 20%.
caso('R=0.80 Conf=0.20 califica con certeza 20%', { titulo: 'Posible fuga de memoria', detalle: 'Patron irregular en logs', R: 0.8, Conf: 0.2 }, (r) => {
  assert.equal(r.esCorazonada, true)
  assert.equal(r.certeza, 20)
})

// 3. R=0.20, Conf=0.40 -> NO califica (riesgo bajo, prohibido alarmismo).
caso('R=0.20 Conf=0.40 NO califica (riesgo bajo)', { titulo: 'Aviso menor', detalle: 'Sin impacto claro', R: 0.2, Conf: 0.4 }, (r) => {
  assert.equal(r.esCorazonada, false)
  assert.equal(r.motivo, 'Riesgo insuficiente o confianza suficiente')
})

// 4. R=0.90, Conf=0.90 -> NO es corazonada (hecho certero, canal critico directo).
caso('R=0.90 Conf=0.90 NO es corazonada (hecho certero)', { titulo: 'Caida confirmada', detalle: 'Error 500 reproducido', R: 0.9, Conf: 0.9 }, (r) => {
  assert.equal(r.esCorazonada, false)
})

// 5. La frase verbal siempre menciona certeza y monitorizacion activa, sin
// conjeturas infundadas (no afirma el hecho como cierto).
caso('frase verbal siempre menciona certeza y monitorizacion activa', { titulo: 'Sintoma X', detalle: 'Detalle Y', R: 0.55, Conf: 0.5 }, (r) => {
  assert.equal(r.esCorazonada, true)
  assert.match(r.plantillaVerbal, /corazonada técnica con baja certeza \(\d+%\)/)
  assert.match(r.plantillaVerbal, /mantengo la monitorización activa\.$/)
})

console.log(`\n${n} escenarios OK`)
