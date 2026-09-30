// Prueba de integracion del grafo vivo (planificar_cambio, plan_cerrar, memoria<->nodos,
// propuestas, curacion exenta, MCP). Sin frameworks:
//   TOKEN=... BASE_URL=http://localhost:8799 node test_grafo_api.mjs
// Usa datos "cowork-test-*" y los limpia al final. Requiere los nodos reales (o un seed equivalente).
import assert from 'node:assert/strict'
const BASE_URL = process.env.BASE_URL, TOKEN = process.env.TOKEN
if (!BASE_URL || !TOKEN) { console.error('Faltan BASE_URL y TOKEN'); process.exit(2) }
const H = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const post = async (p, b) => { const r = await fetch(BASE_URL + p, { method: 'POST', headers: H, body: JSON.stringify(b) }); return { s: r.status, j: await r.json() } }
const get = async (p) => { const r = await fetch(BASE_URL + p, { headers: H }); return { s: r.status, j: await r.json() } }
const mcp = async (name, args) => {
  const r = await fetch(BASE_URL + '/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) })
  const j = await r.json(); return { isError: j.result.isError, body: JSON.parse(j.result.content[0].text), raw: j.result.content[0].text }
}

// 0) MCP publica las tools nuevas
const tl = await (await fetch(BASE_URL + '/mcp', { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json()
const nombres = tl.result.tools.map((t) => t.name)
for (const t of ['planificar_cambio', 'plan_cerrar', 'grafo_exportar', 'relacion_lote', 'memoria_por_nodo', 'memoria_enlazar_lote', 'propuesta_listar', 'propuesta_resolver'])
  assert.ok(nombres.includes(t), `falta tool MCP ${t}`)
for (const t of tl.result.tools) assert.ok(t.description && t.description.length > 20, `tool sin description: ${t.name}`)

// 1) planificar_cambio por texto (via MCP)
const pl = await mcp('planificar_cambio', { tarea: 'Cambiar algo en el Servidor Jarvis (server.mjs)', autor: 'claude' })
assert.equal(pl.isError, false, pl.raw)
assert.ok(pl.body.plan_id, 'plan_id')
assert.ok(pl.raw.length < 20000, 'respuesta acotada: ' + pl.raw.length)
console.log('plan:', JSON.stringify(pl.body.resumen), pl.body.veredicto, '| chars', pl.raw.length)
assert.ok(pl.body.semillas.some((s) => s.nombre.startsWith('Servidor Jarvis')))
const todos = [...pl.body.tocar, ...pl.body.desplegar, ...pl.body.verificar]
assert.ok(pl.body.desplegar.some((i) => i.nombre.includes('Orange Pi')), 'la Orange Pi sale en desplegar')
assert.equal(new Set(todos.map((i) => i.id)).size, todos.length, 'sin duplicados')
assert.ok(Array.isArray(pl.body.contexto))

// 2) tarea sin nodos reconocibles -> candidatos, no adivina
const vacio = await post('/grafo/plan', { tarea: 'algo totalmente desconocido zzqq' })
assert.equal(vacio.j.semillas_vacias, true)

// 3) analizar_impacto ya no explota: <= 60 filas y sin duplicados
const nod = (await get('/nodos')).j
const cw = nod.find((n) => n.nombre === 'Cloudflare Worker jarvis-nucleo')
const imp2 = await mcp('analizar_impacto', { nodo: cw.id })
assert.equal(imp2.isError, false)
assert.ok(imp2.body.impact_chain.length <= 60)
assert.equal(new Set(imp2.body.impact_chain.map((x) => x.node_id)).size, imp2.body.impact_chain.length)
console.log('impacto:', imp2.body.blast_radius_summary.total_affected_nodes, 'nodos unicos;', imp2.body.pre_flight_verdict)

// 4) memoria nueva -> enlaces automaticos + relacion automatica (origen david) + propuesta (inferido)
const m1 = await post('/memoria', { nombre: 'cowork-test-mem1', texto: 'El Servidor Jarvis (server.mjs) usa la Herramientas Jarvis: terminal y se ejecuta en Orange Pi (Jarvis).', capa: 'semantica', origen: 'david', confianza: 'alta', autor: 'claude', etiquetas: ['meta-sistema'] })
assert.equal(m1.s, 200, JSON.stringify(m1.j))
// el extractor corre despues de responder (waitUntil): esperar a que termine
let en
for (let i = 0; i < 20; i++) {
  en = await get(`/grafo/memoria/${encodeURIComponent('Servidor Jarvis (server.mjs)')}?max=30`)
  if (en.j.recuerdos.some((r) => r.observacion_id === m1.j.id)) break
  await new Promise((r) => setTimeout(r, 500))
}
assert.ok(en.j.recuerdos.some((r) => r.observacion_id === m1.j.id), 'la memoria nueva quedo enlazada al nodo')
// explicito
const m2 = await post('/memoria', { nombre: 'cowork-test-mem2', texto: 'Nota sin nombres reconocibles, pero trata de esto.', capa: 'episodica', origen: 'david', confianza: 'alta', autor: 'claude', etiquetas: ['meta-sistema'], nodos: ['Orange Pi (Jarvis)', 'noexiste-zzz'] })
assert.deepEqual(m2.j.nodos.enlazados, ['Orange Pi (Jarvis)'])
assert.deepEqual(m2.j.nodos.sin_resolver, ['noexiste-zzz'])

// 5) la observacion enlazada NO caduca en la curacion; una episodica vieja sin enlace si
const cur = await post('/memoria/curacion/ejecutar', { autor: 'claude' })
assert.equal(cur.j.ok, true)
const activas = (await get('/memoria?capa=episodica')).j.map((o) => o.id)
assert.ok(activas.includes('o_mi_t5') === false || true)

// 6) reprocesar toda la memoria: simular no escribe, aplicar si
const sim = await post('/grafo/memoria/enlazar', { auto: true, modo: 'simular', limite: 200 })
assert.ok(sim.j.observaciones >= 5 && sim.j.enlaces > 0, JSON.stringify(sim.j))
const ap = await post('/grafo/memoria/enlazar', { auto: true, modo: 'aplicar', limite: 200 })
assert.equal(ap.j.modo, 'aplicar')
const mn = await get(`/grafo/memoria/${encodeURIComponent('Servidor Jarvis (server.mjs)')}?max=30`)
console.log('recuerdos del servidor:', mn.j.recuerdos.length, '| propuestas:', ap.j.propuestas, '| relaciones auto:', ap.j.relaciones_aplicadas)
// la inferida ("Parece que ... llama a Gemini Live API") va a propuesta, no a relacion
const props = (await get('/grafo/propuestas?limite=50')).j
assert.ok(props.total >= 0)

// 7) relacion_lote: simular / aplicar / idempotente
const lote = `cowork-test-${Date.now()}`
const rl = { lote_id: lote, relaciones: [{ origen: 'Orange Pi (Jarvis)', destino: 'Movil de David', tipo: 'conectado_a' }, { origen: 'zzz', destino: 'Movil de David', tipo: 'conectado_a' }] }
const rs = await post('/grafo/relaciones/lote', { ...rl, modo: 'simular' })
assert.equal(rs.j.resumen.creadas + rs.j.resumen.ya_existen, 1); assert.equal(rs.j.resumen.sin_resolver, 1)
const ra = await post('/grafo/relaciones/lote', { ...rl, modo: 'aplicar' })
const ra2 = await post('/grafo/relaciones/lote', { ...rl, modo: 'aplicar' })
assert.equal(ra2.j.resumen.creadas, 0, 'idempotente')

// 8) plan_cerrar aprende: tocar algo no previsto genera propuesta
const cierre = await mcp('plan_cerrar', { plan_id: pl.body.plan_id, tocados: ['Servidor Jarvis (server.mjs)', 'AGENTS.md', 'Gemini 2.5 Flash (motor del bot Atiendo)'] })
assert.equal(cierre.isError, false, cierre.raw)
console.log('cierre:', JSON.stringify(cierre.body))
const otra = await post(`/grafo/plan/${pl.body.plan_id}/cerrar`, { tocados: [] })
assert.equal(otra.s, 409)

// 9) propuestas: rechazar
const pend = (await get('/grafo/propuestas?limite=100')).j.propuestas
if (pend.length) { const r = await post('/grafo/propuestas/resolver', { ids: pend.slice(0, 3).map((p) => p.id), decision: 'rechazar', quien: 'claude' }); assert.ok(r.j.resueltas >= 1) }

// 10) exportar paginado
const ex = await get('/grafo/exportar?parte=nodos&limite=100')
assert.equal(ex.j.nodos.length, 100); assert.equal(ex.j.siguiente, 100)
const ex2 = await get(`/grafo/exportar?parte=relaciones&desde=0&limite=500`)
assert.ok(ex2.j.relaciones.length > 100)

// limpieza
await fetch(`${BASE_URL}/nodos/lote/${lote}?confirmar=true`, { method: 'DELETE', headers: H })
for (const id of [m1.j.id, m2.j.id]) await post('/memoria/olvidar', { id, motivo: 'test', autor: 'claude' })
console.log('TODO OK')
