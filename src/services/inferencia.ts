// Inferencia de campos para nodos NUEVOS. Tres capas, de barata a cara:
//  1) reglas por patron del nombre  2) grafo existente (padre, hermanos)  3) IA (Workers AI, opcional)
// Todo lo inferido va con confianza y motivo; lo que manda el agente nunca se pisa.
import type { Env } from '../types'
import { normalizarNombre, type Indice, type NodoIndice } from './clasificador'

export type Sug<T> = { valor: T; confianza: number; motivo: string }
export type Sugerido = {
  tipo?: Sug<string>
  tecnologia?: Sug<string>
  tema?: Sug<string>
  descripcion?: Sug<string>
  padre?: Sug<{ id: string; nombre: string }>
}

export function tokensNombre(nombre: string): string[] {
  return normalizarNombre(nombre.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/\./g, ' ')).split(' ').filter(Boolean)
}

const REGLAS_TIPO: { re: RegExp; tipo: string; conf: number; motivo: string }[] = [
  { re: /\.(cls|trigger|apex|mjs|js|ts|py|sh|cmp|html)$/i, tipo: 'componente_codigo', conf: 0.75, motivo: 'extension de codigo' },
  { re: /\b(controller|controlador|handler|queueable|batch|trigger|service|helper|util|utils|lwc)\b/, tipo: 'componente_codigo', conf: 0.7, motivo: 'sufijo/palabra de clase' },
  { re: /^repo\b|\brepositorio\b/, tipo: 'repositorio', conf: 0.75, motivo: 'prefijo repo' },
  { re: /\.(md|pdf|docx?)$|\b(documento|guia|manual|readme)\b/i, tipo: 'documento', conf: 0.7, motivo: 'documento/guia' },
  { re: /\b(workflow|flujo|flow|pipeline)\b/, tipo: 'workflow', conf: 0.65, motivo: 'palabra workflow/flujo' },
  { re: /\b(d1|database|sqlite|postgres|mysql|kv|r2|bucket|tabla|base datos)\b/, tipo: 'base_datos', conf: 0.65, motivo: 'palabra de almacenamiento' },
  { re: /\b(token|credencial|secret|apikey|api key|oauth|clave)\b/, tipo: 'credencial', conf: 0.7, motivo: 'palabra de credencial' },
  { re: /\b(esp32|raspberry|orange pi|opi|heltec|altavoz|pc|router|sensor|proxmox|zigbee|dongle|hardware)\b/, tipo: 'hardware', conf: 0.65, motivo: 'palabra de hardware' },
  { re: /\b(bloqueador|bloqueo|pendiente)\b/, tipo: 'bloqueador', conf: 0.6, motivo: 'palabra de bloqueo' },
  { re: /\b(worker|servidor|server|api|backend|frontend|panel|web|app)\b/, tipo: 'software', conf: 0.6, motivo: 'palabra de software' },
]

const TECNOLOGIAS: { re: RegExp; tec: string; claves: string[] }[] = [
  { re: /\b(apex|controller|controlador|queueable|cls)\b|__c\b/i, tec: 'apex', claves: ['apex'] },
  { re: /\blwc\b/i, tec: 'lwc', claves: ['lwc'] },
  { re: /\bsalesforce\b|\bsfdc\b/i, tec: 'salesforce', claves: ['salesforce'] },
  { re: /\bn8n\b/i, tec: 'n8n', claves: ['n8n'] },
  { re: /\b(worker|d1|r2|cloudflare)\b/i, tec: 'cloudflare', claves: ['worker', 'cloudflare'] },
  { re: /\b(whatsapp|waba|meta)\b/i, tec: 'whatsapp', claves: ['whatsapp', 'waba'] },
  { re: /\b(gemini|llm)\b/i, tec: 'gemini', claves: ['gemini'] },
]

const TEMAS: [RegExp, string][] = [
  [/\b(agente|agent|ia|ai|gemini|llm|copilot)\b/, 'agente-ia'],
  [/\b(pedido|pedidos|order|orders|carrito|checkout)\b/, 'pedidos'],
  [/\b(producto|productos|catalogo|product)\b/, 'catalogo'],
  [/\b(cliente|clientes|customer|customers)\b/, 'clientes'],
  [/\b(pago|pagos|stripe|paypal|payment)\b/, 'pagos'],
  [/\b(email|gmail|mail|correo)\b/, 'email'],
  [/\b(whatsapp|waba)\b/, 'whatsapp'],
  [/\b(voz|voice|audio|speak)\b/, 'voz'],
  [/\b(calendar|cita|citas|agenda)\b/, 'agenda'],
  [/\b(sentinel|monitor|error|alerta)\b/, 'monitorizacion'],
  [/\b(entrega|delivery|envio|reparto)\b/, 'entregas'],
]

const TIPOS_PADRE = new Set(['software', 'servicio_externo', 'workflow', 'base_datos', 'pilar', 'repositorio'])

export function sugerir(ix: Indice, e: { nombre: string; tipo?: string; descripcion?: string }): Sugerido {
  const out: Sugerido = {}
  const toks = tokensNombre(e.nombre)
  const plano = toks.join(' ')
  const crudo = e.nombre

  // Capa 1: reglas
  if (!e.tipo) {
    for (const r of REGLAS_TIPO) {
      if (r.re.test(crudo) || r.re.test(plano)) { out.tipo = { valor: r.tipo, confianza: r.conf, motivo: r.motivo }; break }
    }
  }
  const tec = TECNOLOGIAS.find((t) => t.re.test(crudo) || t.re.test(plano))
  if (tec) out.tecnologia = { valor: tec.tec, confianza: 0.7, motivo: 'patron en el nombre' }
  for (const [re, tema] of TEMAS) {
    if (re.test(plano)) { out.tema = { valor: tema, confianza: 0.7, motivo: 'palabra clave en el nombre' }; break }
  }

  // Capa 2: grafo. Padre = donde viven los nodos que ya usan la misma tecnologia.
  if (tec) {
    const claves = tec.claves
    const menciona = (n: NodoIndice) => claves.some((k) => n.norm.includes(k) || (n.desc ? normalizarNombre(n.desc).includes(k) : false))
    const pares = ix.nodos.filter((n) => n.estado !== 'deprecado' && n.padres.length > 0 && menciona(n))
    const padresPares = new Set(pares.flatMap((n) => n.padres))
    if (pares.length > 0 && padresPares.size === 1) {
      const p = ix.porId.get([...padresPares][0])
      if (p) out.padre = { valor: { id: p.id, nombre: p.nombre }, confianza: 0.85, motivo: `${pares.length === 1 ? 'el unico nodo' : `los ${pares.length} nodos`} que usa${pares.length === 1 ? '' : 'n'} ${tec.tec} vive${pares.length === 1 ? '' : 'n'} en ${p.nombre}` }
    }
    if (!out.padre) {
      const cand = ix.nodos.filter((n) => n.estado !== 'deprecado' && TIPOS_PADRE.has(n.tipo) && claves.some((k) => n.norm.includes(k)))
      if (cand.length === 1) out.padre = { valor: { id: cand[0].id, nombre: cand[0].nombre }, confianza: 0.8, motivo: `unico nodo con "${claves[0]}" en el nombre` }
      else if (cand.length > 1) {
        const propios = toks.filter((t) => !claves.includes(t))
        const punt = cand.map((n) => ({ n, s: propios.filter((t) => n.norm.includes(t) || (n.desc ? normalizarNombre(n.desc).includes(t) : false)).length })).sort((a, b) => b.s - a.s)
        if (punt[0].s > 0 && punt[0].s > (punt[1]?.s ?? 0)) out.padre = { valor: { id: punt[0].n.id, nombre: punt[0].n.nombre }, confianza: 0.55, motivo: 'coincidencia de palabras con la descripcion del candidato' }
      }
    }
  }

  // Descripcion de plantilla (baja confianza; la IA la mejora)
  if (!e.descripcion) {
    const partes = [out.tipo?.valor || e.tipo || 'nodo', out.tecnologia ? `(${out.tecnologia.valor})` : '', out.padre ? `de ${out.padre.valor.nombre}` : '', out.tema ? `- tematica ${out.tema.valor}` : ''].filter(Boolean)
    out.descripcion = { valor: `${e.nombre}: ${partes.join(' ')}`, confianza: 0.4, motivo: 'plantilla' }
  }
  return out
}

// Capa 3: Workers AI. Devuelve descripcion y tema; ignora errores (best-effort).
export async function inferirIA(env: Env, e: { nombre: string; tipo?: string }, contexto: string[]): Promise<{ descripcion?: string; tema?: string } | null> {
  if (!env.AI) return null
  const prompt =
    `Eres un catalogador de infraestructura. Nodo: "${e.nombre}"${e.tipo ? ` (tipo ${e.tipo})` : ''}. ` +
    `Nodos existentes: ${contexto.slice(0, 15).join('; ')}. ` +
    `Responde SOLO un JSON {"descripcion": "una frase en espanol, max 140 caracteres", "tema": "una o dos palabras en kebab-case"}. No inventes datos que no se deduzcan del nombre.`
  try {
    const r: any = await Promise.race([
      env.AI.run('@cf/meta/llama-3.1-8b-instruct' as any, { messages: [{ role: 'user', content: prompt }], max_tokens: 160 } as any),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 8000)),
    ])
    const txt: string = typeof r?.response === 'string' ? r.response : ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0])
    const desc = typeof j.descripcion === 'string' ? j.descripcion.slice(0, 200) : undefined
    const tema = typeof j.tema === 'string' ? normalizarNombre(j.tema).replace(/ /g, '-').slice(0, 40) : undefined
    return { descripcion: desc, tema }
  } catch {
    return null
  }
}
