# M8 GitHub webhook receiver

Этот slice добавляет **receiver**, а не GitHub App install flow. Полноценная GitHub App интеграция остаётся **M10**.

## Endpoint

- `POST /v1/webhooks/github?connection_id=<connector-account-uuid>`

`connection_id` обязателен для manual repo webhook: receiver должен понимать, к какому уже подключенному GitHub connection привязать delivery.

## Что обрабатывается

- `ping` — быстрый health/handshake ACK
- `repository` с `action=created` или `action=publicized`
- `public` — трактуется как publicized repository
- `push` — только enqueue существующего connector sync job

На `repository.created/publicized` API:

1. берет repository из webhook payload;
2. добавляет/обновляет его в `connections.metadata.collections`;
3. вызывает существующий `upsertProjectFromConnector`;
4. сохраняет последний delivery в `connector_cursors` (`stream = github:webhook`);
5. enqueue-ит существующий `connector.sync.requested` job.

Новый repo по умолчанию выбран для sync, если пользователь заранее не исключил его из connection collections.

## Подпись

- Используется `X-Hub-Signature-256`.
- Если задан `MEMORY_OS_GITHUB_WEBHOOK_SECRET`, подпись обязательна и проверяется HMAC SHA-256.
- Без секрета unsigned delivery разрешены **только** в `MEMORY_OS_ENV=local|test`.
- В production/staging без секрета receiver запрос не принимает.

## Manual repo webhook в GitHub

Для каждого repo, который должен сигналить в Memory OS:

1. Откройте **Settings → Webhooks → Add webhook**.
2. `Payload URL`:
   - `https://<api-host>/v1/webhooks/github?connection_id=<connector-account-uuid>`
3. `Content type`: `application/json`
4. `Secret`:
   - тот же, что в `MEMORY_OS_GITHUB_WEBHOOK_SECRET`
5. Выберите events:
   - `Just the push event`
   - `Repository`
   - `Public`

Этого достаточно для M8 receiver slice. GitHub App install / org-wide install / marketplace остаются вне scope до M10.
