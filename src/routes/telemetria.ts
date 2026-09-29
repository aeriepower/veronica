// Torre de Control de Telemetria y Cuotas: POST /ai-telemetria, GET /ai-limits.
// Semaforo predictivo de 5h reutilizado por GET /resumen (cold-start). Ver
// arquitectura-jarvis-asistente.md seccion 8.1/8.4 y Tarea
// [A7-WORKER-TELEMETRIA-CUOTAS].
import { Hono } from 'hono'
import type { Env } from '../types'
import { AiTelemetriaSchema, type SemaforoCuotas } from '../types/telemetria'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

// proveedor (evento puntual) -> clave del motor dentro del snapshot.
// claude_pro -> claude; gemini -> antigravity (Antigravity corre sobre
// Gemini Pro, ver AGENTS.md seccion 2); nvidia -> nvidia.
const PROVEEDOR_A_MOTOR: Record<string, string> = {
  claude_pro: 'claude',
  gemini: 'antigravity',
  nvidia: 'nvidia',
}

async function obtenerUltimoSnapshot(db: D1Database): Promise<{ row: any; motores: Record<string, any> }> {
  try {
    const row: any = await db.prepare('SELECT * FROM ai_telemetria ORDER BY ts DESC LIMIT 1').first()
    return { row, motores: row ? JSON.parse(row.datos || '{}') : {} }
  } catch {
    return { row: null, motores: {} }
  }
}

// Semaforo predictivo de 5h (seccion 8.4): lee el % de cadencia consumida de
// Claude dentro del snapshot mas reciente. Sin dato -> verde por defecto.
function calcularSemaforoCuotas(motores: Record<string, any> | null | undefined): SemaforoCuotas {
  const claude = motores?.claude
  const porcentaje = claude?.porcentajeConsumido5h
  const minutos = claude?.minutosParaReseteo ?? claude?.tiempoParaReseteo5h
  const resetEnHoras = typeof minutos === 'number' ? Math.round((minutos / 60) * 10) / 10 : undefined

  if (typeof porcentaje !== 'number' || porcentaje < 70) {
    return { claude_pro: 'verde', reset_en_horas: resetEnHoras, recomendacion: 'Operación normal; Claude asume tareas pesadas de programación libremente.' }
  }
  if (porcentaje < 90) {
    return { claude_pro: 'amarillo', reset_en_horas: resetEnHoras, recomendacion: 'Precaución; reservar a Claude estrictamente para programación y refactorización crítica.' }
  }
  return { claude_pro: 'rojo', reset_en_horas: resetEnHoras, recomendacion: 'Enfriamiento preventivo y freno de ráfagas para no agotar la cuota antes de la ventana de reset.' }
}

// Reutilizado por GET /resumen (index.ts) para alimentar el semaforo en el cold-start.
export async function obtenerSemaforoCuotas(db: D1Database): Promise<SemaforoCuotas> {
  const { motores } = await obtenerUltimoSnapshot(db)
  return calcularSemaforoCuotas(motores)
}

const app = new Hono<{ Bindings: Env }>()

// POST /ai-telemetria
app.post('/ai-telemetria', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (body === null) return c.json({ error: 'payload invalido: JSON malformado' }, 400)

  const parsed = AiTelemetriaSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: 'payload invalido', detalles: parsed.error.flatten() }, 400)
  }
  const b = parsed.data

  await db.prepare('CREATE TABLE IF NOT EXISTS ai_telemetria (id TEXT PRIMARY KEY, actor TEXT, datos TEXT, ts TEXT)').run()

  // Snapshot completo (motores) se guarda tal cual; un evento puntual
  // (proveedor/tokens/latencia) se funde sobre el ultimo snapshot bajo la
  // clave del motor correspondiente, para no perder los otros motores.
  let motores = b.motores
  if (!motores) {
    const { motores: previos } = await obtenerUltimoSnapshot(db)
    const motorKey = PROVEEDOR_A_MOTOR[b.proveedor ?? 'claude_pro']
    motores = {
      ...previos,
      [motorKey]: { proveedor: b.proveedor, tokens_in: b.tokens_in, tokens_out: b.tokens_out, latencia_ms: b.latencia_ms, ts: ahora() },
    }
  }

  const nuevoId = id('ait')
  const ts = ahora()
  await db.prepare('INSERT INTO ai_telemetria (id, actor, datos, ts) VALUES (?,?,?,?)').bind(nuevoId, b.actor, JSON.stringify(motores), ts).run()
  return c.json({ ok: true, id: nuevoId, ts })
})

// GET /ai-limits
app.get('/ai-limits', async (c) => {
  const db = c.env.DB
  const { row, motores } = await obtenerUltimoSnapshot(db)
  if (!row) {
    return c.json({ configured: true, hayDatos: false, ts: ahora(), actor: 'pc-watcher', motores: {}, semaforo_cuotas: calcularSemaforoCuotas(null) })
  }
  return c.json({ configured: true, hayDatos: true, ts: row.ts, actor: row.actor, motores, semaforo_cuotas: calcularSemaforoCuotas(motores) })
})

export default app
