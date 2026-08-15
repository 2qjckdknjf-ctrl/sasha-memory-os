-- Let the authenticated Edge Function call the existing RPC boundary with its
-- built-in service-role identity while preserving exact validation for legacy
-- Memory OS API-secret clients.

create or replace function app.api_validate_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select exists (
    select 1
    from app.runtime_config
    where key = 'api_secret'
      and value is not null
      and p_secret is not distinct from value
  )
$$;

revoke all on function app.api_validate_secret(text) from public;

create or replace function public.api_validate_secret(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public, app
as $$
  select app.api_validate_secret(p_secret)
$$;

revoke all on function public.api_validate_secret(text) from public;
grant execute on function public.api_validate_secret(text) to anon, authenticated, service_role;

create or replace function app.assert_api_secret(p_secret text)
returns void
language plpgsql
stable
security definer
set search_path = public, app
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return;
  end if;

  if not app.api_validate_secret(p_secret) then
    raise exception 'unauthorized api secret' using errcode = '42501';
  end if;
end;
$$;
