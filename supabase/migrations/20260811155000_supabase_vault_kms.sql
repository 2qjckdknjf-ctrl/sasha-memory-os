-- Managed KMS path via supabase_vault (vault.create_secret / decrypted_secrets)

CREATE OR REPLACE FUNCTION app.api_vault_kms_put(
  p_secret text,
  p_vault_ref text,
  p_plaintext text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
DECLARE
  v_ref text := nullif(btrim(p_vault_ref), '');
  v_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'vault_ref required';
  END IF;
  IF p_plaintext IS NULL OR btrim(p_plaintext) = '' THEN
    RAISE EXCEPTION 'plaintext required';
  END IF;

  SELECT s.id INTO v_id
  FROM vault.secrets s
  WHERE s.name = v_ref
  LIMIT 1;

  IF v_id IS NULL THEN
    v_id := vault.create_secret(p_plaintext, v_ref, 'memory-os connector token');
  ELSE
    PERFORM vault.update_secret(v_id, p_plaintext, v_ref, 'memory-os connector token');
  END IF;

  RETURN jsonb_build_object('ok', true, 'vaultRef', v_ref, 'secretId', v_id, 'backend', 'supabase_vault');
END;
$$;

CREATE OR REPLACE FUNCTION app.api_vault_kms_get(
  p_secret text,
  p_vault_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
DECLARE
  v_ref text := nullif(btrim(p_vault_ref), '');
  v_plain text;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'vault_ref required';
  END IF;

  SELECT d.decrypted_secret INTO v_plain
  FROM vault.decrypted_secrets d
  WHERE d.name = v_ref
  LIMIT 1;

  IF v_plain IS NULL THEN
    RETURN jsonb_build_object('found', false, 'vaultRef', v_ref, 'backend', 'supabase_vault');
  END IF;

  RETURN jsonb_build_object(
    'found', true,
    'vaultRef', v_ref,
    'plaintext', v_plain,
    'backend', 'supabase_vault'
  );
END;
$$;

CREATE OR REPLACE FUNCTION app.api_vault_kms_delete(
  p_secret text,
  p_vault_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, app, vault, extensions
AS $$
DECLARE
  v_ref text := nullif(btrim(p_vault_ref), '');
  v_id uuid;
BEGIN
  PERFORM app.assert_api_secret(p_secret);
  IF v_ref IS NULL THEN
    RAISE EXCEPTION 'vault_ref required';
  END IF;

  SELECT s.id INTO v_id
  FROM vault.secrets s
  WHERE s.name = v_ref
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    DELETE FROM vault.secrets WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'vaultRef', v_ref, 'deleted', v_id IS NOT NULL, 'backend', 'supabase_vault');
END;
$$;

CREATE OR REPLACE FUNCTION public.api_vault_kms_put(p_secret text, p_vault_ref text, p_plaintext text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_vault_kms_put(p_secret, p_vault_ref, p_plaintext) $$;

CREATE OR REPLACE FUNCTION public.api_vault_kms_get(p_secret text, p_vault_ref text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_vault_kms_get(p_secret, p_vault_ref) $$;

CREATE OR REPLACE FUNCTION public.api_vault_kms_delete(p_secret text, p_vault_ref text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public, app
AS $$ SELECT app.api_vault_kms_delete(p_secret, p_vault_ref) $$;

GRANT EXECUTE ON FUNCTION app.api_vault_kms_put(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_vault_kms_get(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION app.api_vault_kms_delete(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_vault_kms_put(text, text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_vault_kms_get(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.api_vault_kms_delete(text, text) TO anon, authenticated, service_role;
