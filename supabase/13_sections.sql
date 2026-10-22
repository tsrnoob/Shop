-- =====================================================================
--  v13: shop sections (tabs): rice, hot pot, breakfast, snacks, drinks.
--  "category" still drives the menu editor; "section" decides the shop tab.
--  The owner page sets both from one "Type" dropdown.
-- =====================================================================
alter table public.products add column if not exists section text
  check (section in ('rice', 'hotpot', 'breakfast', 'snack', 'drink'));

update public.products set section = case
    when id in ('5885', '5888', '5891', '5894') then 'hotpot'
    when category = 'main' then 'rice'
    when id in ('hb-lava', 'tk-melon', 'hb-chestnut') then 'breakfast'
    when category in ('drink', 'water') then 'drink'
    else 'snack' end
 where section is null;

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
        'category', category, 'section', section, 'on_shelf', on_shelf) order by sort, created_at)
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
