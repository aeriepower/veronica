// Exclusion mutua distribuida sobre la tabla 'leases' (un recurso solo puede
// tener un lease 'activo' a la vez, forzado por idx_leases_recurso_activo).
// Ver AGENTS.md seccion 0 y Tarea [A8-D1-LEASES].

function id(prefijo: string): string {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export async function acquireLease(
  db: D1Database,
  { recurso, titular, ttlSegundos, motivo }: { recurso: string; titular: string; ttlSegundos: number; motivo?: string }
): Promise<{ acquired: true; lease_id: string; expira: string } | { acquired: false; titular_actual: string | null; expira: string | null }> {
  const ahora = new Date()
  const ahoraIso = ahora.toISOString()

  await db
    .prepare("UPDATE leases SET estado='expirado' WHERE recurso = ? AND estado='activo' AND expira <= ?")
    .bind(recurso, ahoraIso)
    .run()

  const leaseId = id('lease')
  const expira = new Date(ahora.getTime() + ttlSegundos * 1000).toISOString()

  try {
    await db
      .prepare("INSERT INTO leases (id, recurso, titular, estado, motivo, adquirido, expira) VALUES (?, ?, ?, 'activo', ?, ?, ?)")
      .bind(leaseId, recurso, titular, motivo ?? null, ahoraIso, expira)
      .run()
    return { acquired: true, lease_id: leaseId, expira }
  } catch {
    const actual = await db
      .prepare("SELECT titular, expira FROM leases WHERE recurso = ? AND estado='activo'")
      .bind(recurso)
      .first<{ titular: string; expira: string }>()
    return { acquired: false, titular_actual: actual?.titular ?? null, expira: actual?.expira ?? null }
  }
}

export async function releaseLease(
  db: D1Database,
  { recurso, titular, lease_id }: { recurso?: string; titular?: string; lease_id?: string }
): Promise<{ released: true }> {
  const liberadoEn = new Date().toISOString()
  if (lease_id) {
    await db
      .prepare("UPDATE leases SET estado='liberado', liberado_en=? WHERE id=? AND estado='activo'")
      .bind(liberadoEn, lease_id)
      .run()
  } else {
    await db
      .prepare("UPDATE leases SET estado='liberado', liberado_en=? WHERE recurso=? AND titular=? AND estado='activo'")
      .bind(liberadoEn, recurso, titular)
      .run()
  }
  return { released: true }
}

export async function getActiveLeases(db: D1Database) {
  const ahoraIso = new Date().toISOString()
  await db.prepare("UPDATE leases SET estado='expirado' WHERE estado='activo' AND expira <= ?").bind(ahoraIso).run()
  const q = await db.prepare("SELECT * FROM leases WHERE estado='activo' ORDER BY adquirido DESC").all()
  return q.results
}
