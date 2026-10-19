-- =====================================================================
--  v12: pause selling (stock kept) + a message for customers.
--   owner_set_shop_state('open' | 'paused' | 'closed', message):
--     open   – normal selling, message cleared
--     paused – nobody can order what's in stock, stock is KEPT (lectures etc.)
--     closed – every stock goes to 0 (end of the day)
--   While paused or closed customers see stock as 0, so only preorders work,
--   and the message is shown big at the top of the shop.
-- =====================================================================
alter table public.settings add column if not exists shop_paused boolean not null default false;
alter table public.settings add column if not exists status_message text;

create or replace function public.owner_set_shop_state(p_state text, p_message text default null) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare n int := 0; msg text := nullif(btrim(left(coalesce(p_message, ''), 300)), '');
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  if p_state = 'closed' then
    update products set stock = 0 where stock <> 0;
    get diagnostics n = row_count;
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

-- change only the message (while paused or closed)
create or replace function public.owner_set_status_message(p_message text) returns void
language plpgsql volatile security definer set search_path = public, private as $$
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  update settings set status_message = nullif(btrim(left(coalesce(p_message, ''), 300)), '') where id = 1;
end $$;

create or replace function public.get_shop() returns json
language sql stable security definer set search_path = public, private as $$
  select json_build_object(
    'settings', (select json_build_object(
        'shop_name', shop_name, 'wechat_contact', wechat_contact, 'locations', locations,
        'preorder_days', preorder_days, 'max_qty', max_qty, 'notice', notice, 'shop_open', shop_open, 'shop_paused', shop_paused, 'status_message', status_message, 'ad_client', ad_client, 'ad_slot', ad_slot,
        'earliest_preorder', private.berlin_today() + preorder_days)
      from settings where id = 1),
    'products', coalesce((select json_agg(json_build_object(
        'id', id, 'name_cn', name_cn, 'name_en', name_en, 'meta', meta, 'image_url', image_url,
        'price', price, 'stock', case when (select shop_open from settings where id = 1) then stock else 0 end, 'preorder_ok', preorder_ok,
        'category', category, 'on_shelf', on_shelf) order by sort, created_at)
      from products where active), '[]'::json),
    'bundles', coalesce((select json_agg(x.j order by x.sort, x.created_at) from (
        select b.sort, b.created_at, json_build_object(
          'id', b.id, 'name_cn', b.name_cn, 'name_en', b.name_en, 'description', b.description,
          'slots', (select coalesce(json_agg(json_build_object(
              'id', s.id, 'label_cn', s.label_cn, 'label_en', s.label_en, 'category', s.category,
              'qty', s.qty, 'is_gift', s.is_gift,
              'options', (select coalesce(json_agg(p.id order by p.sort, p.created_at), '[]'::json)
                          from products p where p.id = any (s.options) and p.active)
            ) order by s.sort, s.id), '[]'::json)
            from bundle_slots s where s.bundle_id = b.id),
          'combos', (select json_agg(json_build_object('p', c.picks, 'price', c.price, 'retail', c.retail))
                     from private.bundle_combos(b.id) c)
        ) as j
        from bundles b
        where b.active and exists (select 1 from private.bundle_combos(b.id))
      ) x), '[]'::json)
  )
$$;
