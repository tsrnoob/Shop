-- =====================================================================
--  v2: customer accounts you create by hand, product categories,
--  meal-set menus (套餐) with free choices, single pickup area.
--  Additive only: no tables or columns are removed. ALREADY APPLIED to your project.
-- =====================================================================

-- ---------- product categories ----------
-- main = rice / hot pot, drink, konjac = single 魔芋爽 packs, guoba, water, snack = other
alter table public.products add column if not exists category text not null default 'snack';
alter table public.products add column if not exists on_shelf boolean not null default true;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_category_check') then
    alter table public.products add constraint products_category_check
      check (category in ('main','drink','konjac','guoba','water','snack'));
  end if;
end $$;

-- ---------- customers (created by the owner) ----------
create table if not exists public.customers (
  id            bigint generated always as identity primary key,
  username      text not null,
  wechat_id     text not null,
  note          text not null default '',
  pass_hash     text not null,
  active        boolean not null default true,
  failed_logins int not null default 0,
  locked_until  timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);
create unique index if not exists customers_username_idx on public.customers (lower(username));

create table if not exists public.customer_sessions (
  token        uuid primary key default gen_random_uuid(),
  customer_id  bigint not null references public.customers(id),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '180 days'
);
create index if not exists customer_sessions_customer_idx on public.customer_sessions (customer_id);

alter table public.customers enable row level security;
alter table public.customer_sessions enable row level security;
grant select, insert, update on public.customers to authenticated;
create policy owner_all on public.customers for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
-- sessions: no policies at all, only reachable through the functions below

alter table public.orders add column if not exists customer_id bigint references public.customers(id);
create index if not exists orders_customer_idx on public.orders (customer_id);

-- ---------- meal sets ----------
create table if not exists public.bundles (
  id          text primary key,
  name_cn     text not null default '',
  name_en     text not null default '',
  description text not null default '',
  price       numeric(8,2) check (price is null or price >= 0),
  active      boolean not null default true,
  sort        int not null default 100,
  created_at  timestamptz not null default now()
);
create table if not exists public.bundle_slots (
  id        bigint generated always as identity primary key,
  bundle_id text not null references public.bundles(id),
  label_cn  text not null default '',
  label_en  text not null default '',
  category  text not null check (category in ('main','drink','konjac','guoba','water','snack')),
  qty       int not null default 1 check (qty between 1 and 20),
  is_gift   boolean not null default false,
  sort      int not null default 0
);
create index if not exists bundle_slots_bundle_idx on public.bundle_slots (bundle_id);
alter table public.bundles enable row level security;
alter table public.bundle_slots enable row level security;
grant select, insert, update on public.bundles to authenticated;
grant select, insert, update, delete on public.bundle_slots to authenticated;
create policy owner_all on public.bundles for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));
create policy owner_all on public.bundle_slots for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

-- one row per meal set inside an order; its contents are order_items pointing at it
create table if not exists public.order_bundles (
  id         bigint generated always as identity primary key,
  order_id   bigint not null references public.orders(id),
  bundle_id  text not null references public.bundles(id),
  name_cn    text not null,
  name_en    text not null,
  qty        int not null check (qty > 0),
  unit_price numeric(8,2) not null
);
create index if not exists order_bundles_order_idx on public.order_bundles (order_id);
create index if not exists order_bundles_bundle_idx on public.order_bundles (bundle_id);
alter table public.order_bundles enable row level security;
grant select on public.order_bundles to authenticated;
create policy owner_all on public.order_bundles for all to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

alter table public.order_items add column if not exists order_bundle_id bigint references public.order_bundles(id);
alter table public.order_items add column if not exists is_gift boolean not null default false;
create index if not exists order_items_bundle_idx on public.order_items (order_bundle_id);

-- ---------- helpers ----------
create or replace function private.gen_password() returns text
language plpgsql volatile set search_path = public, private as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  pw text := '';
begin
  for i in 1..8 loop
    pw := pw || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return pw;
end $$;

-- returns the logged-in customer, or raises login_required
create or replace function private.session_customer(p_session uuid) returns public.customers
language plpgsql stable security definer set search_path = public, private as $$
declare c public.customers;
begin
  select cu.* into c from public.customer_sessions s join public.customers cu on cu.id = s.customer_id
  where s.token = p_session and s.expires_at > now() and cu.active;
  if not found then raise exception using errcode = 'P0001', message = 'login_required'; end if;
  return c;
end $$;

-- ---------- customer login ----------
-- Failures are returned (not raised) so the failed-attempt counter is actually saved.
create or replace function public.shop_login(p_username text, p_password text) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare c public.customers; t uuid;
begin
  select * into c from public.customers where lower(username) = lower(btrim(coalesce(p_username, ''))) for update;
  if not found then
    perform pg_sleep(0.3);
    return json_build_object('error', 'bad_login');
  end if;
  if not c.active then return json_build_object('error', 'account_disabled'); end if;
  if c.locked_until is not null and c.locked_until > now() then
    return json_build_object('error', 'locked');
  end if;
  if c.pass_hash <> extensions.crypt(coalesce(p_password, ''), c.pass_hash) then
    update public.customers
       set failed_logins = failed_logins + 1,
           locked_until = case when failed_logins + 1 >= 5 then now() + interval '15 minutes' else locked_until end
     where id = c.id;
    perform pg_sleep(0.3);
    return json_build_object('error', 'bad_login');
  end if;
  update public.customers set failed_logins = 0, locked_until = null, last_login_at = now() where id = c.id;
  insert into public.customer_sessions (customer_id) values (c.id) returning token into t;
  return json_build_object('token', t, 'username', c.username, 'wechat_id', c.wechat_id);
end $$;

create or replace function public.shop_me(p_session uuid) returns json
language plpgsql stable security definer set search_path = public, private as $$
declare c public.customers;
begin
  c := private.session_customer(p_session);
  return json_build_object('username', c.username, 'wechat_id', c.wechat_id);
end $$;

create or replace function public.shop_logout(p_session uuid) returns void
language sql volatile security definer set search_path = public, private as $$
  update public.customer_sessions set expires_at = now() where token = p_session and expires_at > now()
$$;

-- ---------- shop data (now with categories and meal sets) ----------
create or replace function public.get_shop() returns json
language sql stable security definer set search_path = public, private as $$
  select json_build_object(
    'settings', (select json_build_object(
        'shop_name', shop_name, 'wechat_contact', wechat_contact, 'locations', locations,
        'preorder_days', preorder_days, 'max_qty', max_qty, 'notice', notice,
        'earliest_preorder', private.berlin_today() + preorder_days)
      from settings where id = 1),
    'products', coalesce((select json_agg(json_build_object(
        'id', id, 'name_cn', name_cn, 'name_en', name_en, 'meta', meta, 'image_url', image_url,
        'price', price, 'stock', stock, 'preorder_ok', preorder_ok,
        'category', category, 'on_shelf', on_shelf) order by sort, created_at)
      from products where active), '[]'::json),
    'bundles', coalesce((select json_agg(json_build_object(
        'id', b.id, 'name_cn', b.name_cn, 'name_en', b.name_en, 'description', b.description, 'price', b.price,
        'slots', (select coalesce(json_agg(json_build_object(
            'id', s.id, 'label_cn', s.label_cn, 'label_en', s.label_en, 'category', s.category,
            'qty', s.qty, 'is_gift', s.is_gift) order by s.sort, s.id), '[]'::json)
          from bundle_slots s where s.bundle_id = b.id)
      ) order by b.sort, b.created_at)
      from bundles b where b.active and b.price is not null), '[]'::json)
  )
$$;

-- ---------- place an order (logged-in customers only) ----------
-- p_items: [{"id":"5885","qty":2,"preorder":false},
--           {"bundle":"set-a","qty":1,"picks":{"<slot id>":{"<product id>":<count>, ...}, ...}}]
create or replace function public.shop_place_order(
  p_session uuid, p_note text, p_items jsonb, p_wanted_date date default null, p_location text default null
) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare
  s settings%rowtype;
  c customers%rowtype;
  loc text;
  line jsonb; pick record;
  pid text; q int; pre boolean;
  p products%rowtype;
  b bundles%rowtype;
  sl bundle_slots%rowtype;
  o orders%rowtype;
  ob_id bigint;
  has_pre boolean := false;
  tot numeric(10,2) := 0;
  seen text[] := '{}';
  slot_sum int;
  summary text := '';
begin
  c := private.session_customer(p_session);
  select * into s from settings where id = 1;
  loc := coalesce(nullif(btrim(coalesce(p_location, '')), ''), s.locations[1]);
  if not (loc = any (s.locations)) then
    raise exception using errcode = 'P0001', message = 'bad_location';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception using errcode = 'P0001', message = 'empty_cart';
  end if;
  if (select count(*) from orders where customer_id = c.id and status in ('new','confirmed')) >= s.max_open_orders then
    raise exception using errcode = 'P0001', message = 'too_many_open_orders';
  end if;

  select bool_or(coalesce((x->>'preorder')::boolean, false)) into has_pre from jsonb_array_elements(p_items) x;
  if has_pre then
    if p_wanted_date is null
       or p_wanted_date < private.berlin_today() + s.preorder_days
       or p_wanted_date > private.berlin_today() + 90 then
      raise exception using errcode = 'P0001', message = 'bad_preorder_date';
    end if;
  end if;

  insert into orders (code, wechat_id, customer_id, location, note, wanted_date)
  values (private.new_order_code(), c.wechat_id, c.id, loc, left(btrim(coalesce(p_note, '')), 300),
          case when has_pre then p_wanted_date end)
  returning * into o;

  for line in select * from jsonb_array_elements(p_items) loop
    q := coalesce((line->>'qty')::int, 0);
    if q < 1 or q > s.max_qty then raise exception using errcode = 'P0001', message = 'bad_qty'; end if;

    if line ? 'bundle' then
      -- ----- a meal set -----
      select * into b from bundles where id = line->>'bundle';
      if not found or not b.active or b.price is null then
        raise exception using errcode = 'P0001', message = 'unavailable:' || coalesce(line->>'bundle', '?');
      end if;
      if jsonb_typeof(line->'picks') is distinct from 'object' then
        raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
      end if;
      insert into order_bundles (order_id, bundle_id, name_cn, name_en, qty, unit_price)
      values (o.id, b.id, b.name_cn, b.name_en, q, b.price) returning id into ob_id;
      tot := tot + q * b.price;
      summary := summary || q || '× ' || coalesce(nullif(b.name_cn, ''), b.name_en) || ':' || E'\n';

      -- every slot must be filled with exactly slot.qty items from its category
      for sl in select * from bundle_slots where bundle_id = b.id order by sort, id loop
        if jsonb_typeof(line->'picks'->(sl.id::text)) is distinct from 'object' then
          raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
        end if;
        slot_sum := 0;
        for pick in select key, value from jsonb_each(line->'picks'->(sl.id::text)) loop
          if jsonb_typeof(pick.value) <> 'number' or (pick.value)::text::int < 0 then
            raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
          end if;
          continue when (pick.value)::text::int = 0;
          slot_sum := slot_sum + (pick.value)::text::int;
        end loop;
        if slot_sum <> sl.qty then
          raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
        end if;
        for pick in select key, (value)::text::int as n from jsonb_each(line->'picks'->(sl.id::text)) loop
          continue when pick.n = 0;
          select * into p from products where id = pick.key for update;
          if not found or not p.active or p.category <> sl.category then
            raise exception using errcode = 'P0001', message = 'unavailable:' || pick.key;
          end if;
          if p.stock < pick.n * q then
            raise exception using errcode = 'P0001', message = 'out_of_stock:' || pick.key;
          end if;
          update products set stock = stock - pick.n * q where id = p.id;
          insert into order_items (order_id, product_id, name_cn, name_en, qty, preorder, unit_price, unit_cost, order_bundle_id, is_gift)
          values (o.id, p.id, p.name_cn, p.name_en, pick.n * q, false, 0, p.cost, ob_id, sl.is_gift);
          summary := summary || '   ' || (pick.n * q) || '× ' || coalesce(nullif(p.name_cn, ''), p.name_en)
                     || case when sl.is_gift then ' (gift)' else '' end || E'\n';
        end loop;
      end loop;

    else
      -- ----- a single product -----
      pid := line->>'id';
      pre := coalesce((line->>'preorder')::boolean, false);
      if pid is null then raise exception using errcode = 'P0001', message = 'bad_qty'; end if;
      if (pid || ':' || pre::text) = any (seen) then
        raise exception using errcode = 'P0001', message = 'duplicate_line';
      end if;
      seen := seen || (pid || ':' || pre::text);
      select * into p from products where id = pid for update;
      if not found or not p.active or not p.on_shelf or p.price is null then
        raise exception using errcode = 'P0001', message = 'unavailable:' || pid;
      end if;
      if pre then
        if not p.preorder_ok then raise exception using errcode = 'P0001', message = 'no_preorder:' || pid; end if;
      else
        if p.stock < q then raise exception using errcode = 'P0001', message = 'out_of_stock:' || pid; end if;
        update products set stock = stock - q where id = pid;
      end if;
      insert into order_items (order_id, product_id, name_cn, name_en, qty, preorder, unit_price, unit_cost)
      values (o.id, pid, p.name_cn, p.name_en, q, pre, p.price, p.cost);
      tot := tot + q * p.price;
      summary := summary || q || '× ' || coalesce(nullif(p.name_cn, ''), p.name_en)
                 || case when pre then ' (preorder)' else '' end || E'\n';
    end if;
  end loop;

  update orders set total = tot where id = o.id;

  perform private.notify_owner(
    case when has_pre then 'New preorder ' else 'New order ' end || o.code || ' · €' || to_char(tot, 'FM9990.00'),
    'WeChat: ' || c.wechat_id || ' (' || c.username || ')' || E'\n' || 'Where: ' || loc
      || case when has_pre then E'\nPreorder for: ' || to_char(p_wanted_date, 'Dy DD.MM.') else '' end
      || E'\n' || summary
      || case when o.note <> '' then 'Note: ' || o.note else '' end);

  return json_build_object('code', o.code, 'total', tot, 'wanted_date', o.wanted_date, 'location', loc);
end $$;

-- ---------- a customer's orders (any device, via their login) ----------
create or replace function public.shop_my_orders(p_session uuid) returns json
language plpgsql stable security definer set search_path = public, private as $$
declare c customers%rowtype; r json;
begin
  c := private.session_customer(p_session);
  select coalesce(json_agg(json_build_object(
      'code', o.code, 'status', o.status, 'total', o.total,
      'location', o.location, 'wanted_date', o.wanted_date, 'created_at', o.created_at,
      'bundles', (select coalesce(json_agg(json_build_object('id', ob.id, 'name_cn', ob.name_cn, 'name_en', ob.name_en,
                    'qty', ob.qty, 'unit_price', ob.unit_price) order by ob.id), '[]'::json)
                  from order_bundles ob where ob.order_id = o.id),
      'items', (select json_agg(json_build_object('name_cn', i.name_cn, 'name_en', i.name_en,
                  'qty', i.qty, 'preorder', i.preorder, 'unit_price', i.unit_price,
                  'order_bundle_id', i.order_bundle_id, 'is_gift', i.is_gift) order by i.id)
                from order_items i where i.order_id = o.id)
    ) order by o.created_at desc), '[]'::json) into r
  from (select * from orders where customer_id = c.id order by created_at desc limit 50) o;
  return r;
end $$;

create or replace function public.shop_cancel_order(p_session uuid, p_code text) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare c customers%rowtype; o orders%rowtype;
begin
  c := private.session_customer(p_session);
  select * into o from orders where code = upper(btrim(p_code)) and customer_id = c.id for update;
  if not found then raise exception using errcode = 'P0001', message = 'not_found'; end if;
  if o.status <> 'new' then raise exception using errcode = 'P0001', message = 'cannot_cancel'; end if;
  perform private.cancel_order_internal(o.id);
  perform private.notify_owner('Order ' || o.code || ' cancelled by customer', 'WeChat: ' || o.wechat_id);
  return json_build_object('code', o.code, 'status', 'cancelled');
end $$;

-- cancelling now also returns meal-set contents (they are never preorders)
create or replace function private.cancel_order_internal(p_order_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  update products p set stock = p.stock + x.q
  from (select product_id, sum(qty) q from order_items
        where order_id = p_order_id and not preorder group by product_id) x
  where p.id = x.product_id;
  update orders set status = 'cancelled', updated_at = now() where id = p_order_id;
end $$;

-- ---------- the old no-login functions now refuse ----------
create or replace function public.place_order(
  p_wechat_id text, p_location text, p_note text, p_items jsonb, p_wanted_date date default null
) returns json
language plpgsql volatile security definer set search_path = public, private as $$
begin
  raise exception using errcode = 'P0001', message = 'login_required';
end $$;

create or replace function public.get_my_orders(p_tokens uuid[]) returns json
language sql stable security definer set search_path = public, private as $$ select '[]'::json $$;

create or replace function public.cancel_my_order(p_token uuid) returns json
language plpgsql volatile security definer set search_path = public, private as $$
begin
  raise exception using errcode = 'P0001', message = 'login_required';
end $$;

-- ---------- owner: customer accounts ----------
create or replace function public.owner_create_customer(p_username text, p_wechat_id text, p_note text default '') returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare pw text; u text := btrim(coalesce(p_username, '')); w text := btrim(coalesce(p_wechat_id, '')); new_id bigint;
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  if u !~ '^[A-Za-z0-9_.-]{3,30}$' then raise exception using errcode = 'P0001', message = 'bad_username'; end if;
  if length(w) < 2 or length(w) > 40 then raise exception using errcode = 'P0001', message = 'bad_wechat'; end if;
  if exists (select 1 from customers where lower(username) = lower(u)) then
    raise exception using errcode = 'P0001', message = 'username_taken';
  end if;
  pw := private.gen_password();
  insert into customers (username, wechat_id, note, pass_hash)
  values (u, w, left(coalesce(p_note, ''), 200), extensions.crypt(pw, extensions.gen_salt('bf', 10)))
  returning id into new_id;
  return json_build_object('id', new_id, 'username', u, 'password', pw);
end $$;

create or replace function public.owner_reset_customer_password(p_customer_id bigint) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare pw text; u text;
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  pw := private.gen_password();
  update customers set pass_hash = extensions.crypt(pw, extensions.gen_salt('bf', 10)),
         failed_logins = 0, locked_until = null
  where id = p_customer_id returning username into u;
  if u is null then raise exception using errcode = 'P0001', message = 'not_found'; end if;
  update customer_sessions set expires_at = now() where customer_id = p_customer_id and expires_at > now();
  return json_build_object('username', u, 'password', pw);
end $$;

-- deactivating someone also logs them out everywhere
create or replace function public.owner_set_customer_active(p_customer_id bigint, p_active boolean) returns void
language plpgsql volatile security definer set search_path = public, private as $$
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  update customers set active = p_active, failed_logins = 0, locked_until = null where id = p_customer_id;
  if not p_active then update customer_sessions set expires_at = now() where customer_id = p_customer_id and expires_at > now(); end if;
end $$;

-- ---------- data: categories, single pickup area, the two meal sets ----------
update public.products set category = 'main'  where id in ('5885','5886','5888','5891','5894','5892','5893','5895');
update public.products set category = 'guoba' where id in ('5889','5890');
update public.products set category = 'drink' where id = '5896';
update public.products set category = 'snack' where id in ('wl252','wl360','wlmala');

-- single 魔芋爽 packs for gifting, taken out of the bags/boxes (stock = number of loose packs)
insert into public.products (id, name_cn, name_en, meta, image_url, cost, stock, purchased, sort, category, on_shelf, preorder_ok) values
  ('wl-pc-sour',  '卫龙 魔芋爽 酸辣 (单包)', 'Weilong Konjac Shuang, Sour & Hot (single pack)',      'Single pack · for meal sets', 'img/wl252.jpg',  0.10, 0, 0, 200, 'konjac', false, false),
  ('wl-pc-spicy', '卫龙 魔芋爽 香辣 (单包)', 'Weilong Konjac Shuang, Hot & Spicy (single pack)',     'Single pack · for meal sets', 'img/wl360.jpg',  0.18, 0, 0, 210, 'konjac', false, false),
  ('wl-pc-mala',  '卫龙 魔芋爽 麻辣 (单包)', 'Weilong Konjac Shuang, Numbing & Spicy (single pack)', 'Single pack · for meal sets', 'img/wlmala.jpg', 0.19, 0, 0, 220, 'konjac', false, false)
on conflict (id) do nothing;

update public.settings set locations = array['Garching Forschungszentrum'] where id = 1;

insert into public.bundles (id, name_cn, name_en, description, price, sort) values
  ('set-a', '套餐A：饭/火锅 + 饮料 + 送3包魔芋爽', 'Set A: rice or hot pot + drink + 3 free konjac packs',
   '自选一款饭或火锅、一款饮料，再送3包魔芋爽（口味任选）', null, 10),
  ('set-b', '套餐B：饭/火锅 + 锅巴 + 送550ml矿泉水', 'Set B: rice or hot pot + guoba + free 550 ml water',
   '自选一款饭或火锅、一款锅巴，再送一瓶550ml矿泉水', null, 20)
on conflict (id) do nothing;

insert into public.bundle_slots (bundle_id, label_cn, label_en, category, qty, is_gift, sort)
select * from (values
  ('set-a', '饭 / 火锅', 'Rice or hot pot', 'main',   1, false, 10),
  ('set-a', '饮料',      'Drink',           'drink',  1, false, 20),
  ('set-a', '魔芋爽',    'Konjac packs',    'konjac', 3, true,  30),
  ('set-b', '饭 / 火锅', 'Rice or hot pot', 'main',   1, false, 10),
  ('set-b', '锅巴',      'Guoba',           'guoba',  1, false, 20),
  ('set-b', '矿泉水',    'Water',           'water',  1, true,  30)
) v(bundle_id, label_cn, label_en, category, qty, is_gift, sort)
where not exists (select 1 from public.bundle_slots);
