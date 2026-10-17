\pset pager off
update settings set owner_email = 'me@shop.test';
update products set price = 4.50 where category = 'main';
update products set price = 2.50 where id in ('5889','5890','5896');
update products set stock = 6 where id in ('wl-pc-sour','wl-pc-spicy');
update bundles set price = 7.90 where id = 'set-a';
update bundles set price = 7.50 where id = 'set-b';

create or replace function try(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return 'ERR ' || sqlerrm; end $$;
grant execute on function try(text) to anon, authenticated;

\echo '== owner creates a customer =='
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"me@shop.test"}', false);
select owner_create_customer('alice', 'wxid_alice', 'friend from MI') ->> 'password' as pw \gset
select try($q$select owner_create_customer('ALICE', 'x1', '')$q$) as dup_username;
select try($q$select owner_create_customer('a b', 'x1', '')$q$) as bad_username;
reset role;

\echo '== anon cannot create customers or read them =='
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select try($q$select owner_create_customer('mallory', 'x', '')$q$) as anon_create;
select try($q$select count(*) from customers$q$) as anon_read_customers;
select (select count(*) from customers) as anon_sees_customers, (select count(*) from customer_sessions) as anon_sees_sessions;
select try($q$select place_order('wx_old', 'Garching Forschungszentrum', '', '[{"id":"5890","qty":1}]')$q$) as old_place_order;

\echo '== login =='
select shop_login('alice', 'wrong') as wrong_pw;
select shop_login('Alice', :'pw') ->> 'token' as tok \gset
select shop_me(:'tok') as me;
select try($q$select shop_me('00000000-0000-0000-0000-000000000000')$q$) as fake_session;

\echo '== shop data =='
select json_array_length(get_shop()->'bundles') as bundles, (get_shop()->'settings'->'locations') as locations;
select ((get_shop()->'products'->0)::jsonb ? 'cost') as leaks_cost;
select string_agg(s->>'id' || ':' || (s->>'category') || 'x' || (s->>'qty'), ', ') as set_a_slots
  from json_array_elements((select b from json_array_elements(get_shop()->'bundles') b where b->>'id'='set-a')->'slots') s;
reset role;
select id as slot_main from bundle_slots where bundle_id='set-a' and category='main' \gset
select id as slot_drink from bundle_slots where bundle_id='set-a' and category='drink' \gset
select id as slot_konjac from bundle_slots where bundle_id='set-a' and category='konjac' \gset
set role anon;

\echo '== order: set A (hot pot + CiCi + 2 sour 1 spicy) + 1 millet guoba =='
select shop_place_order(:'tok', 'after 14:00', format('[{"bundle":"set-a","qty":1,"picks":{"%s":{"5888":1},"%s":{"5896":1},"%s":{"wl-pc-sour":2,"wl-pc-spicy":1}}},{"id":"5890","qty":1}]', :'slot_main', :'slot_drink', :'slot_konjac')::jsonb) as ord;
select id, stock from products where id in ('5888','5896','wl-pc-sour','wl-pc-spicy','5890') order by id;

\echo '== bad set picks =='
select try(format($q$select shop_place_order(%L, '', '[{"bundle":"set-a","qty":1,"picks":{"%s":{"5888":1},"%s":{"5896":1},"%s":{"wl-pc-sour":2}}}]')$q$, :'tok', :'slot_main', :'slot_drink', :'slot_konjac')) as konjac_only_2;
select try(format($q$select shop_place_order(%L, '', '[{"bundle":"set-a","qty":1,"picks":{"%s":{"5890":1},"%s":{"5896":1},"%s":{"wl-pc-sour":3}}}]')$q$, :'tok', :'slot_main', :'slot_drink', :'slot_konjac')) as guoba_as_main;
select try(format($q$select shop_place_order(%L, '', '[{"bundle":"set-a","qty":1,"picks":{"%s":{"5888":1},"%s":{"5896":1}}}]')$q$, :'tok', :'slot_main', :'slot_drink')) as missing_slot;
select try(format($q$select shop_place_order(%L, '', '[{"bundle":"set-a","qty":1,"picks":{"%s":{"5888":1},"%s":{"5896":1},"%s":{"wl-pc-mala":3}}}]')$q$, :'tok', :'slot_main', :'slot_drink', :'slot_konjac')) as mala_no_stock;
select try(format($q$select shop_place_order(%L, '', '[{"bundle":"set-b","qty":1,"picks":{}}]')$q$, :'tok')) as set_b_no_water;
select try(format($q$select shop_place_order(%L, '', '[{"id":"wl-pc-sour","qty":1}]')$q$, :'tok')) as buy_gift_alone;
select try(format($q$select shop_place_order(%L, '', '[{"id":"5890","qty":1}]', null, 'Marienplatz')$q$, :'tok')) as other_location;

\echo '== my orders / cancel =='
select json_array_length(shop_my_orders(:'tok')) as my_orders;
select (shop_my_orders(:'tok')->0->'bundles'->0->>'name_cn') as first_bundle_name;
select (shop_my_orders(:'tok')->0->>'code') as code \gset
select shop_cancel_order(:'tok', :'code') ->> 'status' as cancelled;
select id, stock from products where id in ('5888','5896','wl-pc-sour','wl-pc-spicy','5890') order by id;
select shop_logout(:'tok');
select try(format('select shop_my_orders(%L)', :'tok')) as after_logout;

\echo '== lockout after 5 wrong passwords =='
select shop_login('alice','x') ->> 'error' from generate_series(1,5);
select shop_login('alice', :'pw') as right_pw_while_locked;
reset role;

\echo '== owner: reset password, deactivate =='
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"me@shop.test"}', false);
select id as cid from customers where username='alice' \gset
select owner_reset_customer_password(:cid) ->> 'password' as pw2 \gset
select (select count(*) from orders) as owner_sees_orders, (select count(*) from order_bundles) as owner_sees_sets;
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select shop_login('alice', :'pw') as old_pw_after_reset;
select shop_login('alice', :'pw2') ->> 'token' as tok2 \gset
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"me@shop.test"}', false);
select owner_set_customer_active(:cid, false);
reset role;
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select try(format('select shop_me(%L)', :'tok2')) as disabled_session;
select shop_login('alice', :'pw2') as disabled_login;
reset role;
