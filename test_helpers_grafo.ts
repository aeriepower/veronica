// Helper de pruebas: indice de clasificador en memoria sin D1.
import { anadirAlIndice, nuevoNodoIndice, type Indice } from './src/services/clasificador'

export function cargarIndiceVacio(nodos: { id: string; nombre: string; tipo: string; alias?: string[]; tier?: string }[]): Indice {
  const ix: Indice = { nodos: [], porId: new Map(), porNombre: new Map(), relSet: new Set() }
  for (const n of nodos) anadirAlIndice(ix, nuevoNodoIndice(n))
  return ix
}
