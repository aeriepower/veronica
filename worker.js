// Sincronizado desde el Worker real en produccion (jarvis-nucleo) el 24-sep-2026.
// El fichero local llevaba desactualizado: faltaban las rutas /nodos y /relaciones
// (v4, 23-sep-2026, ver AGENTS.md seccion 7) y el campo "etiquetas" en POST /memoria.
// De paso, /resumen ahora devuelve memoria completa (sin LIMIT) y el mapa de relaciones.
// Ver AGENTS.md seccion 0 (Regla Cero), seccion 6 (memoria) y seccion 7 (mapa de relaciones).
function json(data, status) {
  if (status === undefined) status = 200;
  return new Response(JSON.stringify(data), { status: status, headers: { 'content-type': 'application/json' } });
}

function id(prefijo) {
  return prefijo + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function ahora() {
  return new Date().toISOString();
}

async function autorizado(request, env) {
  var auth = request.headers.get('authorization') || '';
  return auth === ('Bearer ' + env.TOKEN);
}

export default {
  async fetch(request, env) {
    if (!(await autorizado(request, env))) {
      return json({ error: 'no autorizado' }, 401);
    }

    var url = new URL(request.url);
    var partes = url.pathname.split('/').filter(Boolean);
    var raiz = partes[0];
    var sub = partes[1];
    var db = env.DB;

    try {
      if (raiz === 'memoria') {
        if (request.method === 'GET' && !sub) {
          var capa = url.searchParams.get('capa');
          var q = capa
            ? await db.prepare('SELECT * FROM memoria WHERE estado = ? AND capa = ? ORDER BY fecha DESC').bind('activo', capa).all()
            : await db.prepare('SELECT * FROM memoria WHERE estado = ? ORDER BY fecha DESC').bind('activo').all();
          return json(q.results);
        }

        if (request.method === 'POST' && !sub) {
          var b = await request.json();
          var nuevoId = id('m');
          await db.prepare(
            "INSERT INTO memoria (id, capa, texto, origen, fecha, confianza, revisar, estado, autor, etiquetas) VALUES (?,?,?,?,?,?,?,'activo',?,?)"
          ).bind(nuevoId, b.capa, b.texto, b.origen || 'desconocido', ahora(), b.confianza || 'media', b.revisar || null, b.autor || null, b.etiquetas || null).run();
          return json({ id: nuevoId });
        }

        if (request.method === 'POST' && sub === 'corregir') {
          var b = await request.json();
          var antiguoId = b.id;
          var nuevoId = id('m');
          await db.batch([
            db.prepare("UPDATE memoria SET estado='archivado', sustituido_por=? WHERE id=?").bind(nuevoId, antiguoId),
            db.prepare(
              "INSERT INTO memoria (id, capa, texto, origen, fecha, confianza, revisar, estado, corrige_a, autor, etiquetas) VALUES (?,?,?,?,?,?,?,'activo',?,?,?)"
            ).bind(nuevoId, b.capa, b.texto, b.origen || 'desconocido', ahora(), b.confianza || 'media', b.revisar || null, antiguoId, b.autor || null, b.etiquetas || null),
          ]);
          return json({ id: nuevoId });
        }

        if (request.method === 'POST' && sub === 'olvidar') {
          var b = await request.json();
          await db.prepare(
            "UPDATE memoria SET estado='archivado', motivo_archivo=?, archivado_por=?, archivado_en=? WHERE id=?"
          ).bind(b.motivo || null, b.autor || null, ahora(), b.id).run();
          return json({ ok: true });
        }
      }

      // ---------- NODOS (mapa de relaciones: sistemas/servicios) ----------
      if (raiz === 'nodos') {
        if (request.method === 'GET' && !sub) {
          var tipo = url.searchParams.get('tipo');
          var q = tipo
            ? await db.prepare('SELECT * FROM nodos WHERE tipo = ? ORDER BY nombre').bind(tipo).all()
            : await db.prepare('SELECT * FROM nodos ORDER BY nombre').all();
          return json(q.results);
        }

        if (request.method === 'POST' && !sub) {
          var b = await request.json();
          var nodoId = b.id || id('n');
          await db.prepare(
            'INSERT INTO nodos (id, nombre, tipo, descripcion, creado, autor) VALUES (?,?,?,?,?,?)'
          ).bind(nodoId, b.nombre, b.tipo, b.descripcion || null, ahora(), b.autor || null).run();
          return json({ id: nodoId });
        }
      }

      // ---------- RELACIONES (analisis de impacto) ----------
      if (raiz === 'relaciones') {
        if (request.method === 'GET' && !sub) {
          var nodo = url.searchParams.get('nodo');
          var tipoRel = url.searchParams.get('tipo');
          var q;
          if (nodo && tipoRel) {
            q = await db.prepare('SELECT * FROM relaciones WHERE (origen = ? OR destino = ?) AND tipo = ? ORDER BY creado DESC').bind(nodo, nodo, tipoRel).all();
          } else if (nodo) {
            q = await db.prepare('SELECT * FROM relaciones WHERE origen = ? OR destino = ? ORDER BY creado DESC').bind(nodo, nodo).all();
          } else if (tipoRel) {
            q = await db.prepare('SELECT * FROM relaciones WHERE tipo = ? ORDER BY creado DESC').bind(tipoRel).all();
          } else {
            q = await db.prepare('SELECT * FROM relaciones ORDER BY creado DESC').all();
          }
          return json(q.results);
        }

        if (request.method === 'POST' && !sub) {
          var b = await request.json();
          var relId = id('r');
          await db.prepare(
            'INSERT INTO relaciones (id, origen, destino, tipo, descripcion, confianza, creado, autor) VALUES (?,?,?,?,?,?,?,?)'
          ).bind(relId, b.origen, b.destino, b.tipo, b.descripcion || null, b.confianza || 'media', ahora(), b.autor || null).run();
          return json({ id: relId });
        }
      }

      if (raiz === 'objetivos') {
        if (request.method === 'GET' && !sub) {
          var estado = url.searchParams.get('estado');
          var q = estado
            ? await db.prepare('SELECT * FROM objetivos WHERE estado = ? ORDER BY actualizado DESC').bind(estado).all()
            : await db.prepare('SELECT * FROM objetivos ORDER BY actualizado DESC').all();
          return json(q.results.map(function (r) {
            return Object.assign({}, r, { historial: JSON.parse(r.historial || '[]') });
          }));
        }

        if (request.method === 'POST' && !sub) {
          var b = await request.json();
          var nuevoId = id('o');
          var historialNuevo = [{ estado: b.estado || 'pendiente', cuando: ahora(), quien: b.responsable }];
          await db.prepare(
            'INSERT INTO objetivos (id, titulo, responsable, estado, avisar_al_terminar, historial, creado, actualizado) VALUES (?,?,?,?,?,?,?,?)'
          ).bind(nuevoId, b.titulo, b.responsable, b.estado || 'pendiente', b.avisar_al_terminar ? 1 : 0, JSON.stringify(historialNuevo), ahora(), ahora()).run();
          return json({ id: nuevoId });
        }

        if (request.method === 'POST' && sub) {
          var b = await request.json();
          var actual = await db.prepare('SELECT * FROM objetivos WHERE id=?').bind(sub).first();
          if (!actual) return json({ error: 'no existe' }, 404);
          var historialActual = JSON.parse(actual.historial || '[]');
          if (b.estado && b.estado !== actual.estado) {
            historialActual.push({ estado: b.estado, cuando: ahora(), quien: b.quien || 'desconocido' });
          }
          await db.prepare(
            'UPDATE objetivos SET estado=?, historial=?, actualizado=? WHERE id=?'
          ).bind(b.estado || actual.estado, JSON.stringify(historialActual), ahora(), sub).run();
          return json({ ok: true, estado_anterior: actual.estado, estado: b.estado || actual.estado });
        }
      }

      if (raiz === 'registro') {
        if (request.method === 'GET' && !sub) {
          var n = Number(url.searchParams.get('n') || 50);
          var q = await db.prepare('SELECT * FROM registro ORDER BY ts DESC LIMIT ?').bind(n).all();
          return json(q.results);
        }

        if (request.method === 'POST' && !sub) {
          var b = await request.json();
          var nuevoId = id('r');
          await db.prepare(
            'INSERT INTO registro (id, actor, herramienta, riesgo, args, resultado, ok, ms, ts) VALUES (?,?,?,?,?,?,?,?,?)'
          ).bind(nuevoId, b.actor, b.herramienta, b.riesgo, JSON.stringify(b.args || {}), b.resultado || null, b.ok ? 1 : 0, b.ms || null, ahora()).run();
          return json({ id: nuevoId });
        }
      }

      if (raiz === 'confirmaciones') {
        if (request.method === 'GET' && !sub) {
          var q = await db.prepare("SELECT * FROM confirmaciones WHERE estado='pendiente' ORDER BY creado DESC").all();
          return json(q.results);
        }

        if (request.method === 'POST' && !sub) {
          var b = await request.json();
          var nuevoId = id('c');
          await db.prepare(
            "INSERT INTO confirmaciones (id, herramienta, args, nivel, resumen, actor, estado, creado) VALUES (?,?,?,?,?,?,'pendiente',?)"
          ).bind(nuevoId, b.herramienta, JSON.stringify(b.args || {}), b.nivel, b.resumen || '', b.actor || 'jarvis', ahora()).run();
          return json({ id: nuevoId });
        }

        if (request.method === 'POST' && sub) {
          var b = await request.json();
          await db.prepare(
            'UPDATE confirmaciones SET estado=?, resuelto_por=? WHERE id=?'
          ).bind(b.decision === 'aprobar' ? 'aprobada' : 'rechazada', b.quien || 'david', sub).run();
          return json({ ok: true });
        }
      }

      if (raiz === 'resumen' && request.method === 'GET') {
        var resultados = await Promise.all([
          db.prepare("SELECT * FROM memoria WHERE estado='activo' ORDER BY fecha DESC").all(),
          db.prepare("SELECT * FROM objetivos WHERE estado NOT IN ('hecho','cancelado') ORDER BY actualizado DESC LIMIT 20").all(),
          db.prepare("SELECT * FROM confirmaciones WHERE estado='pendiente'").all(),
          db.prepare('SELECT * FROM nodos ORDER BY nombre').all(),
          db.prepare('SELECT * FROM relaciones ORDER BY creado DESC').all(),
        ]);
        return json({
          memoria: resultados[0].results,
          objetivos: resultados[1].results,
          confirmaciones_pendientes: resultados[2].results,
          nodos: resultados[3].results,
          relaciones: resultados[4].results,
        });
      }

      // ---------- AI TELEMETRÍA Y LÍMITES ----------
      if (raiz === 'ai-limits' && request.method === 'GET') {
        try {
          var q = await db.prepare("SELECT * FROM ai_telemetria ORDER BY ts DESC LIMIT 1").first();
          if (!q) {
            return json({
              configured: true,
              hayDatos: false,
              mensaje: 'Esperando primer snapshot desde el PC',
              ts: ahora(),
              motores: {}
            });
          }
          return json({
            configured: true,
            hayDatos: true,
            ts: q.ts,
            actor: q.actor,
            motores: JSON.parse(q.datos || '{}')
          });
        } catch (errTable) {
          return json({
            configured: true,
            hayDatos: false,
            mensaje: 'Tabla de telemetría pendiente de inicializar',
            ts: ahora(),
            motores: {}
          });
        }
      }

      if (raiz === 'ai-telemetria' && request.method === 'POST') {
        var b = await request.json();
        var nuevoId = id('ait');
        await db.prepare(`
          CREATE TABLE IF NOT EXISTS ai_telemetria (
            id TEXT PRIMARY KEY,
            actor TEXT,
            datos TEXT,
            ts TEXT
          )
        `).run();
        await db.prepare(
          'INSERT INTO ai_telemetria (id, actor, datos, ts) VALUES (?,?,?,?)'
        ).bind(nuevoId, b.actor || 'pc-watcher', JSON.stringify(b.motores || b), ahora()).run();
        return json({ ok: true, id: nuevoId });
      }

      return json({ error: 'ruta no encontrada' }, 404);
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};
