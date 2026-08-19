UPDATE connector_definitions
SET
  capabilities = '["repositories.read","pull_requests.read","issues.read","events.webhook"]'::jsonb,
  supports = coalesce(supports, '{}'::jsonb) || '{"webhooks":true,"live_fetch":true}'::jsonb
WHERE id = 'github';
