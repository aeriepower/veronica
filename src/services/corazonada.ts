// Corazonadas tecnicas: deteccion y formateo sobrio de riesgo tecnico con
// certeza baja. Ver Santo Grial Fase D, seccion 12.3, Tarea [D4-SILENCIO-CORAZONADAS].

export type EventoCorazonada = {
  titulo: string
  detalle: string
  R: number
  Conf: number
}

export type CorazonadaCalificada = {
  esCorazonada: true
  certeza: number
  plantillaVerbal: string
  plantillaVisual: {
    badge: string
    sintoma: string
    impacto: string
    accion: string
  }
}

export type CorazonadaDescartada = {
  esCorazonada: false
  motivo: string
}

// Condicion estricta (seccion 12.3): riesgo moderado/alto con certeza baja.
// R < 0.30 nunca califica, aunque Conf sea baja: prohibido el alarmismo.
export function esCorazonadaTecnica(R: number, Conf: number): boolean {
  return R >= 0.5 && Conf < 0.55
}

export function formatearCorazonadaTecnica(evento: EventoCorazonada): Omit<CorazonadaCalificada, 'esCorazonada'> {
  const certeza = Math.round(evento.Conf * 100)
  return {
    certeza,
    plantillaVerbal: `Tengo una corazonada técnica con baja certeza (${certeza}%): ${evento.titulo}. ${evento.detalle}; mantengo la monitorización activa.`,
    plantillaVisual: {
      badge: `◈ CORAZONADA TÉCNICA (${certeza}%)`,
      sintoma: evento.titulo,
      impacto: `Riesgo técnico estimado: ${Math.round(evento.R * 100)}% | Certeza: ${certeza}%`,
      accion: 'Monitorización activa en segundo plano',
    },
  }
}

export function evaluarCorazonada(evento: EventoCorazonada): CorazonadaCalificada | CorazonadaDescartada {
  if (!esCorazonadaTecnica(evento.R, evento.Conf)) {
    return { esCorazonada: false, motivo: 'Riesgo insuficiente o confianza suficiente' }
  }
  return { esCorazonada: true, ...formatearCorazonadaTecnica(evento) }
}
