# SEVEN Bridge — Cloudflare test v1

Bridge remoto de teste entre o plugin/agente SEVEN e a extensão SEVEN Operator.

## Arquitetura

Plugin/agente -> Cloudflare Worker -> Durable Object por código -> WebSocket -> Extensão.

- Código do dispositivo: 6 dígitos, permanente até o usuário gerar outro.
- `secret` da extensão: segredo forte e invisível; o código sozinho não autentica a extensão.
- `SEVEN_AGENT_KEY`: segredo do lado do plugin/agente, configurado como Secret no Worker.
- Durable Object usa WebSocket Hibernation (`ctx.acceptWebSocket`) e armazenamento SQLite.

## Endpoints

- `GET /health`
- `POST /v1/device/register` body `{code, secret, meta?}`
- `GET /v1/device/connect?code=XXXXXX&secret=...` (WebSocket upgrade)
- `POST /v1/device/revoke` body `{code, secret}`
- `GET /v1/status?code=XXXXXX` + `Authorization: Bearer <SEVEN_AGENT_KEY>`
- `POST /v1/push` + auth; body `{code, command}`
- `GET /v1/result?code=XXXXXX&id=<uuid>` + auth

## Cloudflare

1. Importe este repositório como Worker.
2. Configure o Secret `SEVEN_AGENT_KEY` (32+ caracteres aleatórios).
3. Deploy.
4. Teste `/health`.

Com Wrangler:

```bash
npm install
npx wrangler secret put SEVEN_AGENT_KEY
npm run deploy
```

Não commite o valor de `SEVEN_AGENT_KEY`.
