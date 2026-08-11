-- Shared encrypted connector vault (cross-process; Postgres holds ciphertext only)

CREATE TABLE IF NOT EXISTS connector_vault_blobs (
  vault_ref text PRIMARY KEY,
  ciphertext bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE connector_vault_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_vault_blobs FORCE ROW LEVEL SECURITY;

-- No direct client policies — only SECURITY DEFINER RPCs with API secret.
REVOKE ALL ON TABLE connector_vault_blobs FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION app.api_vault_put(
  p_secret text,
  p_vault_ref text,
  p_ciphertext text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  IF p_vault_ref IS NULL OR btrim(p_vault_ref) = '' THEN
    RAISE EXCEPTION 'vault_ref required';
  END IF;
  IF p_ciphertext IS NULL OR btrim(p_ciphertext) = '' THEN
    RAISE EXCEPTION 'ciphertext required';
  END IF;

  INSERT INTO connector_vault_blobs (vault_ref, ciphertext, updated_at)
  VALUES (btrim(p_vault_ref), decode(p_ciphertext, 'base64'), now())
  ON CONFLICT (vault_ref) DO UPDATE
  SET ciphertext = EXCLUDED.ciphertext,
      updated_at = now();

  RETURN jsonb_build_object('vaultRef', btrim(p_vault_ref), 'ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION app.api_vault_get(
  p_secret text,
  p_vault_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  v_blob connector_vault_blobs%ROWTYPE;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  SELECT * INTO v_blob
  FROM connector_vault_blobs
  WHERE vault_ref = btrim(p_vault_ref);

  IF NOT FOUND THEN
    RETURN jsonb_build_object('vaultRef', btrim(p_vault_ref), 'found', false);
  END IF;

  RETURN jsonb_build_object(
    'vaultRef', v_blob.vault_ref,
    'found', true,
    'ciphertext', encode(v_blob.ciphertext, 'base64'),
    'updatedAt', v_blob.updated_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_vault_delete(
  p_secret text,
  p_vault_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app
AS $$
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  DELETE FROM connector_vault_blobs WHERE vault_ref = btrim(p_vault_ref);
  RETURN jsonb_build_object('vaultRef', btrim(p_vault_ref), 'ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.api_vault_put(p_secret text, p_vault_ref text, p_ciphertext text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_vault_put(p_secret, p_vault_ref, p_ciphertext) $$;

CREATE OR REPLACE FUNCTION public.api_vault_get(p_secret text, p_vault_ref text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_vault_get(p_secret, p_vault_ref) $$;

CREATE OR REPLACE FUNCTION public.api_vault_delete(p_secret text, p_vault_ref text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_vault_delete(p_secret, p_vault_ref) $$;

GRANT EXECUTE ON FUNCTION app.api_vault_put(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_vault_get(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_vault_delete(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_vault_put(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_vault_get(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_vault_delete(text, text) TO anon, authenticated, service_role;
