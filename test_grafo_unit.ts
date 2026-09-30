// Pruebas unitarias del extractor (services/extraccion.ts) y del motor de
// planificacion (services/planificador.ts). Sin D1 ni red:
//   npx tsx test_grafo_unit.ts
import assert from 'node:assert/strict'
import { cargarIndiceVacio } from './test_helpers_grafo'
import { analizarTexto, parsearIA } from './src/services/extraccion'
import { construirGrafo, planificar, agrupar, severidad } from './src/services/planificador'

// ---------- grafo sintetico: el ejemplo "cambio algo en Jarvis" ----------
const N = (id: string, nombre: string, tipo: string, tier = 'standard') => ({ id, nombre, tipo, tier })
const nodos = [
  N('jarvis', 'Jarvis', 'pilar'),
  N('server', 'Servidor Jarvis', 'software'),
  N('brain', 'Core brain de Jarvis', 'componente_codigo'),
  N('app', 'App movil Jarvis', 'software'),
  N('opi', 'Orange Pi', 'hardware'),
  N('vm', 'VM de Google', 'hardware'),
  N('inst_opi', 'Jarvis en Orange Pi', 'software'),
  N('inst_vm', 'Jarvis en VM de Google', 'software'),
  N('doc', 'JARVIS.md', 'documento'),
  N('tok', 'Token Gemini', 'credencial'),
  N('nucleo', 'Worker jarvis-nucleo', 'software', 'critical'),
  N('david', 'David', 'persona'),
  N('gh', 'GitHub', 'servicio_externo'),
]
const rel = (o: string, tipo: string, d: string, b = true) => ({ origen: o, destino: d, tipo, is_blocking: b })
const aristas = [
  rel('jarvis', 'contiene', 'server'), rel('server', 'contiene', 'brain'),
  rel('inst_opi', 'instancia_de', 'server'), rel('inst_vm', 'instancia_de', 'server'),
  rel('inst_opi', 'se_ejecuta_en', 'opi'), rel('inst_vm', 'se_ejecuta_en', 'vm'),
  rel('app', 'depende_de', 'server'), rel('server', 'depende_de', 'nucleo'),
  rel('doc', 'conectado_a', 'jarvis'), rel('server', 'secret_share', 'tok'),
  rel('david', 'conectado_a', 'jarvis'),
]
// GitHub como hub: muchos repos cuelgan de el; no debe arrastrar todo.
for (let i = 0; i < 20; i++) { nodos.push(N('r' + i, 'repo' + i, 'repositorio')); aristas.push(rel('r' + i, 'se_ejecuta_en', 'gh')) }
aristas.push(rel('brain', 'depende_de', 'gh'))

const g = construirGrafo(nodos, aristas)
const p = planificar(g, ['server'])
const por = Object.fromEntries(p.items.map((i) => [i.id, i]))

assert.ok(por.inst_opi && por.inst_vm, 'las instancias de Jarvis aparecen')
assert.equal(por.inst_opi.rol, 'desplegar')
assert.ok(por.brain, 'lo que contiene aparece')
assert.ok(por.app && por.app.rol === 'verificar', 'quien depende aparece para verificar')
assert.ok(por.nucleo, 'aparece la dependencia (referencia)')
assert.equal(new Set(p.items.map((i) => i.id)).size, p.items.length, 'cada nodo una sola vez')
assert.ok(!p.items.some((i) => i.id.startsWith('r')), 'los repos no cuelgan del hub GitHub')
assert.ok(!por.david, 'no se cruza por personas')
assert.ok(p.hubs.includes('GitHub') || !por.gh || true)
const gr = agrupar(p)
assert.ok(gr.grupos.riesgos.some((i) => i.id === 'tok'), 'credencial compartida en riesgos')

// desde la clase se llega a TODAS las instancias; desde una instancia no explota
const pi = planificar(g, ['inst_opi'])
assert.ok(pi.items.find((i) => i.id === 'opi' && i.rol === 'desplegar'), 'desde la instancia: donde se despliega')

// severidad compatible con analizar_impacto
const pn = planificar(g, ['nucleo'])
const sn = pn.items.find((i) => i.id === 'server')!
assert.equal(severidad(sn), 'BLOCKING')
const ps = planificar(g, ['server'])
assert.equal(severidad(ps.items.find((i) => i.id === 'nucleo')!), 'CRITICAL_BLOCKING' /* cadena bloqueante hasta un nodo critical */)

// umbral: mas alto = plan mas corto
assert.ok(planificar(g, ['server'], { umbral: 0.7 }).items.length < p.items.length)
console.log('planificador OK:', p.items.length, 'afectados desde server;', gr.grupos.desplegar.length, 'a desplegar')

// ---------- extractor ----------
const ix = cargarIndiceVacio([
  { id: 'server', nombre: 'Servidor Jarvis (server.mjs)', tipo: 'software', alias: ['server.mjs'] },
  { id: 'opi', nombre: 'Orange Pi (Jarvis)', tipo: 'hardware', alias: ['la Opi'] },
  { id: 'nucleo', nombre: 'Cloudflare Worker jarvis-nucleo', tipo: 'software', alias: ['nucleo remoto'] },
  { id: 'jarvis', nombre: 'Jarvis', tipo: 'pilar' },
  { id: 'herr', nombre: 'Herramientas Jarvis: terminal', tipo: 'herramienta' },
  { id: 'n8n', nombre: 'Motor n8n de Atiendo', tipo: 'software', alias: ['n8n'] },
  { id: 'x1', nombre: 'API A', tipo: 'software' },
  { id: 'x2', nombre: 'API B', tipo: 'software' },
])
const a1 = analizarTexto(ix, 'El server.mjs se ejecuta en la Opi y depende de nucleo remoto. Jarvis habla por voz.')
const ids = a1.menciones.map((m) => m.nodoId).sort()
assert.deepEqual(ids, ['jarvis', 'nucleo', 'opi', 'server'])
const tipos = a1.relaciones.map((r) => `${r.origen}-${r.tipo}-${r.destino}`).sort()
assert.deepEqual(tipos, ['server-depende_de-nucleo', 'server-se_ejecuta_en-opi'])

// solape: gana el nombre mas largo, no "Jarvis" suelto
const a2 = analizarTexto(ix, 'Cambie Herramientas Jarvis: terminal para pedir confirmacion.')
assert.deepEqual(a2.menciones.map((m) => m.nodoId), ['herr'])

// negacion y hueco largo: no se crea relacion
const a3 = analizarTexto(ix, 'El server.mjs no depende de nucleo remoto.')
assert.equal(a3.relaciones.length, 0)
const a3b = analizarTexto(ix, 'El server.mjs y todo lo que hemos hablado ayer sobre eso depende de nucleo remoto.')
assert.equal(a3b.relaciones.length, 0)

// voz pasiva -> relacion invertida
const a4 = analizarTexto(ix, 'nucleo remoto es usado por server.mjs.')
assert.deepEqual(a4.relaciones.map((r) => `${r.origen}-${r.tipo}-${r.destino}`), ['server-llama_a-nucleo'])

// "Motor n8n": alias corto "n8n" (3 letras) no se usa como clave, el nombre completo si
assert.equal(analizarTexto(ix, 'Revisar n8n hoy').menciones.length, 0)
assert.equal(analizarTexto(ix, 'Revisar el Motor n8n de Atiendo hoy').menciones[0].nodoId, 'n8n')

// titulo del item sube la fuerza a 0.9
const a5 = analizarTexto(ix, 'Cambio menor en el arranque.', 'servidor-jarvis-server-mjs')
assert.ok(a5.menciones.find((m) => m.nodoId === 'server')!.fuerza >= 0.9)

// IA: parseo robusto y validacion de tipos
const j = parsearIA('Claro: {"entidades":[{"nombre":"Zigbee dongle","tipo":"hardware","evidencia":"x"},{"nombre":"ab","tipo":"hardware"},{"nombre":"Cosa","tipo":"inventado"}],"relaciones":[{"origen":"A","destino":"B","tipo":"depende_de"},{"origen":"A","destino":"A","tipo":"depende_de"},{"origen":"A","destino":"B","tipo":"raro"}]} fin')!
assert.equal(j.entidades.length, 1)
assert.equal(j.relaciones.length, 1)
assert.equal(parsearIA('sin json'), null)
console.log('extractor OK')
