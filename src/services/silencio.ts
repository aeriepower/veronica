// Motor de silencio inteligente: decide si un hallazgo interrumpe a David ya,
// espera al digest diario, o se descarta. Ver Santo Grial Fase D, seccion
// 12.3 (corazonada tecnica) y Tarea [D1-SILENCIO-MOTOR-INTERRUPCION].
import type { CanalSalida, FactoresInterrupcion, ResultadoInterrupcion } from '../types/silencio'

function canalPara(score: number): CanalSalida {
  if (score >= 0.75) return 'critica_inmediata'
  if (score >= 0.55) return 'oportunista'
  if (score >= 0.35) return 'digest_diario'
  return 'descarte_pasivo'
}

export function calcularInterrupcion(f: FactoresInterrupcion): ResultadoInterrupcion {
  const bruto = 0.25 * f.R + 0.2 * f.U + 0.15 * f.Conf + 0.15 * f.C + 0.1 * f.S - 0.1 * f.D - 0.05 * f.Ign
  const score = Math.min(1, Math.max(0, bruto))
  const canal = canalPara(score)
  const corazonada = f.R >= 0.5 && f.Conf < 0.55

  return {
    score,
    canal,
    factores: f,
    corazonada,
    detalles:
      `I=${score.toFixed(3)} -> ${canal}` +
      (corazonada ? ' [corazonada tecnica: riesgo alto con confianza baja, seccion 12.3]' : ''),
  }
}
