// Catalogo de tools MCP de Veronica: nombre, description y inputSchema
// (JSON Schema, con enum + description por campo) de cada tool v1, segun
// contrato-mcp-veronica.md. Cada tool es una envoltura fina que llama al
// mismo sub-app Hono que ya atiende el endpoint REST equivalente (via
// app.request(), nunca logica duplicada ni acceso directo a D1).
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
const NODO_TIPOS = ['software', 'hardware', 'credencial', 'pilar', 'servicio_externo', 'componente_codigo'] as const
const NODO_TIERS = ['standard', 'critical'] as const
const RELACION_TIPOS = ['se_ejecuta_en', 'contiene', 'instancia_de', 'depende_de', 'llama_a', 'secret_share', 'conectado_a'] as const
const ASIGNABLES = ['antigravity', 'claude', 'jarvis', 'david'] as const
const PRIORIDADES = ['critica', 'alta', 'media', 'baja'] as const
const ESTADOS_OBJETIVO = ['pendiente', 'en_progreso', 'en_curso', 'bloqueado', 'completado', 'hecho', 'cancelado'] as const
const NIVELES_CONFIRMACION = ['N1', 'N2', 'N3'] as const
const ACTORES = ['antigravity', 'claude', 'jarvis'] as const
const TITULARES_LEASE = ['antigravity', 'claude', 'jarvis'] as const
const LISTAS = ['ideas'] as const

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
    description: 'Guarda una observacion nueva en memoria. Llamala sin que David lo pida cuando cuente algo duradero (un hecho, una preferencia, un procedimiento).',
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
    description: 'Lanza bajo demanda la curacion nocturna (normalmente corre por cron): archiva observaciones episodicas de mas de 30 dias. Solo llamar manualmente si hace falta forzarla fuera de horario.',
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
      'Da de alta un nodo del grafo de infraestructura: un sistema, servicio, credencial logica o dispositivo nuevo y duradero (no un experimento de un dia). Clasifica el nombre contra los nodos existentes antes de escribir: si ya existe uno casi identico devuelve ese id sin duplicar (duplicado:true); si hay un parecido ambiguo, responde 409 con candidatos en vez de crear - usa forzar:true solo cuando ya comprobaste que es un nodo realmente distinto.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'unico, identifica el nodo' },
        tipo: { type: 'string', enum: NODO_TIPOS, description: 'pilar = Jarvis/Antigravity/Claude como conceptos; servicio_externo = APIs de terceros; componente_codigo = solo si hace falta granularidad de clase/modulo concreto' },
        descripcion: { type: 'string' },
        tier: { type: 'string', enum: NODO_TIERS, default: 'standard', description: 'critical = si este nodo falla o cambia, el impacto se considera severo por defecto en analizar_impacto' },
        autor: { type: 'string' },
        forzar: { type: 'boolean', description: 'true = crear igualmente aunque el clasificador detecte un posible duplicado (409). Usalo solo tras revisar los candidatos devueltos y confirmar que es distinto.' },
      },
      required: ['nombre', 'tipo'],
      additionalProperties: false,
    },
  },
  {
    name: 'nodo_clasificar',
    description:
      'Preview de solo lectura: compara un nombre de nodo (candidato a crear) contra los nodos existentes y devuelve decision (existe_exacto|posible_duplicado|nuevo) mas hasta 5 candidatos puntuados por similitud. No escribe nada. Llamala cuando tengas dudas antes de nodo_crear, o para inspeccionar por que este devolvio 409.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'nombre candidato a evaluar, tal cual se usaria en nodo_crear' },
        tipo: { type: 'string', enum: NODO_TIPOS, description: 'opcional; si se indica, solo compara contra nodos del mismo tipo' },
      },
      required: ['nombre'],
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
      'Blast radius: quien se rompe si este nodo cambia o falla. Llamala SIEMPRE antes de una accion de riesgo medio/alto/irreversible sobre un nodo existente. Devuelve un veredicto que puede bloquear la accion hasta que David confirme (confirmacion_crear).',
    inputSchema: { type: 'object', properties: { nodo: { type: 'string', description: 'id del nodo sobre el que se va a actuar' } }, required: ['nodo'], additionalProperties: false },
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
