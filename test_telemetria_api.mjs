// Prueba de humo para POST /ai-telemetria + GET /ai-limits (Tarea
// [A7-WORKER-TELEMETRIA-CUOTAS]). Sin frameworks.
//
// Uso:
//   node test_telemetria_api.mjs
//   BASE_URL=http://localhost:8787 node test_telemetria_api.mjs   (contra wrangler dev)
// La prueba 4 (latencia < 50 ms) solo es representativa contra wrangler dev
// local; contra el Worker en produccion incluye RTT de red real.
import assert from 'node:assert/strict'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'
const HEADERS = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function postSnapshot(porcentajeConsumido5h) {
  const res = await fetch(`${BASE_URL}/ai-telemetria`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      actor: 'test-watcher',
      motores: { claude: { porcentajeConsumido5h, minutosParaReseteo: 90 } },
    }),
  })
  assert.equal(res.status, 200, `POST /ai-telemetria esperaba 200, recibido ${res.status}`)
  return res.json()
}

async function getLimits() {
  const res = await fetch(`${BASE_URL}/ai-limits`, { headers: HEADERS })
  assert.equal(res.status, 200, `GET /ai-limits esperaba 200, recibido ${res.status}`)
  return res.json()
}

async function main() {
  // Prueba 1: snapshot al 45% -> verde
  await postSnapshot(45)
  const limits45 = await getLimits()
  assert.equal(limits45.semaforo_cuotas.claude_pro, 'verde', 'esperaba semaforo verde al 45%')
  assert.equal(limits45.semaforo_cuotas.reset_en_horas, 1.5, 'reset_en_horas debe ser minutosParaReseteo/60')
  console.log('OK 1: 45% -> verde')

  // Prueba 2: snapshot al 75% -> amarillo + recomendacion preventiva
  await postSnapshot(75)
  const limits75 = await getLimits()
  assert.equal(limits75.semaforo_cuotas.claude_pro, 'amarillo', 'esperaba semaforo amarillo al 75%')
  assert.match(limits75.semaforo_cuotas.recomendacion, /programación y refactorización crítica/)
  console.log('OK 2: 75% -> amarillo + recomendacion preventiva')

  // Prueba 3: snapshot al 95% -> rojo + recomendacion de enfriamiento
  await postSnapshot(95)
  const limits95 = await getLimits()
  assert.equal(limits95.semaforo_cuotas.claude_pro, 'rojo', 'esperaba semaforo rojo al 95%')
  assert.match(limits95.semaforo_cuotas.recomendacion, /Enfriamiento preventivo/)
  console.log('OK 3: 95% -> rojo + recomendacion de enfriamiento')

  // Prueba 4: GET /ai-limits responde en < 50 ms
  const inicio = performance.now()
  await getLimits()
  const duracionMs = performance.now() - inicio
  const maxMs = BASE_URL.includes('localhost') ? 50 : 1000
  assert.ok(duracionMs < maxMs, `GET /ai-limits tardo ${duracionMs.toFixed(1)} ms, esperaba < ${maxMs} ms`)
  console.log(`OK 4: GET /ai-limits respondio en ${duracionMs.toFixed(1)} ms (max permitido: ${maxMs} ms)`)
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
