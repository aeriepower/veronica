// Punto de entrada Hono del nucleo remoto de Jarvis (Veronica). Migra
// worker.js (monolitico) a Hono + TypeScript preservando exactamente los
// endpoints heredados; ver AGENTS.md seccion 0 (Regla Cero) y seccion 7
// (mapa de relaciones). Tarea [A3-WORKER-BLAST-RADIUS].
//
// [MCP-A13] Anade la capa MCP (/mcp, ver ./mcp/index.ts) como capa fina
// sobre estos mismos sub-apps: nunca logica duplicada, nunca acceso a D1
// fuera de estos routers. nodos y registro se extraen a su propio modulo
// (routes/nodos.ts, routes/registro.ts) para que MCP los reutilice via
// app.request() igual que ya hacia con relaciones/objetivos/etc.
// Ver contrato-mcp-veronica.md (proyecto "Automatizacion Whatsapp").
import { Hono } from 'hono'
import relaciones from './routes/relaciones'
import grafo from './routes/grafo'
import memoria from './routes/memoria'
import nodos from './routes/nodos'
import objetivos from './routes/objetivos'
import confirmaciones from './routes/confirmaciones'
import telemetria from './routes/telemetria'
import leases from './routes/leases'
import resumen from './routes/resumen'
import dispositivos from './routes/dispositivos'
import silencio from './routes/silencio'
import gmail from './routes/gmail'
import registro from './routes/registro'
import listas from './routes/listas'
import mcp from './mcp'
import { generarDigest } from './services/digest'
import { ejecutarCuracionNocturna } from './services/curacion'
import type { Env } from './types'

// Token canonico documentado en AGENTS.md seccion 6 (no es secreto nuevo:
// ya vive en el repo). env.TOKEN (wrangler secret) tiene prioridad siempre.
const CANONICAL_TOKEN = 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'

export function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function ahora(): string {
  return new Date().toISOString()
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  // Webhook push de Google Cloud Pub/Sub
  if (c.req.path.startsWith('/gmail/push')) {
    return await next()
  }
  const esperado = c.env.TOKEN || CANONICAL_TOKEN
  const auth = c.req.header('authorization') || ''
  if (auth !== `Bearer ${esperado}`) {
    return c.json({ error: 'no autorizado' }, 401)
  }
  await next()
})

app.onError((e, c) => c.json({ error: e.message }, 500))

// ---------- GMAIL (modular: push webhook + confirmacion de envio) ----------
app.route('/gmail', gmail)

// ---------- MEMORIA (modular: canonica memory_items/observations + FTS) ----------
app.route('/memoria', memoria)

// ---------- LISTAS (modular: 'ideas' = memoria filtrada por etiqueta) ----------
app.route('/listas', listas)

// ---------- NODOS (modular: mapa de dependencias) ----------
app.route('/nodos', nodos)

// ---------- RELACIONES (modular, incluye blast radius) ----------
app.route('/relaciones', relaciones)

// ---------- GRAFO VIVO (planificar_cambio, puente memoria<->nodos, propuestas) ----------
app.route('/grafo', grafo)

// ---------- OBJETIVOS (modular: idempotencia, prioridad, resultado) ----------
app.route('/objetivos', objetivos)

// ---------- REGISTRO (modular) ----------
app.route('/registro', registro)

// ---------- CONFIRMACIONES (modular: timeout, contexto/impacto, expiracion) ----------
app.route('/confirmaciones', confirmaciones)

// ---------- LEASES (modular: exclusion mutua distribuida entre pilares) ----------
app.route('/leases', leases)

// ---------- RESUMEN (cold-start, modular: agente_id + Server-Timing) ----------
app.route('/resumen', resumen)

// ---------- DISPOSITIVOS (push tokens de la app movil) ----------
app.route('/dispositivos', dispositivos)

// ---------- SILENCIO (motor de interrupcion selectiva, Fase D) ----------
app.route('/silencio', silencio)

// ---------- AI TELEMETRIA Y LIMITES (modular: semaforo predictivo de 5h) ----------
app.route('/', telemetria)

// ---------- MCP (Fase 2 - capa fina sobre todo lo anterior) ----------
app.route('/mcp', mcp)

app.notFound((c) => c.json({ error: 'ruta no encontrada' }, 404))

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    // Cron 08:30 Espana (06:30 UTC: '30 6 * * *') -> matutino; el resto
    // ('0 20 * * *', '0 22 * * *') -> nocturno. Ver wrangler.toml [triggers].
    const cron = event.cron
    const momento = cron.includes('6') ? 'matutino' : 'nocturno'
    ctx.waitUntil(generarDigest(env.DB, momento))

    // Curacion nocturna de memoria (00:00 hora de Espana), Tarea [D5-SILENCIO-CURACION-CLAUDE].
    if (cron === '0 22 * * *') {
      ctx.waitUntil(ejecutarCuracionNocturna(env.DB))
    }
  },
}
