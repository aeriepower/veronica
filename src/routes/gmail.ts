// jarvis/nucleo-worker/src/routes/gmail.ts
// Rutas para la integración de Gmail en tiempo real vía Google Cloud Pub/Sub Push Webhook.
import { Hono } from 'hono'
import type { Env } from '../types'

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function ahora(): string {
  return new Date().toISOString()
}

const app = new Hono<{ Bindings: Env }>()

// POST /gmail/push — Receptor de eventos push de Google Cloud Pub/Sub (< 2s de latencia)
app.post('/push', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)

  if (!body || !body.message || !body.message.data) {
    // Si Google envía un ping de verificación o payload vacío, responder 200 para validar
    return c.json({ ok: true, mensaje: 'Ping recibido' }, 200)
  }

  let decodedData: { emailAddress?: string; historyId?: string | number } = {}
  try {
    const raw = atob(body.message.data)
    decodedData = JSON.parse(raw)
  } catch (err: any) {
    console.error('Error decodificando payload de Pub/Sub:', err.message)
    return c.json({ ok: true, aviso: 'Payload no decodificable' }, 200)
  }

  const historyId = String(decodedData.historyId || body.message.messageId || Date.now())
  const emailAddress = decodedData.emailAddress || 'cuenta'
  const idempotencyKey = `gmail_push_${historyId}`

  // Verificar idempotencia en objetivos
  const existente = await db
    .prepare('SELECT id, estado FROM objetivos WHERE idempotency_key = ?')
    .bind(idempotencyKey)
    .first()

  if (existente) {
    return c.json({ ok: true, duplicado: true, objetivo_id: existente.id }, 200)
  }

  const objId = id('o')
  const ahoraIso = ahora()

  await db
    .prepare(
      `INSERT INTO objetivos
        (id, titulo, descripcion, asignado_a, creado_por, prioridad, estado, timeout, idempotency_key, creado, actualizado, historial, avisar_al_terminar)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      objId,
      `Triaje correo Gmail (${historyId})`,
      `Evento push de Google Pub/Sub para ${emailAddress} con historyId ${historyId}`,
      'antigravity',
      'gmail-push',
      'alta',
      'pendiente',
      1800,
      idempotencyKey,
      ahoraIso,
      ahoraIso,
      JSON.stringify([{ estado: 'pendiente', ts: ahoraIso, autor: 'gmail-push' }]),
      1
    )
    .run()

  return c.json({ ok: true, objetivo_id: objId, historyId }, 200)
})

// POST /gmail/confirmar-envio — Endpoint para disparar el envío del borrador cuando David aprueba
app.post('/confirmar-envio', async (c) => {
  const db = c.env.DB
  const body = await c.req.json().catch(() => null)
  if (!body || !body.confirmacion_id) {
    return c.json({ error: 'confirmacion_id requerido' }, 400)
  }

  const conf = await db
    .prepare("SELECT * FROM confirmaciones WHERE id = ? AND estado = 'pendiente'")
    .bind(body.confirmacion_id)
    .first()

  if (!conf) {
    return c.json({ error: 'Confirmación no encontrada o ya resuelta' }, 404)
  }

  // Marcar como resuelta / aprobada
  const ahoraIso = ahora()
  await db
    .prepare("UPDATE confirmaciones SET estado = 'resuelta', decision = 'aprobar', resuelto_por = 'david', resuelto_en = ? WHERE id = ?")
    .bind(ahoraIso, body.confirmacion_id)
    .run()

  return c.json({ ok: true, mensaje: 'Borrador aprobado para envío', id: body.confirmacion_id })
})

export default app
