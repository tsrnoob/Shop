-- =====================================================================
--  v17: close for the day WITH or WITHOUT clearing the stock,
--       and show customers tomorrow's stock while closed.
--   owner_set_shop_state('closed_keep', msg): closed, stock kept
--   owner_set_shop_state('closed', msg):      closed, stock set to 0 (as before)
--   While closed (not paused) get_shop returns each product's real stock as
--   next_stock, so the shop can show "N tomorrow" and customers can preorder.
--   Additive only.
-- =====================================================================

create or replace function public.owner_set_shop_state(p_state text, p_message text default null) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare n int := 0; msg text := nullif(btrim(left(coalesce(p_message, ''), 300)), '');
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  if p_state = 'closed' then
    update products set stock = 0 where stock <> 0;
    get diagnostics n = row_count;
    update settings set shop_open = false, shop_paused = false, status_message = msg where id = 1;
  elsif p_state = 'closed_keep' then
    update settings set shop_open = false, shop_paused = false, status_message = msg where id = 1;
  elsif p_state = 'paused' then
    update settings set shop_open = false, shop_paused = true, status_message = msg where id = 1;
  elsif p_state = 'open' then
    update settings set shop_open = true, shop_paused = false, status_message = null where id = 1;
  else
    raise exception using errcode = 'P0001', message = 'bad_state';
  end if;
  return json_build_object('state', p_state, 'cleared', n);
end $$;

-- get_shop: add next_stock (real stock while closed, else null)
do $$
declare d text := pg_get_functiondef('public.get_shop()'::regprocedure);
begin
  if position('next_stock' in d) = 0 then
    d := replace(d, $r$'preorder_ok', preorder_ok,$r$,
      $r$'next_stock', case when (select not shop_open and not shop_paused from settings where id = 1) then stock end, 'preorder_ok', preorder_ok,$r$);
    if position('next_stock' in d) = 0 then raise exception 'get_shop: anchor not found'; end if;
    execute d;
  end if;
end $$;
