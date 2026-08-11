-- Manually mark a single outbox event published (ops recovery)

CREATE OR REPLACE FUNCTION app.api_publish_outbox_event(
  p_secret text,
  p_subject_id uuid,
  p_event_id uuid,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, extensions
AS $$
DECLARE
  v_event outbox_events%ROWTYPE;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  PERFORM app.with_subject(p_subject_id);

  SELECT * INTO v_event
  FROM outbox_events
  WHERE id = p_event_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'outbox event not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT app.is_workspace_member(v_event.workspace_id) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  UPDATE outbox_events
  SET
    published_at = coalesce(published_at, now()),
    attempts = attempts + 1,
    last_error = coalesce(nullif(btrim(p_error), ''), last_error)
  WHERE id = v_event.id
  RETURNING * INTO v_event;

  RETURN jsonb_build_object(
    'id', v_event.id,
    'eventType', v_event.event_type,
    'publishedAt', v_event.published_at,
    'attempts', v_event.attempts,
    'lastError', v_event.last_error
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.api_publish_outbox_event(
  p_secret text,
  p_subject_id uuid,
  p_event_id uuid,
  p_error text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, app
AS $$
  SELECT app.api_publish_outbox_event(p_secret, p_subject_id, p_event_id, p_error)
$$;

GRANT EXECUTE ON FUNCTION app.api_publish_outbox_event(text, uuid, uuid, text)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_publish_outbox_event(text, uuid, uuid, text)
  TO anon, authenticated, service_role;
