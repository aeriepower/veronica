// Prueba del motor de silencio inteligente (Tarea [D1-SILENCIO-MOTOR-INTERRUPCION]).
// Sin frameworks, sin red: llama directamente a calcularInterrupcion (funcion
// pura), igual que hace /silencio/evaluar antes de tocar D1.
//
// Uso: node test_silencio_motor.mjs
import assert from 'node:assert/strict'
import { calcularInterrupcion } from './src/services/silencio.ts'

let n = 0
function caso(nombre, factores, esperado) {
  n++
  const r = calcularInterrupcion(factores)
  if (esperado.canal) {
    assert.equal(r.canal, esperado.canal, `[${n}] ${nombre}: esperaba canal '${esperado.canal}', obtuvo '${r.canal}' (I=${r.score.toFixed(3)})`)
  }
  if (esperado.corazonada !== undefined) {
    assert.equal(r.corazonada, esperado.corazonada, `[${n}] ${nombre}: esperaba corazonada=${esperado.corazonada}, obtuvo ${r.corazonada}`)
  }
  if (esperado.scoreMin !== undefined) {
    assert.ok(r.score >= esperado.scoreMin - 1e-9, `[${n}] ${nombre}: score ${r.score} < minimo ${esperado.scoreMin}`)
  }
  if (esperado.scoreMax !== undefined) {
    assert.ok(r.score <= esperado.scoreMax + 1e-9, `[${n}] ${nombre}: score ${r.score} > maximo ${esperado.scoreMax}`)
  }
  console.log(`OK [${n}] ${nombre} -> I=${r.score.toFixed(3)} canal=${r.canal} corazonada=${r.corazonada}`)
  return r
}

// 1. Caida critica en produccion
caso('caida critica en produccion', { R: 1, U: 1, Conf: 1, C: 1, S: 0.8, D: 0, Ign: 0 }, { canal: 'critica_inmediata', scoreMin: 0.75 })

// 2. Modificacion de esquema sin backup
caso('modificacion de esquema sin backup', { R: 0.9, U: 0.8, Conf: 0.9, C: 1, S: 0.9, D: 0, Ign: 0 }, { canal: 'critica_inmediata', scoreMin: 0.75 })

// 3. Rotacion de secreto urgente (justo en el umbral 0.75)
caso('rotacion de secreto urgente', { R: 0.8, U: 0.9, Conf: 0.8, C: 1, S: 1, D: 0, Ign: 0 }, { canal: 'critica_inmediata', scoreMin: 0.75 })

// 4. Alerta de cuota Claude Pro al 92%
caso('alerta cuota Claude Pro 92%', { R: 0.85, U: 0.85, Conf: 0.9, C: 1, S: 1, D: 0, Ign: 0 }, { canal: 'critica_inmediata', scoreMin: 0.75 })

// 5. Error 500 recurrente en pasarela de pago
caso('error 500 recurrente en pasarela de pago', { R: 0.9, U: 0.9, Conf: 0.85, C: 0.9, S: 0.9, D: 0, Ign: 0 }, { canal: 'critica_inmediata', scoreMin: 0.75 })

// 6. Alerta que seria critica, degradada por Deep Work (D=1.0)
{
  const sinDeepWork = { R: 1, U: 1, Conf: 0.8, C: 1, S: 0.5, D: 0, Ign: 0 }
  const conDeepWork = { ...sinDeepWork, D: 1.0 }
  const base = caso('misma alerta sin Deep Work (control)', sinDeepWork, { canal: 'critica_inmediata' })
  const degradada = caso('alerta moderada con David en Deep Work', conDeepWork, { canal: 'oportunista' })
  assert.ok(degradada.score < base.score, 'el Deep Work debe reducir el score frente al control')
}

// 7. Tarea en cola completada
caso('tarea en cola completada', { R: 0.6, U: 0.7, Conf: 0.9, C: 0.7, S: 0.5, D: 0, Ign: 0 }, { canal: 'oportunista' })

// 8. Sugerencia de refactorizacion limpia
caso('sugerencia de refactorizacion limpia', { R: 0.35, U: 0.3, Conf: 0.9, C: 0.4, S: 0.5, D: 0, Ign: 0 }, { canal: 'digest_diario' })

// 9. Dependencia desactualizada no critica
caso('dependencia desactualizada no critica', { R: 0.4, U: 0.3, Conf: 0.8, C: 0.4, S: 0.5, D: 0, Ign: 0 }, { canal: 'digest_diario' })

// 10. Aviso cosmetico de linting
caso('aviso cosmetico de linting', { R: 0.1, U: 0.1, Conf: 0.9, C: 0.1, S: 0.3, D: 0, Ign: 0 }, { canal: 'descarte_pasivo', scoreMax: 0.35 })

// 11. Heartbeat de healthcheck
caso('heartbeat de healthcheck', { R: 0.05, U: 0.05, Conf: 0.95, C: 0.05, S: 0.2, D: 0, Ign: 0 }, { canal: 'descarte_pasivo', scoreMax: 0.35 })

// 12. Deteccion de corazonada tecnica (R alto, Conf baja)
caso('corazonada tecnica: riesgo alto con confianza baja', { R: 0.6, U: 0.5, Conf: 0.4, C: 0.5, S: 0.5, D: 0, Ign: 0 }, { corazonada: true })

// 13. Falsa alarma descartada (sin corazonada)
caso('falsa alarma descartada', { R: 0.2, U: 0.2, Conf: 0.3, C: 0.2, S: 0.3, D: 0, Ign: 0 }, { corazonada: false, canal: 'descarte_pasivo' })

// 14. Fatiga por avisos (Ign alto) empuja de digest a descarte
{
  const sinFatiga = { R: 0.4, U: 0.3, Conf: 0.8, C: 0.4, S: 0.5, D: 0, Ign: 0 }
  caso('sin fatiga (control)', sinFatiga, { canal: 'digest_diario' })
  caso('con fatiga alta (Ign=1.0) cruza a descarte_pasivo', { ...sinFatiga, Ign: 1.0 }, { canal: 'descarte_pasivo', scoreMax: 0.35 })
}

// 15. Presencia ausente (S=0) degrada oportunista a digest_diario
{
  const conPresencia = { R: 0.65, U: 0.6, Conf: 0.7, C: 0.6, S: 1, D: 0, Ign: 0 }
  caso('con presencia (control)', conPresencia, { canal: 'oportunista' })
  caso('presencia ausente (S=0)', { ...conPresencia, S: 0 }, { canal: 'digest_diario' })
}

// 16. Saturacion de Deep Work (D alto) empuja de digest a descarte
{
  const sinDeepWork = { R: 0.5, U: 0.4, Conf: 0.7, C: 0.4, S: 0.5, D: 0, Ign: 0 }
  caso('sin Deep Work (control)', sinDeepWork, { canal: 'digest_diario' })
  caso('Deep Work saturado (D=1.0) cruza a descarte_pasivo', { ...sinDeepWork, D: 1.0 }, { canal: 'descarte_pasivo', scoreMax: 0.35 })
}

// 17. Combo: fatiga alta + presencia ausente sobre alerta moderada
caso('fatiga alta + presencia ausente', { R: 0.5, U: 0.5, Conf: 0.6, C: 0.5, S: 0, D: 0, Ign: 1.0 }, { canal: 'descarte_pasivo', scoreMax: 0.35 })

// 18. Combo: doble supresion (Deep Work + fatiga) sobre alerta oportunista
{
  const base = { R: 0.8, U: 0.7, Conf: 0.7, C: 0.7, S: 0.5, D: 0, Ign: 0 }
  caso('alerta oportunista sin supresion (control)', base, { canal: 'oportunista' })
  caso('doble supresion (D=1.0, Ign=1.0) cruza a digest_diario', { ...base, D: 1.0, Ign: 1.0 }, { canal: 'digest_diario' })
}

// 19. Corazonada en frontera exacta (R=0.50, Conf=0.54)
caso('corazonada en frontera exacta (R=0.50, Conf=0.54)', { R: 0.5, U: 0.5, Conf: 0.54, C: 0.5, S: 0.5, D: 0, Ign: 0 }, { corazonada: true })

// 20. Fronteras de canal inclusivas y no-corazonada en Conf=0.55 exacto
caso('frontera digest_diario inclusiva (I=0.35 exacto)', { R: 1, U: 0, Conf: 0, C: 0, S: 1, D: 0, Ign: 0 }, { canal: 'digest_diario' })
caso('frontera oportunista inclusiva (I=0.55 exacto)', { R: 1, U: 1, Conf: 0, C: 0, S: 1, D: 0, Ign: 0 }, { canal: 'oportunista' })
caso('Conf=0.55 exacto NO es corazonada (regla es Conf<0.55 estricto)', { R: 0.9, U: 0.5, Conf: 0.55, C: 0.5, S: 0.5, D: 0, Ign: 0 }, { corazonada: false })

console.log(`\n${n} escenarios OK`)
