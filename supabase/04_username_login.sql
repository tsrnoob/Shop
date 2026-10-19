-- =====================================================================
--  v4: customers log in with their username only (no password).
--  Accounts are still created by the owner; switched-off accounts can't log in.
--  Additive only.
-- =====================================================================
create or replace function public.shop_login_username(p_username text) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare c public.customers; t uuid;
begin
  select * into c from public.customers where lower(username) = lower(btrim(coalesce(p_username, '')));
  if not found then
    perform pg_sleep(0.4);   -- slows down anyone trying usernames one after another
    return json_build_object('error', 'bad_login');
  end if;
  if not c.active then return json_build_object('error', 'account_disabled'); end if;
  update public.customers set last_login_at = now() where id = c.id;
  insert into public.customer_sessions (customer_id) values (c.id) returning token into t;
  return json_build_object('token', t, 'username', c.username, 'wechat_id', c.wechat_id);
end $$;
