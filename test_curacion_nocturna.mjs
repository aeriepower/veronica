// Prueba de humo para la curacion nocturna de memoria (Tarea
// [D5-SILENCIO-CURACION-CLAUDE]). Sin frameworks.
//
// Levanta 'wrangler dev' en local, siembra observaciones con fecha
// retroactiva directamente en el D1 local (la API HTTP siempre usa la fecha
// actual, asi que la siembra de datos de hace 31 dias exige acceso directo
// a la base), y valida el endpoint POST /memoria/curacion/ejecutar.
//
// Uso:
//   node test_curacion_nocturna.mjs
import assert from 'node:assert/strict'
import { execSync, spawn } from 'node:child_process'
import { setTimeout as esperar } from 'node:timers/promises'

const PORT = 8788
const BASE_URL = `http://localhost:${PORT}`
const TOKEN = 'p93ZRdpNyqgGNq1RjdBpAdWWtBNzcpKAiG8IG9DBW0E'
const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

function sqlLocal(sql) {
  const comando = `npx wrangler d1 execute jarvis-nucleo --local --command "${sql.replace(/"/g, '\\"')}"`
  execSync(comando, { cwd: import.meta.dirname, stdio: 'pipe' })
}

async function esperarServidorListo() {
  for (let intento = 0; intento < 30; intento++) {
    try {
      const res = await fetch(`${BASE_URL}/leases`, { headers })
      if (res.status === 200) return
    } catch {
      // el servidor todavia no acepta conexiones
    }
    await esperar(500)
  }
  throw new Error('wrangler dev no arranco a tiempo')
}

async function main() {
  const marcador = `pruebaD5_${Date.now()}`
  const itemId = `mi_${marcador}`
  const obsEpisodica = `mo_${marcador}_epi`
  const obsSemantica = `mo_${marcador}_sem`
  const fechaVieja = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()

  // 1. Sembrar un item + una observacion episodica y una semantica, ambas de
  // hace 31 dias, directamente en el D1 local (la API HTTP no permite fijar
  // 'fecha': siempre usa el instante actual).
  sqlLocal(`INSERT INTO memory_items (id, nombre, estado, creado, actualizado, autor) VALUES ('${itemId}', '${marcador}', 'activo', '${fechaVieja}', '${fechaVieja}', 'claude');`)
  sqlLocal(
    `INSERT INTO memory_observations (id, item_id, capa, texto, origen, confianza, estado, autor, fecha) VALUES ('${obsEpisodica}', '${itemId}', 'episodica', 'observacion episodica de prueba ${marcador}', 'herramienta', 'media', 'activo', 'claude', '${fechaVieja}');`
  )
  sqlLocal(
    `INSERT INTO memory_observations (id, item_id, capa, texto, origen, confianza, estado, autor, fecha) VALUES ('${obsSemantica}', '${itemId}', 'semantica', 'observacion semantica de prueba ${marcador}', 'herramienta', 'media', 'activo', 'claude', '${fechaVieja}');`
  )
  console.log(`OK: sembradas 1 observacion episodica y 1 semantica de hace 31 dias (item ${itemId})`)

  // Arrancar 'wrangler dev' contra el D1 local ya sembrado.
  const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--local'], {
    cwd: import.meta.dirname,
    stdio: 'pipe',
    shell: true,
  })
  let salidaDev = ''
  dev.stdout.on('data', (d) => (salidaDev += d))
  dev.stderr.on('data', (d) => (salidaDev += d))

  try {
    await esperarServidorListo()
    console.log('OK: wrangler dev arriba en local')

    // 4a. Lease pre-ocupado por otro titular -> la curacion debe abortar.
    const preLease = await fetch(`${BASE_URL}/leases/adquirir`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recurso: 'curacion_nocturna_memoria', titular: 'jarvis', ttl_segundos: 5 }),
    })
    assert.equal(preLease.status, 200, `esperaba 200 al pre-ocupar el lease, recibido ${preLease.status}`)

    const resBloqueada = await fetch(`${BASE_URL}/memoria/curacion/ejecutar`, { method: 'POST', headers, body: '{}' })
    assert.equal(resBloqueada.status, 409, `esperaba 409 con el lease ocupado, recibido ${resBloqueada.status}`)
    const bloqueada = await resBloqueada.json()
    assert.equal(bloqueada.ok, false)
    assert.equal(bloqueada.motivo, 'lease_ocupado', 'debe abortar con motivo lease_ocupado')
    console.log('OK: con el lease ocupado por otro titular, la curacion aborta con lease_ocupado')

    await fetch(`${BASE_URL}/leases/liberar`, { method: 'POST', headers, body: JSON.stringify({ recurso: 'curacion_nocturna_memoria', titular: 'jarvis' }) })

    // 2. Ejecutar la curacion nocturna real.
    const res = await fetch(`${BASE_URL}/memoria/curacion/ejecutar`, { method: 'POST', headers, body: '{}' })
    assert.equal(res.status, 200, `esperaba 200 al ejecutar la curacion, recibido ${res.status}`)
    const resultado = await res.json()
    assert.equal(resultado.ok, true)
    assert.ok(resultado.episodicosArchivados >= 1, `episodicosArchivados (${resultado.episodicosArchivados}) debe incluir al menos la observacion sembrada`)
    assert.ok(Number.isInteger(resultado.duplicadosPodados), 'debe devolver duplicadosPodados como numero')
    assert.ok(Number.isInteger(resultado.relacionesChequeadas), 'debe devolver relacionesChequeadas como numero')
    console.log(`OK: ejecutarCuracionNocturna devuelve metricas validas (${JSON.stringify(resultado)})`)

    // 3. El episodico pasa a archivado; el semantico permanece activo.
    const estados = await fetch(`${BASE_URL}/memoria?estado=archivado&capa=episodica`, { headers })
    const archivados = await estados.json()
    assert.ok(archivados.some((o) => o.id === obsEpisodica), 'la observacion episodica sembrada debe quedar archivada')
    console.log('OK: la observacion episodica de hace 31 dias queda archivada')

    const activas = await fetch(`${BASE_URL}/memoria?estado=activo&capa=semantica`, { headers })
    const semanticasActivas = await activas.json()
    assert.ok(semanticasActivas.some((o) => o.id === obsSemantica), 'la observacion semantica sembrada debe seguir activa')
    console.log('OK: la observacion semantica de hace 31 dias permanece activa (nunca expira)')

    // 4b. Tras completar, el lease debe quedar liberado (no activo).
    const leasesActivos = await fetch(`${BASE_URL}/leases`, { headers })
    const activos = await leasesActivos.json()
    assert.ok(!activos.some((l) => l.recurso === 'curacion_nocturna_memoria'), 'el lease de curacion no debe seguir activo tras terminar')
    console.log('OK: el lease de curacion nocturna se libera correctamente al terminar')
  } catch (e) {
    console.error('--- salida de wrangler dev ---')
    console.error(salidaDev)
    throw e
  } finally {
    try {
      if (process.platform === 'win32' && dev.pid) {
        execSync(`taskkill /pid ${dev.pid} /T /F`, { stdio: 'ignore' })
      } else {
        dev.kill()
      }
    } catch {}
  }
}

main().catch((e) => {
  console.error('FALLO:', e.message)
  process.exit(1)
})
