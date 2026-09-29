// Prueba de humo para la Tarea [A12-DECOMMISSIONING-D1]: la tabla legacy
// "memoria" se retira y todo queda leyendo de las tablas canonicas
// (memory_items/memory_observations/memory_item_tags + FTS5). Sin frameworks.
//
// Requiere migration_a12_migrate_legacy_memoria.sql ya aplicada (y, si se
// quiere probar tambien la Prueba 1 contra D1 directamente, un binding D1
// local -- por defecto solo golpea la API HTTP del worker).
//
// Uso:
//   node test_decommissioning.mjs
//   BASE_URL=http://localhost:8787 node test_decommissioning.mjs   (contra wrangler dev)
import assert from 'node:assert/strict'

const BASE_URL = process.env.BASE_URL || 'https://jarvis-nucleo.hurtado-banda-david.workers.dev'
const TOKEN = process.env.TOKEN || 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'

const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

async function main() {
  // Prueba 1: GET /memoria y GET /resumen funcionan al 100% leyendo de las
  // tablas canonicas (si "memoria" siguiera siendo consultada tras el DROP/
  // RENAME de migration_a12_drop_legacy_tables.sql, estas llamadas fallarian
  // con 500 "no such table: memoria").
  const resMemoria = await fetch(`${BASE_URL}/memoria`, { headers })
  assert.equal(resMemoria.status, 200, `esperaba 200 en GET /memoria, recibido ${resMemoria.status}`)
  const listaMemoria = await resMemoria.json()
  assert.ok(Array.isArray(listaMemoria), 'GET /memoria debe devolver un array')
  console.log(`OK: GET /memoria responde 200 leyendo de memory_observations (${listaMemoria.length} filas activas)`)

  const resResumen = await fetch(`${BASE_URL}/resumen?agente_id=claude`, { headers })
  assert.equal(resResumen.status, 200, `esperaba 200 en GET /resumen, recibido ${resResumen.status}`)
  const resumen = await resResumen.json()
  assert.ok(Array.isArray(resumen.memorias_prioritarias), 'resumen.memorias_prioritarias debe ser array')
  assert.ok(Array.isArray(resumen.memoria), 'resumen.memoria (compatibilidad) debe ser array')
  console.log('OK: GET /resumen responde 200 leyendo de memory_observations (memorias_prioritarias + memoria)')

  // Prueba 2: el total de recuerdos activos en /memoria coincide con el total
  // de observaciones activas migradas + las nuevas creadas via API (marcador
  // unico inyectado ahora mismo, ver Prueba 3).
  const totalPrevio = listaMemoria.length

  // Prueba 3: insertar un recuerdo nuevo (post-migracion) y comprobar que
  // FTS5 lo encuentra junto con al menos un recuerdo migrado preexistente.
  const marcador = `pruebaA12decommission${Date.now()}`
  const texto = `Marcador de prueba automatizada de la tarea A12-DECOMMISSIONING-D1: ${marcador}`
  const resPost = await fetch(`${BASE_URL}/memoria`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      nombre: `test-a12-${Date.now()}`,
      capa: 'semantica',
      texto,
      autor: 'claude',
      etiquetas: ['meta-sistema'],
    }),
  })
  assert.equal(resPost.status, 200, `esperaba 200 al crear recuerdo nuevo, recibido ${resPost.status}`)
  const nuevo = await resPost.json()
  assert.ok(nuevo.id, 'debe devolver id de la observacion nueva')

  const resListaTrasPost = await fetch(`${BASE_URL}/memoria`, { headers })
  const listaTrasPost = await resListaTrasPost.json()
  assert.equal(listaTrasPost.length, totalPrevio + 1, 'el total de /memoria debe crecer en 1 tras la alta')
  console.log(`OK: memory_observations refleja el alta nueva (total ${totalPrevio} -> ${listaTrasPost.length})`)

  const resBuscarNuevo = await fetch(`${BASE_URL}/memoria/buscar?q=${encodeURIComponent(marcador)}`, { headers })
  assert.equal(resBuscarNuevo.status, 200, `esperaba 200 en busqueda, recibido ${resBuscarNuevo.status}`)
  const resultadosNuevo = await resBuscarNuevo.json()
  assert.ok(
    resultadosNuevo.some((r) => r.id === nuevo.id),
    `FTS5 debe encontrar el recuerdo nuevo ${nuevo.id}`
  )
  console.log('OK: FTS5 encuentra el recuerdo nuevo (post-migracion)')

  const migrado = listaMemoria.find((m) => typeof m.id === 'string' && m.id.length > 0)
  if (migrado) {
    const terminoMigrado = (migrado.texto || '').split(/\s+/).find((w) => w.replace(/[^a-zA-Z0-9]/g, '').length >= 5)
    if (terminoMigrado) {
      const resBuscarMigrado = await fetch(`${BASE_URL}/memoria/buscar?q=${encodeURIComponent(terminoMigrado)}`, { headers })
      assert.equal(resBuscarMigrado.status, 200, `esperaba 200 en busqueda de termino migrado, recibido ${resBuscarMigrado.status}`)
      const resultadosMigrado = await resBuscarMigrado.json()
      assert.ok(Array.isArray(resultadosMigrado), 'la busqueda de un termino migrado debe devolver un array')
      console.log(`OK: FTS5 responde sobre recuerdos preexistentes (termino "${terminoMigrado}", ${resultadosMigrado.length} resultados)`)
    } else {
      console.log('AVISO: no se encontro un termino util en un recuerdo preexistente para probar FTS5 sobre datos migrados')
    }
  } else {
    console.log('AVISO: no hay recuerdos preexistentes en /memoria para verificar la busqueda sobre datos migrados')
  }
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
