# SEVEN Bridge / SevenEx 1.1.0

Cloudflare Worker que liga o app **SevenEx** do ChatGPT/Codex ao **SEVEN Operator** no navegador.

## Arquitetura canônica

`ChatGPT/Codex -> SevenEx -> MCP fino -> SEVEN-BRIDGE -> Durable Object/WebSocket -> SEVEN Operator -> Eyes + Hands`

O MCP expõe somente:

- `seven_status` — consulta o browser explicitamente selecionado do usuário autenticado;
- `seven_command` — enfileira exatamente um comando e devolve `commandId` imediatamente;
- `seven_result` — consulta o resultado sem polling interno.

Inteligência, Jobs, Vault, providers e regras de produto não pertencem ao MCP do SevenEx.

## Identidade e autorização

O caminho canônico não recebe `device_code` nas tools e não contém dispositivo padrão.

1. ChatGPT obtém um token OAuth para o recurso SevenEx.
2. O Bridge valida assinatura via JWKS, issuer, `client_id` e audience exata do recurso MCP.
3. O token do usuário termina no Bridge; ele nunca é repassado ao Core.
4. Bridge chama o Core por HMAC permanente serviço-a-serviço.
5. Core resolve `user_id -> workspace ativo -> browser ativo -> session_id + device_code`.
6. Bridge confirma que o Durable Object do device anuncia a mesma `session_id` antes de executar.

Quando um workspace possui mais de um browser, a seleção é explícita; nunca escolher automaticamente por “último visto”.

## Operator contract

Release coordenado: **SevenEx / Bridge / Operator 1.1.0**.

O Operator registra no Bridge versão, protocolo e capacidades. O caminho canônico exige protocolo 1 e as capacidades `vision`, `visionDiff`, `mission` e `collectImages`. Versão incompatível bloqueia comandos em vez de executar silenciosamente com contrato errado.

## Transporte

Bridge/WebSocket é o transporte canônico de comandos e resultados do browser. Não existe fallback de dispositivo global nem rota MCP paralela.

## Higiene de abas

O Bridge preserva a política SEVEN: trabalho em segundo plano, reutilização de abas gerenciadas, foco protegido e fechamento automático somente de abas criadas pela SEVEN. Ações mutáveis devem respeitar o contrato de missão/sequence.

## Endpoints

- `GET /health`
- `POST /v1/device/register`
- `GET /v1/device/connect?code=...&secret=...` — WebSocket da extensão
- `POST /v1/device/revoke`
- `GET /v1/status?code=...` — serviço interno
- `POST /v1/push` — serviço interno
- `GET /v1/result?code=...&id=<uuid>` — serviço interno
- `GET /.well-known/oauth-protected-resource/mcp` — metadata OAuth do SevenEx
- `POST/GET/DELETE /mcp` — único MCP canônico SevenEx

## Deploy gates

Para o fluxo completo de usuário:

- Supabase OAuth Server habilitado;
- Custom Access Token Hook do SevenEx aplicado e habilitado;
- `SEVEN_OPERATOR_SHARED_SECRET` configurado com o mesmo valor no Core Production e no Bridge runtime, sem expor o valor;
- migrations de binding/multiworkspace aplicadas na ordem canônica;
- Operator 1.1.0 distribuído por pacote publicado/assinado;
- E2E de isolamento por usuário/workspace/browser aprovado.

## Desenvolvimento

`npm install --ignore-scripts`

`npm run check`

`npm test`

## Segurança

Nunca commite segredo de serviço, segredo do device, token OAuth ou URL privada de capacidade. Não crie endpoints, tokens ou rotas temporárias de diagnóstico. OAuth bearer não pode atravessar a fronteira do Bridge para outro serviço.
