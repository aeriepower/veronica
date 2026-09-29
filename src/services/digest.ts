// Digest diario: sintetiza los eventos retenidos en el canal 'digest_diario'
// del motor de silencio (ver services/silencio.ts) en un briefing tipo Chief
// of Staff, los marca como despachados y los deja en memoria canonica.
// Ver Santo Grial Fase D, Tarea [D3-SILENCIO-DIGESTS-DIARIOS].
import { ahora, id } from '../index'

export type MomentoDigest = 'matutino' | 'nocturno'

type SilencioEventoRow = {
  id: string
  titulo: string
  resumen: string | null
  score: number
  canal: string
  factores: string | null
  estado: string
  creado: string
}

type ResultadoDigest = {
  ok: true
  momento: MomentoDigest
  totalEventos: number
  briefing: string
  despachados: string[]
}

const ENCABEZADOS: Record<MomentoDigest, string> = {
  matutino: '◈ J.A.R.V.I.S. · BRIEFING DE APERTURA (08:30)',
  nocturno: '◈ J.A.R.V.I.S. · DEBRIEF DE CIERRE (22:00)',
}

function construirBriefing(momento: MomentoDigest, eventos: SilencioEventoRow[]): string {
  if (eventos.length === 0) {
    return `◈ BRIEFING ${momento.toUpperCase()}: Sin incidencias retenidas. Todos los sistemas operando en rango nominal.`
  }

  const vinetas = eventos
    .map((e) => `- ${e.titulo}: ${e.resumen || 'sin detalles adicionales'} (score: ${e.score.toFixed(2)})`)
    .join('\n')

  return [
    ENCABEZADOS[momento],
    `${eventos.length} eventos secundarios retenidos durante el periodo de concentración.`,
    vinetas,
    'Estado del sistema: estable, sin incidencias críticas fuera de las listadas arriba.',
  ].join('\n\n')
}

// Reutiliza el mismo patron find-or-create de item + observacion + tag que
// POST /memoria (routes/memoria.ts), pero en directo: el digest ya vive en
// el worker con acceso a DB, no tiene sentido rebotarlo por HTTP interno.
async function guardarEnMemoria(db: D1Database, momento: MomentoDigest, texto: string): Promise<void> {
  const fecha = ahora()
  const nombreItem = `digest-${momento}-${fecha.slice(0, 10)}`

  const existente: { id: string } | null = await db
    .prepare("SELECT id FROM memory_items WHERE nombre = ? AND estado = 'activo'")
    .bind(nombreItem)
    .first()

  const itemId = existente?.id || id('mi')
  const observationId = id('mo')

  const statements = []
  if (!existente) {
    statements.push(
      db
        .prepare("INSERT INTO memory_items (id, nombre, estado, creado, actualizado, autor) VALUES (?,?,'activo',?,?,?)")
        .bind(itemId, nombreItem, fecha, fecha, 'jarvis')
    )
  }
  statements.push(
    db
      .prepare(
        "INSERT INTO memory_observations (id, item_id, capa, texto, origen, confianza, estado, autor, fecha) VALUES (?,?,'episodica',?,'herramienta','alta','activo','jarvis',?)"
      )
      .bind(observationId, itemId, texto, fecha),
    db
      .prepare('INSERT OR IGNORE INTO memory_item_tags (item_id, tag_id) SELECT ?, id FROM memory_tags WHERE nombre = ?')
      .bind(itemId, 'meta-sistema')
  )

  await db.batch(statements)
}

// Push tolerante a fallos: un digest que no se pudo notificar sigue siendo
// un digest generado y persistido correctamente, nunca debe tumbar la request.
async function notificarDispositivos(db: D1Database, momento: MomentoDigest, texto: string): Promise<void> {
  try {
    const tokens = await db.prepare('SELECT token FROM dispositivos').all<{ token: string }>()
    const destinos = (tokens.results || []).map((r) => r.token).filter(Boolean)
    if (destinos.length === 0) return

    const primeraLinea = texto.split('\n')[0]
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        destinos.map((to) => ({
          to,
          title: `J.A.R.V.I.S. · Digest ${momento}`,
          body: primeraLinea,
        }))
      ),
    })
  } catch {
    // Sin bloquear el digest: el push es best-effort.
  }
}

export async function generarDigest(db: D1Database, momento: MomentoDigest): Promise<ResultadoDigest> {
  const eventos = (
    await db
      .prepare("SELECT * FROM silencio_eventos WHERE canal='digest_diario' AND estado='pendiente' ORDER BY creado ASC")
      .all<SilencioEventoRow>()
  ).results || []

  const briefing = construirBriefing(momento, eventos)
  const despachados = eventos.map((e) => e.id)

  if (despachados.length > 0) {
    const placeholders = despachados.map(() => '?').join(',')
    await db
      .prepare(`UPDATE silencio_eventos SET estado='despachado' WHERE id IN (${placeholders})`)
      .bind(...despachados)
      .run()
  }

  await guardarEnMemoria(db, momento, briefing)
  await notificarDispositivos(db, momento, briefing)

  return { ok: true, momento, totalEventos: eventos.length, briefing, despachados }
}
