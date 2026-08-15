-- PostgREST exposes JWT claims through request.jwt.claims on current releases.
-- Keep compatibility with the legacy per-claim setting while allowing the
-- OAuth-authenticated Edge Function's service-role client through the RPC
-- boundary without weakening validation for API-secret callers.

create or replace function app.assert_api_secret(p_secret text)
returns void
language plpgsql
stable
security definer
set search_path = public, app
as $$
declare
  request_role text;
begin
  request_role := coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );

  if request_role = 'service_role' then
    return;
  end if;

  if not app.api_validate_secret(p_secret) then
    raise exception 'unauthorized api secret' using errcode = '42501';
  end if;
end;
$$;
