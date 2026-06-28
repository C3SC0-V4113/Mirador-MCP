# mirador-mcp

Adaptador MCP delgado para Mirador Core. Expone tools MCP sobre la Core Internal API (`/internal/core/*`) sin base de datos, sin llaves OpenAI y sin lógica de negocio propia.

## Variables

- `MCP_API_KEY`: token Bearer que deben enviar los clientes MCP.
- `CORE_INTERNAL_URL`: URL interna de `mirador-core` en Railway.
- `CORE_SERVICE_TOKEN`: token service-to-service aceptado por el core.
- `PORT`: puerto HTTP, por defecto `3000`.

## Desarrollo

```bash
pnpm install
pnpm dev
```

Healthcheck:

```bash
curl http://localhost:3000/healthz
```

Endpoint MCP: `http://localhost:3000/mcp` con header `Authorization: Bearer <MCP_API_KEY>`.

## Tools

- `ask_company_data`
- `describe_business_schema`
- `run_readonly_query`
- `generate_chart_spec`
- `search_company_knowledge`
- `suggest_executive_questions`

Todas las tools de datos delegan en `POST /internal/core/ask`; el catálogo delega en `GET /internal/core/schema-catalog`.

## Railway

`railway.json` usa Nixpacks, `pnpm start` y healthcheck en `/healthz`. En producción, `CORE_INTERNAL_URL` debe apuntar al hostname privado de Railway del core.
