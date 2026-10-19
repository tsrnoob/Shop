-- Generic 550 ml water, given free with Menu B (not sold alone). Cost is an estimate; change it on the Products tab.
insert into public.products (id, name_cn, name_en, meta, image_url, price, cost, stock, purchased, active, preorder_ok, sort, category, on_shelf)
values ('water-550', '矿泉水 550ml', 'Still water 550 ml', '550 ml 瓶装 · bottle', 'img/water.svg', null, 0.30, 0, 0, true, false, 210, 'water', false)
on conflict (id) do nothing;
update public.bundle_slots set options = array['water-550'] where bundle_id = 'set-b' and is_gift and options = '{}';
