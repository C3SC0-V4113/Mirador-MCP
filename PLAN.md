# Plan de construcción — `mirador-mcp`

> Documento de arranque en frío. Este repo empieza **vacío**. Leé este plan entero
> antes de escribir código. Las rutas a otros proyectos son absolutas (Windows,
> `E:\Repositorios\...`).

## 1. Qué es Mirador y dónde encaja este servicio

Mirador es un chatbot ejecutivo para un CEO: responde preguntas de negocio (ingresos,
MRR, churn, proyectos, finanzas) en lenguaje natural, con datos gobernados y citas
documentales. El ecosistema:

- **`mirador-core`** (`E:\Repositorios\chat-core`) — backend Fastify + Prisma +
  PostgreSQL/pgvector. Tiene TODA la lógica: auth, orquestador LLM, capa semántica de
  métricas, SQL Safety, RAG, auditoría. Expone una **Core Internal API** en
  `/internal/core/*` para servicios internos.
- **`mirador-mcp`** (ESTE repo) — un **adapter MCP delgado**. Expone como *tools* MCP
  las capacidades del core, traduciendo cada tool a una llamada a `/internal/core/*`.
  **No tiene base de datos ni llaves LLM.** Valida un `MCP_API_KEY` en la entrada y por
  dentro llama al core con `CORE_SERVICE_TOKEN`.
- **`mirador-web`** — frontend (otro repo, no te incumbe).
- **`mirador-ingestion`** — servicio de ingesta de documentos (otro repo).

Tu único trabajo: ser el puente entre clientes MCP (Claude Desktop, otros agentes) y la
Core Internal API.

## 2. Repos de referencia (leelos antes de codear)

- **`E:\Repositorios\chat-core`** — el core que vas a consumir. Leé en este orden:
  - `docs/api/routes.md` — sección "Internal routes": el contrato exacto de
    `/internal/core/ask` y `/internal/core/schema-catalog`.
  - `docs/adrs/0011-expose-governed-core-pipeline-via-internal-service-to-service-api.md`
    — por qué el contrato es data-first (`CoreAskResult`) y el mapeo de las 6 tools MCP.
  - `src/modules/internal-core/internal-core.mapper.ts` — la forma EXACTA de
    `CoreAskResult` que vas a recibir.
  - `docs/deploy/railway-cloudflare.md` — topología (red privada, gateways).
- **`E:\Repositorios\mcp-server`** (`identity-admin-mcp-server`) — TU MCP previo, hecho
  con `@modelcontextprotocol/sdk`. **Reusá su estructura y su forma de declarar tools.**
  Mirá:
  - `src/index.ts` — cómo crea `McpServer` y registra tools.
  - `src/tools/auth-tools.ts` — patrón de declaración de una tool (input zod + handler).
  - `src/env.ts` — parse de env con Zod.
  - `src/auth.ts` — validación del token de entrada.
  - `src/identity-admin-client.ts` — cliente HTTP a un backend (espejá esto para el core).
  - `AGENTS.md` / `skills-lock.json` — convenciones del repo.

## 3. Decisiones de arquitectura ya tomadas (no re-litigar)

1. **Corre en Railway (Node), NO en Cloudflare Workers.** Tu `identity-admin-mcp-server`
   usa el paquete `agents` (Workers + Durable Objects). Acá **NO se usa `agents`**: el
   tramo `mirador-mcp → /internal` viaja por la **red privada de Railway**, y un Worker
   de Cloudflare no está en esa red. Por eso este MCP es un **server Node** con el
   transport HTTP del SDK (`StreamableHTTPServerTransport`).
2. **Stack:** Node 22 + TypeScript + `@modelcontextprotocol/sdk` + `zod`. Podés usar
   `http`/Fastify para montar el endpoint. pnpm como package manager (igual que tu otro MCP).
3. **El MCP es stateless y delgado:** no persiste nada, no toca DB, no llama a OpenAI.
   Todo eso vive en el core.
4. **Auth en dos capas:** entrada con `MCP_API_KEY` (como `MCP_CLIENT_TOKEN` en tu otro
   repo); salida al core con `Authorization: Bearer CORE_SERVICE_TOKEN`.

## 4. Contrato con el core (lo que vas a consumir)

**`POST {CORE_INTERNAL_URL}/internal/core/ask`**
- Headers: `Authorization: Bearer {CORE_SERVICE_TOKEN}`, `Content-Type: application/json`.
- Body: `{ "question": string, "intent_mode"?: "responder"|"analizar"|"reporte_visual"|"plan" }`.
- Respuesta `200` (`CoreAskResult`):
  ```jsonc
  {
    "trace_id": "string",
    "answer": "string",              // narrativa en texto
    "answer_source": "semantic|fallback_sql|knowledge|mixed|null",
    "metric": "string | null",
    "data": [ /* filas */ ],
    "source_views": ["string"],
    "validated_sql": "string | null",
    "chart_hint": { "type": "string", "x": "string|null", "y": "string" } | null,
    "citations": [ { "document_id": "string", "title": "string", "locator": "string" } ],
    "warnings": ["string"],
    "suggested_questions": ["string"]
  }
  ```
- Errores: `503 INTERNAL_CORE_NOT_CONFIGURED` (token no configurado en el core),
  `401 INTERNAL_CORE_UNAUTHORIZED` (token inválido).

**`GET {CORE_INTERNAL_URL}/internal/core/schema-catalog`** (mismo header) →
`BusinessSchemaContext` (catálogo de views/columnas gobernadas).

## 5. Tools MCP a exponer (mapeo del core)

Todas las tools de datos son facetas de `/ask` y `/schema-catalog`:

| Tool MCP | Cómo se resuelve |
| --- | --- |
| `ask_company_data` | `POST /ask` con la pregunta → devuelve el `CoreAskResult` completo |
| `describe_business_schema` | `GET /schema-catalog` |
| `run_readonly_query` | `POST /ask`; expone `validated_sql` + `data` del resultado |
| `generate_chart_spec` | `POST /ask`; expone `chart_hint` + `data` |
| `search_company_knowledge` | `POST /ask`; expone `answer` + `citations` (camino documental) |
| `suggest_executive_questions` | `POST /ask`; expone `suggested_questions` |

## 6. Nivel BÁSICO (MVP funcional)

Objetivo: un MCP que se conecte y exponga 2 tools contra un core local.

1. `pnpm init`; deps: `@modelcontextprotocol/sdk`, `zod`. dev: `typescript`, `tsx`,
   `@types/node`, `vitest`, `eslint`.
2. `tsconfig.json` estricto (copiá el de `E:\Repositorios\chat-core\tsconfig.json` como base).
3. Estructura (espejá tu `identity-admin-mcp-server`):
   ```text
   src/
     index.ts          # crea el McpServer + monta el transport HTTP Node
     env.ts            # parse de env con zod (MCP_API_KEY, CORE_INTERNAL_URL, CORE_SERVICE_TOKEN, PORT)
     auth.ts           # valida el MCP_API_KEY entrante
     core-client.ts    # fetch a /internal/core/* con CORE_SERVICE_TOKEN (espejá identity-admin-client.ts)
     tools/
       core-tools.ts   # registra ask_company_data y describe_business_schema
   ```
4. Transport: `StreamableHTTPServerTransport` de
   `@modelcontextprotocol/sdk/server/streamableHttp.js`, montado en `POST/GET /mcp`.
   Health en `/healthz`. (Verificá la API actual del SDK; difiere del handler
   `agents/mcp` de tu otro repo.)
5. Las 2 tools: input `zod` (`{ question: z.string() }`), handler que llama
   `core-client` y devuelve el resultado como `content` MCP (texto + el JSON estructurado).
6. Verificación local: levantá un `mirador-core` local (ver su README), seteá
   `CORE_INTERNAL_URL=http://localhost:3000` y `CORE_SERVICE_TOKEN` igual al del core.
   Probá con `npx @modelcontextprotocol/inspector` → conectar a `http://localhost:PORT/mcp`
   → listar tools → llamar `ask_company_data` con "¿cómo varió el MRR?".

## 7. Nivel AVANZADO (producción)

1. **Las 6 tools** del mapeo, cada una proyectando los campos relevantes del `CoreAskResult`.
2. **Propagación de trazas:** reenviá un `x-request-id` al core para que la auditoría
   (`query_audit_log`, `client_type=MCP`) correlacione. Devolvé el `trace_id` en la
   respuesta de la tool.
3. **Manejo de errores:** mapeá `401/503` del core a errores MCP claros; timeouts y un
   reintento corto en fallos de red.
4. **`guidance`/prompts MCP:** como `registerGuidance` en tu otro repo — describí al
   cliente qué puede preguntar y cómo. Mejora la UX del agente que consume el MCP.
5. **Tests** con vitest (mockeá `core-client`); typecheck + lint en CI.
6. **`railway.json`** (Nixpacks): `healthcheckPath: "/healthz"`, `startCommand` que
   arranca el server Node, restart `ON_FAILURE`. Copiá la forma del de
   `E:\Repositorios\chat-core\railway.json`.
7. **Deploy Railway:** mismo proyecto/región que `mirador-core` para **private
   networking**. `CORE_INTERNAL_URL` = hostname **interno** de Railway del core (no el
   público). Variables: `MCP_API_KEY`, `CORE_INTERNAL_URL`, `CORE_SERVICE_TOKEN`, `PORT`.
8. **Cloudflare — MCP API Gateway:** poné un gateway de Cloudflare frente a la URL
   **pública** de este MCP (entrada de clientes externos), con rate limiting y WAF. Ese
   gateway protege la entrada; el tramo `mcp → core` sigue por red privada.

## 8. Variables de entorno

| Variable | Descripción |
| --- | --- |
| `MCP_API_KEY` | Token que los clientes MCP deben presentar (auth de entrada) |
| `CORE_INTERNAL_URL` | URL interna de `mirador-core` en Railway (red privada) |
| `CORE_SERVICE_TOKEN` | Token service-to-service; debe coincidir con el del core |
| `PORT` | Railway lo inyecta |

## 9. Verificación end-to-end

- `GET /healthz` → `200`.
- MCP Inspector lista las tools.
- `ask_company_data` "¿cómo varió el MRR?" → respuesta con `answer` + `data` + `trace_id`.
- En el core, aparece una fila en `query_audit_log` con `client_type='MCP'`.
- Pregunta documental → `citations` no vacías.

## 10. Convenciones

- Documentación en español técnico (igual que el ecosistema Mirador).
- Identificadores, comentarios de código y UI strings en inglés.
- Un ADR por decisión estructural (mirá `E:\Repositorios\chat-core\docs\adrs\` como modelo).
