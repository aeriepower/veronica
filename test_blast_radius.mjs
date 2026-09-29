// Prueba de humo para GET /relaciones/impacto (Tarea A3-WORKER-BLAST-RADIUS).
// Requiere migration_a3_blast_radius.sql ya aplicada y seed_canonica.sql
// sembrado (candyla-salesforce / atiendo-n8n). Sin frameworks.
//
// Uso:
//   node test_blast_radius.mjs
//   BASE_URL=http://localhost:8787 node test_blast_radius.mjs   (contra wrangler dev)
import assert from 'node:assert/strict'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'

async function main() {
  const res = await fetch(`${BASE_URL}/relaciones/impacto?nodo=candyla-salesforce`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  })
  assert.equal(res.status, 200, `esperaba 200, recibido ${res.status}`)

  const body = await res.json()

  assert.equal(body.target_node, 'candyla-salesforce')
  assert.ok(Array.isArray(body.impact_chain), 'impact_chain debe ser array')

  const atiendo = body.impact_chain.find((n) => n.node_id === 'atiendo-n8n')
  assert.ok(atiendo, "atiendo-n8n debe aparecer en impact_chain de candyla-salesforce")
  assert.equal(atiendo.severity, 'CRITICAL_BLOCKING')
  assert.equal(atiendo.is_blocking, true)

  assert.ok(
    body.blast_radius_summary.critical_nodes_impacted.includes('atiendo-n8n'),
    'atiendo-n8n debe estar en critical_nodes_impacted'
  )
  assert.equal(body.blast_radius_summary.max_severity, 'CRITICAL_BLOCKING')
  assert.equal(body.pre_flight_verdict, 'BLOCKED_REQUIRES_CONFIRMATION')
  assert.ok(body.actionable_guardrails.length > 0, 'debe incluir guardrails')

  console.log('OK: blast radius de candyla-salesforce detecta atiendo-n8n como CRITICAL_BLOCKING / BLOCKED_REQUIRES_CONFIRMATION')
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
