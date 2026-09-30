// Catalogo de tools MCP de Veronica: nombre, description y inputSchema
// (JSON Schema, con enum + description por campo) de cada tool v1, segun
// contrato-mcp-veronica.md. Cada tool es una envoltura fina que llama al
// mismo sub-app Hono que ya atiende el endpoint REST equivalente (via
// app.request(), nunca logica duplicada ni acceso directo a D1).
import { NODO_TIPOS, NODO_TIERS } from '../types/nodos'

export type ToolDef = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

const CAPAS = ['episodica', 'semantica', 'procedimental'] as const
const ORIGENES = ['david', 'inferido', 'herramienta'] as const
const CONFIANZAS = ['baja', 'media', 'alta'] as const
const AUTORES = ['antigravity', 'claude', 'jarvis', 'david'] as const
const ESTADOS_MEMORIA = ['activo', 'archivado'] as const
const ETIQUETAS = ['candyla', 'atiendo', 'jarvis-app', 'arquitectura', 'autonomo', 'meta-sistema', 'idea', 'personal'] as const
const RELACION_TIPOS = ['se_ejecuta_en', 'contiene', 'instancia_de', 'depende_de', 'llama_a', 'secret_share', 'conectado_a'] as const
const ASIGNABLES = ['antigravity', 'claude', 'jarvis', 'david'] as const
const PRIORIDADES = ['critica', 'alta', 'media', 'baja'] as const
const ESTADOS_OBJETIVO = ['pendiente', 'en_progreso', 'en_curso', 'bloqueado', 'completado', 'hecho', 'cancelado'] as const
const NIVELES_CONFIRMACION = ['N1', 'N2', 'N3'] as const
const ACTORES = ['antigravity', 'claude', 'jarvis'] as const
const TITULARES_LEASE = ['antigravity', 'claude', 'jarvis'] as const
const LISTAS = ['ideas'] as const

const TIPO_DESC = 'pilar = Jarvis/Antigravity/Claude como conceptos; servicio_externo = APIs/servicios de terceros; componente_codigo = clase/modulo/script concreto; repositorio, base_datos, workflow, documento, persona, bloqueador, herramienta segun su nombre'
const NODO_CAMPOS_PROPS = {
  nombre: { type: 'string', description: 'unico, identifica el nodo' },
  descripcion: { type: 'string', description: 'que es y para que sirve; mejora mucho la deteccion de duplicados' },
  autor: { type: 'string' },
  origen: { type: 'string', description: 'de donde sale: repo y ruta, URL, o "David lo dijo"' },
  identificador: { type: 'string', description: 'clave externa unica (URL del repo, nombre del Worker, Id de Salesforce); si coincide con la de otro nodo es el mismo' },
  alias: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'otros nombres con los que se conoce' },
  estado: { type: 'string', enum: ['activo', 'deprecado', 'bloqueado'] },
  data: { type: 'object', description: 'JSON libre con los campos del nodo (max 8 KB): endpoints, tablas, campos, versiones...', additionalProperties: true },
} as const

export const TOOLS: ToolDef[] = [
  {
    name: 'memoria_listar',
    description:
      'Lista observaciones de memoria activas (o archivadas), filtrables por capa, estado, autor o etiqueta. Para explorar por categoria, no para buscar por contenido (usa memoria_buscar para eso).',
    inputSchema: {
      type: 'object',
      properties: {
        capa: { type: 'string', enum: CAPAS, description: 'episodica = algo que paso, ligado a una fecha; semantica = un hecho estable, no ligado a un momento; procedimental = como se hace algo' },
        estado: { type: 'string', enum: ESTADOS_MEMORIA, default: 'activo', description: 'activo = vigente; archivado = borrado logico o sustituido por una correccion' },
        autor: { type: 'string', enum: AUTORES, description: 'quien genero la observacion' },
        tag: { type: 'string', enum: ETIQUETAS, description: "etiqueta tematica; usa 'idea' para ver la lista de ideas, 'personal' para gustos o preferencias de David" },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'memoria_buscar',
    description:
      "Busqueda de texto completo (FTS5, ranking bm25) sobre las observaciones activas. Usala cuando se pregunta por un dato concreto ('ya hicimos esto?', 'cuando?', 'quien?') en vez de asumir la respuesta.",
    inputSchema: {
      type: 'object',
      properties: {
        consulta: { type: 'string', description: 'texto a buscar; coincidencia lexica, no por significado - usa las mismas palabras que esperarias encontrar' },
      },
      required: ['consulta'],
      additionalProperties: false,
    },
  },
  {
    name: 'memoria_recordar',
    description: 'Guarda una observacion nueva en memoria. Llamala sin que David lo pida cuando cuente algo duradero (un hecho, una preferencia, un procedimiento). Tras guardar, Veronica detecta los nodos del grafo de los que habla (enlaces nodo_memoria) y, si el texto lo dice explicitamente y el origen es fiable, crea relaciones; lo dudoso o los nodos nuevos quedan como propuesta (propuesta_listar). Las observaciones enlazadas a un nodo no caducan en la curacion nocturna.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'opcional: nombre del item/entidad al que pertenece la observacion; si se omite se deriva del texto' },
        texto: { type: 'string', description: 'la observacion en si, redactada de forma clara y autocontenida' },
        capa: { type: 'string', enum: CAPAS, description: 'episodica = algo que paso; semantica = algo que es; procedimental = como se hace algo' },
        origen: { type: 'string', enum: ORIGENES, description: 'david = lo dijo el directamente; inferido = lo dedujo el agente; herramienta = lo genero un proceso' },
        confianza: { type: 'string', enum: CONFIANZAS, description: 'alta cuando origen=david; baja/media cuando el agente infiere' },
        autor: { type: 'string', enum: AUTORES },
        etiquetas: { type: 'array', items: { type: 'string', enum: ETIQUETAS }, description: "al menos una; usa 'personal' para gustos o preferencias de David sin proyecto asociado" },
        nodos: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'opcional: nombres, alias o ids de los nodos del grafo a los que se refiere la observacion. Aunque lo omitas, Veronica detecta por el texto los nodos mencionados y enlaza sola; usalo cuando sepas con certeza de que nodo trata.' },
      },
      required: ['texto', 'capa', 'origen', 'autor', 'etiquetas'],
      additionalProperties: false,
    },
  },
  {
    name: 'memoria_corregir',
    description: 'Sustituye una observacion por una version corregida (archiva la antigua y la enlaza a la nueva). Usa esto en vez de memoria_recordar cuando el dato ya existia pero estaba mal clasificado o desactualizado.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'id de la observacion a corregir' },
        texto: { type: 'string' },
        capa: { type: 'string', enum: CAPAS },
        origen: { type: 'string', enum: ORIGENES },
        confianza: { type: 'string', enum: CONFIANZAS },
        autor: { type: 'string', enum: AUTORES },
        etiquetas: { type: 'array', items: { type: 'string', enum: ETIQUETAS } },
        nodos: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'opcional: nombres, alias o ids de los nodos del grafo a los que se refiere la observacion. Aunque lo omitas, Veronica detecta por el texto los nodos mencionados y enlaza sola; usalo cuando sepas con certeza de que nodo trata.' },
      },
      required: ['id', 'texto', 'capa'],
      additionalProperties: false,
    },
  },
  {
    name: 'memoria_olvidar',
    description: 'Archiva una observacion (borrado logico, no destructivo) con un motivo.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        motivo: { type: 'string', description: 'por que deja de ser vigente' },
        autor: { type: 'string', enum: AUTORES },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'memoria_curar',
    description: 'Lanza bajo demanda la curacion nocturna (normalmente corre por cron): archiva observaciones episodicas de mas de 30 dias (salvo las enlazadas a algun nodo). Solo llamar manualmente si hace falta forzarla fuera de horario.',
    inputSchema: { type: 'object', properties: { autor: { type: 'string', enum: ACTORES } }, additionalProperties: false },
  },
  {
    name: 'memoria_esquema',
    description: 'Devuelve los valores validos de cada campo de memoria (capas, origenes, confianzas, autores, estados, etiquetas), leidos del mismo esquema Zod que valida - para no tener que memorizarlos ni adivinarlos.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lista_anadir',
    description:
      "Anade un elemento a una lista (hoy: 'ideas'). Por debajo crea una observacion de memoria con la etiqueta 'idea'. No la etiquetes con un proyecto (etiqueta_proyecto) que no venga al caso - omitelo si la idea es general.",
    inputSchema: {
      type: 'object',
      properties: {
        lista: { type: 'string', enum: LISTAS },
        texto: { type: 'string' },
        etiqueta_proyecto: { type: 'string', enum: ['candyla', 'atiendo', 'jarvis-app', 'meta-sistema'], description: 'opcional, solo si la idea es realmente de ese proyecto' },
        autor: { type: 'string', enum: AUTORES },
      },
      required: ['lista', 'texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'lista_listar',
    description: 'Lista los elementos de una lista.',
    inputSchema: { type: 'object', properties: { lista: { type: 'string', enum: LISTAS } }, required: ['lista'], additionalProperties: false },
  },
  {
    name: 'nodo_crear',
    description:
      'Da de alta UN nodo del grafo (sistema, servicio, repo, credencial logica, dispositivo...). Clasifica antes de escribir por nombre, alias, identificador, tipo y descripcion: si ya existe uno casi identico devuelve su id sin duplicar (duplicado:true); si hay un parecido ambiguo, responde 409 con candidatos - usa forzar:true solo tras comprobar que es distinto. Para varios nodos usa nodo_lote (mucho mas rapido).',
    inputSchema: {
      type: 'object',
      properties: {
        ...NODO_CAMPOS_PROPS,
        tipo: { type: 'string', enum: NODO_TIPOS, description: TIPO_DESC },
        tier: { type: 'string', enum: NODO_TIERS, default: 'standard', description: 'critical = si este nodo falla o cambia, el impacto se considera severo por defecto en analizar_impacto' },
        forzar: { type: 'boolean', description: 'true = crear igualmente aunque el clasificador detecte un posible duplicado (409). Usalo solo tras revisar los candidatos devueltos.' },
      },
      required: ['nombre', 'tipo'],
      additionalProperties: false,
    },
  },
  {
    name: 'nodo_clasificar',
    description:
      'Solo lectura. Compara un nodo candidato (cuantos mas campos mandes, mejor: tipo, descripcion, alias, identificador, origen) contra los existentes y devuelve decision (existe_exacto|posible_duplicado|nuevo) con candidatos y motivo. Si es nuevo, devuelve ademas `sugerido`: tipo, tecnologia, tema, padre y descripcion inferidos, cada uno con confianza y motivo. ia:true anade descripcion/tema con Workers AI. No escribe nada.',
    inputSchema: {
      type: 'object',
      properties: {
        ...NODO_CAMPOS_PROPS,
        tipo: { type: 'string', enum: NODO_TIPOS, description: 'opcional; si se indica se usa para afinar la comparacion (tipo distinto penaliza el parecido)' },
        ia: { type: 'boolean', description: 'true = completar descripcion/tema con IA (mas lento)' },
      },
      required: ['nombre'],
      additionalProperties: false,
    },
  },
  {
    name: 'nodo_lote',
    description:
      'Carga masiva de nodos (y relaciones) en UNA llamada: hasta 100 items y 300 relaciones. Cada item se clasifica (existe/duplicado/nuevo) y los NUEVOS se insertan solos completando tipo, tema, tecnologia y relacion con su padre cuando hay confianza. modo:"simular" (por defecto) no escribe nada y devuelve que haria; modo:"aplicar" escribe. Duplicados posibles quedan como pendiente, los que no se pueden tipar como incompleto, tier critical siempre pendiente salvo forzar. Reenviar el mismo lote_id es idempotente. Relaciones por nombre o id, se crean en segunda pasada. Deshacer: DELETE /nodos/lote/:lote_id. Registra el resultado con registro_escribir.',
    inputSchema: {
      type: 'object',
      properties: {
        modo: { type: 'string', enum: ['simular', 'aplicar'], default: 'simular' },
        lote_id: { type: 'string', description: 'identificador del lote (para idempotencia y deshacer); si falta se genera' },
        ia: { type: 'boolean', default: false, description: 'completar descripcion/tema de los nuevos con Workers AI (max 25 por llamada)' },
        actualizar: { type: 'boolean', default: false, description: 'si un item ya existe, fusionar alias, data y campos vacios en vez de ignorarlo' },
        sugerencias: { type: 'boolean', default: true, description: 'crear automaticamente la relacion con el padre inferido (confianza >= 0.75)' },
        autor: { type: 'string' },
        origen: { type: 'string', description: 'origen por defecto de los items (repo/ruta/URL/quien lo dijo)' },
        items: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: {
            type: 'object',
            properties: {
              ...NODO_CAMPOS_PROPS,
              id: { type: 'string' },
              tipo: { type: 'string', enum: NODO_TIPOS, description: 'opcional: si falta se infiere' },
              tier: { type: 'string', enum: NODO_TIERS },
              forzar: { type: 'boolean' },
            },
            required: ['nombre'],
            additionalProperties: false,
          },
        },
        relaciones: {
          type: 'array',
          maxItems: 300,
          items: {
            type: 'object',
            properties: {
              origen: { type: 'string', description: 'nombre, alias o id' },
              destino: { type: 'string', description: 'nombre, alias o id' },
              tipo: { type: 'string', enum: RELACION_TIPOS },
              descripcion: { type: 'string' },
              confianza: { type: 'string', enum: CONFIANZAS },
              is_blocking: { type: 'boolean', default: true },
            },
            required: ['origen', 'destino', 'tipo'],
            additionalProperties: false,
          },
        },
      },
      required: ['items'],
      additionalProperties: false,
    },
  },
  {
    name: 'nodo_listar',
    description: 'Lista nodos del grafo, opcionalmente por tipo.',
    inputSchema: { type: 'object', properties: { tipo: { type: 'string', enum: NODO_TIPOS } }, additionalProperties: false },
  },
  {
    name: 'relacion_crear',
    description: 'Crea una relacion tipada entre dos nodos ya existentes. Llamala al establecer una dependencia nueva (A llama a B, A usa la credencial de B, A corre sobre B).',
    inputSchema: {
      type: 'object',
      properties: {
        origen: { type: 'string', description: 'nombre o id del nodo origen' },
        destino: { type: 'string', description: 'nombre o id del nodo destino' },
        tipo: {
          type: 'string',
          enum: RELACION_TIPOS,
          description:
            "se_ejecuta_en/contiene/instancia_de = jerarquia o topologia ('donde vive X?'); depende_de/llama_a = dependencia operativa, alimentan analizar_impacto ('que se rompe si toco X?'); secret_share = comparten una credencial; conectado_a = integracion sin dependencia dura",
        },
        descripcion: { type: 'string' },
        confianza: { type: 'string', enum: CONFIANZAS },
        is_blocking: { type: 'boolean', default: true, description: 'true = si el destino falla, bloquea al origen (entra en el blast radius); false = relacion informativa' },
        autor: { type: 'string' },
      },
      required: ['origen', 'destino', 'tipo'],
      additionalProperties: false,
    },
  },
  {
    name: 'relacion_listar',
    description: 'Lista relaciones, opcionalmente filtradas por nodo o tipo.',
    inputSchema: {
      type: 'object',
      properties: {
        nodo: { type: 'string', description: 'nombre o id del nodo; devuelve las relaciones donde aparece como origen o destino' },
        tipo: { type: 'string', enum: RELACION_TIPOS },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'analizar_impacto',
    description:
      'Blast radius: quien se rompe si este nodo cambia o falla. Llamala SIEMPRE antes de una accion de riesgo medio/alto/irreversible sobre un nodo existente. Devuelve un veredicto que puede bloquear la accion hasta que David confirme (confirmacion_crear). Cada nodo afectado sale UNA vez, con distancia y relevancia; para planificar un desarrollo completo usa planificar_cambio, que ademas agrupa por accion e incluye recuerdos.',
    inputSchema: { type: 'object', properties: { nodo: { type: 'string', description: 'id del nodo sobre el que se va a actuar' } }, required: ['nodo'], additionalProperties: false },
  },
  {
    name: 'planificar_cambio',
    description:
      'MAPA MENTAL antes de actuar: dada una tarea (texto libre) y/o nodos, devuelve TODO lo que hay que tocar, agrupado por accion: tocar (codigo/config), desplegar (instancias y maquinas donde vive), verificar (quien depende o llama), docs, riesgos (credenciales, bloqueadores) y dudoso (baja relevancia). Cada elemento trae relevancia 0-1 y el camino que lo justifica. Incluye tambien contexto: recuerdos de memoria enlazados a esos nodos (por que se hizo, con que planteamiento, que cambios). Si algun nodo critico queda afectado el veredicto es REQUIERE_CONFIRMACION. El orquestador debe llamarla ANTES de mandar cualquier desarrollo a otro pilar y pasar el resultado en el encargo. Al terminar, llama a plan_cerrar con el plan_id.',
    inputSchema: {
      type: 'object',
      properties: {
        tarea: { type: 'string', description: 'que se va a hacer, en lenguaje natural; se detectan los nodos por sus nombres y alias' },
        nodos: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'opcional: nodos de partida (nombre, alias o id) si ya sabes de cuales trata' },
        autor: { type: 'string', enum: AUTORES },
        profundidad: { type: 'integer', minimum: 1, maximum: 8, default: 5, description: 'saltos maximos desde los nodos de partida' },
        umbral: { type: 'number', minimum: 0.05, maximum: 0.9, default: 0.25, description: 'relevancia minima para incluir un nodo; sube el valor para un plan mas corto' },
        contexto: { type: 'boolean', default: true, description: 'incluir recuerdos de memoria enlazados' },
        detalle: { type: 'boolean', default: false, description: 'true = anade distancia y tier a cada elemento' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'plan_cerrar',
    description:
      'Cierra un plan de planificar_cambio indicando que nodos se tocaron de verdad. Veronica compara con lo previsto, devuelve aciertos, lo que el mapa no preveia (faltaron) y lo previsto que no hizo falta (sobraron), y guarda como propuesta las relaciones que faltaban para que el mapa mejore con el uso.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: { type: 'string', description: 'plan_id devuelto por planificar_cambio' },
        tocados: { type: 'array', items: { type: 'string' }, maxItems: 100, description: 'nodos realmente modificados o desplegados (nombre, alias o id)' },
        autor: { type: 'string', enum: AUTORES },
        notas: { type: 'string', description: 'opcional: que se aprendio' },
      },
      required: ['plan_id', 'tocados'],
      additionalProperties: false,
    },
  },
  {
    name: 'grafo_exportar',
    description: 'Exporta el grafo completo por paginas (nodos o relaciones). Para visores, copias o analisis. Sigue el campo siguiente hasta que sea null.',
    inputSchema: {
      type: 'object',
      properties: {
        parte: { type: 'string', enum: ['nodos', 'relaciones'], default: 'nodos' },
        desde: { type: 'integer', minimum: 0, default: 0, description: 'desplazamiento (usa el valor de siguiente de la pagina anterior)' },
        limite: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
        descripciones: { type: 'boolean', default: false, description: 'incluir las 160 primeras letras de la descripcion de cada nodo' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'relacion_lote',
    description:
      'Crea relaciones en masa (hasta 300) resolviendo origen/destino por nombre, alias o id. modo=simular no escribe; modo=aplicar escribe. Idempotente: lo que ya existe sale como ya_existe. Se deshace con DELETE /nodos/lote/<lote_id>?confirmar=true.',
    inputSchema: {
      type: 'object',
      properties: {
        lote_id: { type: 'string', maxLength: 64, description: 'identificador del lote (para deshacer y auditar)' },
        modo: { type: 'string', enum: ['simular', 'aplicar'], default: 'simular' },
        autor: { type: 'string' },
        relaciones: {
          type: 'array', minItems: 1, maxItems: 300,
          items: {
            type: 'object',
            properties: {
              origen: { type: 'string', description: 'nombre, alias o id. Convencion: "origen TIPO destino" (A depende_de B, A se_ejecuta_en B, A contiene B)' },
              destino: { type: 'string' },
              tipo: { type: 'string', enum: RELACION_TIPOS },
              descripcion: { type: 'string' },
              confianza: { type: 'string', enum: CONFIANZAS, default: 'media' },
              is_blocking: { type: 'boolean', default: true, description: 'true = si el destino cae, el origen deja de funcionar' },
            },
            required: ['origen', 'destino', 'tipo'],
            additionalProperties: false,
          },
        },
      },
      required: ['relaciones'],
      additionalProperties: false,
    },
  },
  {
    name: 'memoria_por_nodo',
    description: 'Recuerdos de memoria enlazados a un nodo (por que se hizo, planteamiento, cambios), ordenados por utilidad (fuerza del enlace, capa, confianza, recencia). Con vecinos=true incluye tambien los de los nodos directamente relacionados.',
    inputSchema: {
      type: 'object',
      properties: {
        nodo: { type: 'string', description: 'nombre, alias o id del nodo' },
        vecinos: { type: 'boolean', default: false },
        max: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
      },
      required: ['nodo'],
      additionalProperties: false,
    },
  },
  {
    name: 'memoria_enlazar_lote',
    description:
      'Enlaza observaciones de memoria con nodos en masa. Dos usos: (1) enlaces:[{nodo, observacion, tipo, fuerza}] manuales; (2) auto:true reprocesa observaciones existentes con las reglas del extractor (paginado con desde/limite; sigue siguiente hasta null). modo=simular no escribe. Con ia:true el extractor tambien propone nodos nuevos (solo como propuesta).',
    inputSchema: {
      type: 'object',
      properties: {
        modo: { type: 'string', enum: ['simular', 'aplicar'], default: 'simular' },
        auto: { type: 'boolean', default: false },
        ia: { type: 'boolean', default: false },
        desde: { type: 'integer', minimum: 0, default: 0 },
        limite: { type: 'integer', minimum: 1, maximum: 200, default: 100 },
        incluir_archivadas: { type: 'boolean', default: false },
        enlaces: {
          type: 'array', maxItems: 300,
          items: {
            type: 'object',
            properties: {
              nodo: { type: 'string', description: 'nombre, alias o id' },
              observacion: { type: 'string', description: 'id de la observacion (memoria_listar / memoria_buscar)' },
              tipo: { type: 'string', enum: ['sobre', 'menciona'], default: 'menciona', description: 'sobre = la observacion trata de ese nodo; menciona = lo cita' },
              fuerza: { type: 'number', minimum: 0, maximum: 1, default: 0.8 },
            },
            required: ['nodo', 'observacion'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'propuesta_listar',
    description: 'Lista las propuestas del extractor (nodos o relaciones nuevas detectadas en memoria o en planes cerrados) pendientes de revisar, con su evidencia y confianza.',
    inputSchema: {
      type: 'object',
      properties: {
        estado: { type: 'string', enum: ['pendiente', 'aprobada', 'rechazada'], default: 'pendiente' },
        clase: { type: 'string', enum: ['nodo', 'relacion'] },
        limite: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'propuesta_resolver',
    description: 'Aprueba (crea el nodo o la relacion) o rechaza propuestas del extractor, en lote. Aprobar un nodo pasa antes por el clasificador: si ya existe algo parecido no se duplica.',
    inputSchema: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 100 },
        decision: { type: 'string', enum: ['aprobar', 'rechazar'] },
        quien: { type: 'string', enum: AUTORES },
      },
      required: ['ids', 'decision', 'quien'],
      additionalProperties: false,
    },
  },
  {
    name: 'objetivo_crear',
    description: 'Crea un objetivo (bus de tareas asincronas entre pilares). Idempotente si se pasa idempotency_key.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: { type: 'string' },
        descripcion: { type: 'string' },
        asignado_a: { type: 'string', enum: ASIGNABLES, description: 'quien debe ejecutarlo' },
        creado_por: { type: 'string', enum: [...ASIGNABLES, 'candyla-sentinel'] },
        prioridad: { type: 'string', enum: PRIORIDADES },
        timeout: { type: 'number', description: 'segundos hasta que el objetivo se considere vencido, opcional' },
        avisar_al_terminar: { type: 'boolean' },
        idempotency_key: { type: 'string', description: 'si se repite, devuelve el objetivo existente en vez de duplicarlo' },
      },
      required: ['titulo', 'asignado_a'],
      additionalProperties: false,
    },
  },
  {
    name: 'objetivo_listar',
    description: 'Lista objetivos (filtrables por estado o asignado_a), o consulta uno por id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'si se pasa, ignora estado/asignado_a y devuelve solo ese objetivo' },
        estado: { type: 'string', enum: ESTADOS_OBJETIVO },
        asignado_a: { type: 'string', enum: ASIGNABLES },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'objetivo_actualizar_estado',
    description: 'Actualiza el estado de un objetivo.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        estado: { type: 'string', enum: ESTADOS_OBJETIVO },
        quien: { type: 'string' },
        resultado_json: { description: 'solo si el estado es final (completado/hecho)' },
        artefactos: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'estado'],
      additionalProperties: false,
    },
  },
  {
    name: 'confirmacion_crear',
    description: 'Crea una solicitud de confirmacion HITL N3. Usala cuando una accion es critica, irreversible, o analizar_impacto devolvio BLOCKED_REQUIRES_CONFIRMATION - nada critico se ejecuta sin que David lo apruebe aqui.',
    inputSchema: {
      type: 'object',
      properties: {
        herramienta: { type: 'string', description: 'que accion se va a ejecutar' },
        args: { description: 'argumentos de esa accion, para que David vea exactamente que se va a hacer' },
        nivel: { type: 'string', enum: NIVELES_CONFIRMACION, default: 'N3' },
        resumen: { type: 'string', description: 'que se va a hacer y por que necesita aprobacion' },
        actor: { type: 'string', enum: ACTORES },
        contexto: { type: 'string' },
        impacto: { type: 'string', description: 'idealmente el resultado de analizar_impacto' },
        timeout: { type: 'number', description: 'segundos hasta que expire si nadie responde (default 1800)' },
      },
      required: ['herramienta', 'resumen'],
      additionalProperties: false,
    },
  },
  {
    name: 'confirmacion_listar',
    description: 'Lista las solicitudes de confirmacion pendientes.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'confirmacion_resolver',
    description: 'Resuelve una confirmacion pendiente. Esta tool la usa David (via Antigravity/la app), no un agente decidiendo por el.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        decision: { type: 'string', enum: ['aprobar', 'rechazar'] },
        quien: { type: 'string', default: 'david' },
        motivo: { type: 'string' },
      },
      required: ['id', 'decision'],
      additionalProperties: false,
    },
  },
  {
    name: 'lease_adquirir',
    description: 'Pide exclusion mutua sobre un recurso compartido (un fichero, un nodo, un workflow de n8n) antes de tocarlo, para que dos pilares no lo modifiquen a la vez.',
    inputSchema: {
      type: 'object',
      properties: {
        recurso: { type: 'string' },
        titular: { type: 'string', enum: TITULARES_LEASE },
        ttl_segundos: { type: 'number', default: 300 },
        motivo: { type: 'string' },
      },
      required: ['recurso', 'titular'],
      additionalProperties: false,
    },
  },
  {
    name: 'lease_liberar',
    description: 'Libera un lease adquirido, en cuanto se termina de usar el recurso. Identifica el lease por (recurso + titular) o por lease_id.',
    inputSchema: {
      type: 'object',
      properties: { recurso: { type: 'string' }, titular: { type: 'string', enum: TITULARES_LEASE }, lease_id: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'lease_listar',
    description: 'Lista los leases activos - consultalo antes de pedir uno nuevo sobre el mismo recurso.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'registro_escribir',
    description: 'Registra una accion ejecutada, para que cualquier pilar pueda consultar que paso sin depender de que otro se lo cuente.',
    inputSchema: {
      type: 'object',
      properties: {
        actor: { type: 'string', enum: AUTORES },
        herramienta: { type: 'string' },
        riesgo: { type: 'string', enum: ['bajo', 'medio', 'alto', 'irreversible'] },
        args: { description: 'argumentos con los que se llamo' },
        resultado: { type: 'string' },
        ok: { type: 'boolean' },
        ms: { type: 'number' },
      },
      required: ['actor', 'herramienta', 'riesgo'],
      additionalProperties: false,
    },
  },
  {
    name: 'registro_consultar',
    description: 'Consulta las ultimas N acciones del log de auditoria.',
    inputSchema: { type: 'object', properties: { n: { type: 'number', default: 50 } }, additionalProperties: false },
  },
  {
    name: 'resumen_cargar',
    description: 'Carga de arranque en frio: memorias prioritarias, objetivos abiertos, confirmaciones N3 pendientes, nodos, relaciones y semaforo de cuotas en una sola llamada. Llamala SIEMPRE al iniciar sesion o tras compactar - nunca en un turno trivial.',
    inputSchema: { type: 'object', properties: { agente_id: { type: 'string', enum: ACTORES } }, additionalProperties: false },
  },
]
