\set ON_ERROR_STOP 0
\pset pager off
update settings set owner_email = 'me@shop.test', preorder_days = 5;
update products set price = case id when '5890' then 1.99 when 'wl252' then 3.50 else 4.00 end;

-- helper to run a statement and print the error message instead of aborting
create or replace function try(sql text) returns text language plpgsql as $$
begin execute sql; return 'ok'; exception when others then return 'ERR ' || sqlerrm; end $$;
grant execute on function try(text) to anon, authenticated;

select berlin_today()+3 as d3, berlin_today()+5 as d5 \gset
\echo '== as anon customer =='
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select try('select count(*) from products') as anon_read_products;
select try('select count(*) from orders') as anon_read_orders;
select json_array_length((get_shop())->'products') as shop_products;
select ((get_shop())->'products'->0)::jsonb ? 'cost' as leaks_cost;

-- normal order: 2 millet + 1 wl252 (stock 5 and 1)
select place_order('wxid_alice', 'Mensa Garching', 'after 12', '[{"id":"5890","qty":2},{"id":"wl252","qty":1}]') as alice;
-- wl252 now sold out -> should fail
select try($q$select place_order('wxid_bob', 'Mensa Garching', '', '[{"id":"wl252","qty":1}]')$q$) as bob_out_of_stock;
-- preorder without date / too early / ok
select try($q$select place_order('wxid_bob', 'Mensa Garching', '', '[{"id":"wl252","qty":1,"preorder":true}]')$q$) as pre_nodate;
select try(format($q$select place_order('wxid_bob', 'Mensa Garching', '', '[{"id":"wl252","qty":1,"preorder":true}]', %L)$q$, :'d3')) as pre_too_early;
select place_order('wxid_bob', 'Mensa Garching', '', '[{"id":"wl252","qty":2,"preorder":true},{"id":"5890","qty":1}]', :'d5') ->> 'code' is not null as pre_ok;
-- bad location, bad qty, empty cart, unpriced product hidden
select try($q$select place_order('wxid_eve', 'Marienplatz', '', '[{"id":"5890","qty":1}]')$q$) as bad_location;
select try($q$select place_order('wxid_eve', 'Mensa Garching', '', '[{"id":"5890","qty":50}]')$q$) as bad_qty;
select try($q$select place_order('wxid_eve', 'Mensa Garching', '', '[]')$q$) as empty;
select try($q$select place_order('x', 'Mensa Garching', '', '[{"id":"5890","qty":1}]')$q$) as short_wechat;
-- an anon trying owner functions
select try($q$select set_order_status(1, 'cancelled')$q$) as anon_set_status;
select try($q$select owner_restock('5890', 5)$q$) as anon_restock;
reset role;

\echo '== stock after orders (millet 5-2-1=2, wl252 0) =='
select id, stock from products where id in ('5890','wl252') order by id;

\echo '== customer reads own orders + cancels =='
select token as at from orders where wechat_id='wxid_alice' \gset
set role anon;
select json_array_length(get_my_orders(array[:'at'::uuid])) as alice_sees;
select json_array_length(get_my_orders(array[gen_random_uuid()])) as stranger_sees;
reset role;
select token as alice_token from orders where wechat_id = 'wxid_alice' \gset
set role anon;
select cancel_my_order(:'alice_token') ->> 'status' as alice_cancel;
select try(format('select cancel_my_order(%L)', :'alice_token')) as cancel_twice;
reset role;
\echo '== stock after alice cancel (millet 4, wl252 1) =='
select id, stock from products where id in ('5890','wl252') order by id;

\echo '== as owner =='
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"Me@Shop.test"}', false);
select is_owner() as owner;
select count(*) as owner_sees_orders from orders;
select owner_restock('5890', 10, 1.10);
select owner_record_sale('5890', 2, 2.50, 'friend');
select id, stock, purchased, cost from products where id = '5890';
select id as bob_order from orders where wechat_id = 'wxid_bob' \gset
select set_order_status(:bob_order, 'confirmed');
select set_order_status(:bob_order, 'cancelled');
select try(format('select set_order_status(%s, %L)', :bob_order, 'new')) as uncancel;
select id, stock from products where id in ('5890','wl252') order by id;
update products set price = 2.29 where id = '5890';
select price from products where id = '5890';
reset role;

\echo '== another signed-in user is not owner =='
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","email":"other@x.test"}', false);
select is_owner() as owner, count(*) as sees_orders from orders;
select try($q$update products set price = 0 where id = '5890'$q$) as other_update;
reset role;
select price from products where id = '5890';

\echo '== open-order limit =='
set role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', false);
select place_order('wxid_spam', 'Mensa Garching', '', '[{"id":"5896","qty":1}]') is not null from generate_series(1,5);
select try($q$select place_order('wxid_spam', 'Mensa Garching', '', '[{"id":"5896","qty":1}]')$q$) as sixth;
reset role;

\echo '== concurrency: totals consistent =='
select id, stock from products where id = '5896';
select status, count(*), sum(total) from orders group by status order by status;
