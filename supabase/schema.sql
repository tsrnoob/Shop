-- =====================================================================
--  Snack shop — database setup (ALREADY APPLIED to your project
--  "garching-snack-shop"; kept here as a record / for a fresh project).
--  Customer-facing functions are in public; internal helpers live in the
--  "private" schema, which the public API cannot reach.
-- =====================================================================
create extension if not exists pg_net;
-- internal helpers live here: not reachable through the public API
create schema if not exists private;

-- ---------- settings (one row) ----------
create table if not exists public.settings (
  id             int primary key default 1 check (id = 1),
  owner_email    text not null default 'change-me@example.com',
  shop_name      text not null default 'Garching Snack Shop',
  wechat_contact text not null default 'guest19191231',
  locations      text[] not null default array[
    'Mensa Garching',
    'MI building (Maths & Informatics), main entrance',
    'U6 Garching-Forschungszentrum station',
    'Maschinenwesen (MW), main entrance',
    'Physics Department, main entrance',
    'Chemistry building, main entrance',
    'Interims-Hörsäle (Interim I)',
    'Galileo, Lichtenbergstraße'
  ],
  preorder_days  int not null default 5 check (preorder_days between 0 and 60),
  max_qty        int not null default 10 check (max_qty between 1 and 99),
  max_open_orders int not null default 5 check (max_open_orders between 1 and 50),
  ntfy_topic     text,
  notice         text
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- ---------- products ----------
create table if not exists public.products (
  id          text primary key,
  name_cn     text not null default '',
  name_en     text not null default '',
  meta        text not null default '',
  image_url   text not null default '',
  price       numeric(8,2) check (price is null or price >= 0),
  cost        numeric(8,2) not null default 0 check (cost >= 0),
  stock       int not null default 0 check (stock >= 0),
  purchased   int not null default 0 check (purchased >= 0),
  active      boolean not null default true,
  preorder_ok boolean not null default true,
  sort        int not null default 100,
  created_at  timestamptz not null default now()
);

-- ---------- orders ----------
create table if not exists public.orders (
  id            bigint generated always as identity primary key,
  code          text not null unique,
  token         uuid not null unique default gen_random_uuid(),
  wechat_id     text not null,
  location      text not null,
  note          text not null default '',
  wanted_date   date,
  status        text not null default 'new'
                check (status in ('new','confirmed','delivered','cancelled')),
  total         numeric(10,2) not null default 0,
  is_offline    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists orders_created_idx on public.orders (created_at desc);
create index if not exists orders_wechat_idx on public.orders (lower(wechat_id));

create table if not exists public.order_items (
  id          bigint generated always as identity primary key,
  order_id    bigint not null references public.orders(id) on delete cascade,
  product_id  text not null references public.products(id),
  name_cn     text not null,
  name_en     text not null,
  qty         int not null check (qty > 0),
  preorder    boolean not null default false,
  unit_price  numeric(8,2) not null,
  unit_cost   numeric(8,2) not null
);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_product_idx on public.order_items (product_id);

-- ---------- who is the owner ----------
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public, private as $$
  select coalesce(
    lower(auth.jwt() ->> 'email') = (select lower(owner_email) from settings where id = 1)
    and coalesce(auth.jwt() ->> 'role','') = 'authenticated',
    false)
$$;

-- ---------- row level security ----------
alter table public.settings    enable row level security;
alter table public.products    enable row level security;
alter table public.orders      enable row level security;
alter table public.order_items enable row level security;

-- Customers never touch tables directly: they go through the functions below.
grant select, insert, update, delete on public.products, public.orders, public.order_items to authenticated;
grant select, update on public.settings to authenticated;

create policy owner_all on public.settings for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy owner_all on public.products for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy owner_all on public.orders for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
create policy owner_all on public.order_items for all to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- ---------- helpers ----------
create or replace function private.berlin_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Europe/Berlin')::date $$;

create or replace function private.new_order_code() returns text
language plpgsql volatile set search_path = public, private as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  c text;
begin
  loop
    c := '';
    for i in 1..5 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from orders where code = c);
  end loop;
  return c;
end $$;

-- Sends a push notification through ntfy.sh when a topic is set.
-- Never blocks or breaks an order if it fails.
create or replace function private.notify_owner(p_title text, p_message text) returns void
language plpgsql security definer set search_path = public, private as $$
declare topic text;
begin
  select ntfy_topic into topic from settings where id = 1;
  if topic is null or btrim(topic) = '' then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using 'https://ntfy.sh',
          jsonb_build_object('topic', btrim(topic), 'title', p_title, 'message', p_message, 'tags', jsonb_build_array('shopping_cart')),
          jsonb_build_object('Content-Type', 'application/json');
exception when others then
  raise warning 'notify_owner failed: %', sqlerrm;
end $$;

-- ---------- public: shop data ----------
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
        'price', price, 'stock', stock, 'preorder_ok', preorder_ok) order by sort, created_at)
      from products where active and price is not null), '[]'::json)
  )
$$;

-- ---------- public: place an order ----------
-- p_items: [{"id": "5885", "qty": 2, "preorder": false}, ...]
-- In-stock lines take stock immediately; preorder lines need p_wanted_date.
create or replace function public.place_order(
  p_wechat_id text, p_location text, p_note text, p_items jsonb, p_wanted_date date default null
) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare
  s settings%rowtype;
  wid text := btrim(coalesce(p_wechat_id, ''));
  line jsonb;
  pid text; q int; pre boolean;
  p products%rowtype;
  o orders%rowtype;
  has_pre boolean := false;
  tot numeric(10,2) := 0;
  seen text[] := '{}';
  summary text := '';
begin
  select * into s from settings where id = 1;

  if length(wid) < 2 or length(wid) > 40 or wid ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'bad_wechat';
  end if;
  if p_location is null or not (p_location = any (s.locations)) then
    raise exception using errcode = 'P0001', message = 'bad_location';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 30 then
    raise exception using errcode = 'P0001', message = 'empty_cart';
  end if;
  if (select count(*) from orders where lower(wechat_id) = lower(wid) and status in ('new','confirmed'))
     >= s.max_open_orders then
    raise exception using errcode = 'P0001', message = 'too_many_open_orders';
  end if;

  -- any preorder line needs a valid date
  select bool_or(coalesce((x->>'preorder')::boolean, false)) into has_pre from jsonb_array_elements(p_items) x;
  if has_pre then
    if p_wanted_date is null
       or p_wanted_date < private.berlin_today() + s.preorder_days
       or p_wanted_date > private.berlin_today() + 90 then
      raise exception using errcode = 'P0001', message = 'bad_preorder_date';
    end if;
  end if;

  insert into orders (code, wechat_id, location, note, wanted_date)
  values (private.new_order_code(), wid, p_location, left(btrim(coalesce(p_note, '')), 300),
          case when has_pre then p_wanted_date end)
  returning * into o;

  for line in select * from jsonb_array_elements(p_items) loop
    pid := line->>'id';
    q := coalesce((line->>'qty')::int, 0);
    pre := coalesce((line->>'preorder')::boolean, false);
    if pid is null or q < 1 or q > s.max_qty then
      raise exception using errcode = 'P0001', message = 'bad_qty';
    end if;
    if (pid || ':' || pre::text) = any (seen) then
      raise exception using errcode = 'P0001', message = 'duplicate_line';
    end if;
    seen := seen || (pid || ':' || pre::text);

    -- lock the product row so two buyers can't take the last item
    select * into p from products where id = pid for update;
    if not found or not p.active or p.price is null then
      raise exception using errcode = 'P0001', message = 'unavailable:' || pid;
    end if;

    if pre then
      if not p.preorder_ok then
        raise exception using errcode = 'P0001', message = 'no_preorder:' || pid;
      end if;
    else
      if p.stock < q then
        raise exception using errcode = 'P0001', message = 'out_of_stock:' || pid;
      end if;
      update products set stock = stock - q where id = pid;
    end if;

    insert into order_items (order_id, product_id, name_cn, name_en, qty, preorder, unit_price, unit_cost)
    values (o.id, pid, p.name_cn, p.name_en, q, pre, p.price, p.cost);
    tot := tot + q * p.price;
    summary := summary || q || '× ' || coalesce(nullif(p.name_cn, ''), p.name_en)
               || case when pre then ' (preorder)' else '' end || E'\n';
  end loop;

  update orders set total = tot where id = o.id;

  perform private.notify_owner(
    case when has_pre then 'New preorder ' else 'New order ' end || o.code || ' · €' || to_char(tot, 'FM9990.00'),
    'WeChat: ' || wid || E'\n' || 'Where: ' || p_location
      || case when has_pre then E'\nPreorder for: ' || to_char(p_wanted_date, 'Dy DD.MM.') else '' end
      || E'\n' || summary
      || case when o.note <> '' then 'Note: ' || o.note else '' end);

  return json_build_object('code', o.code, 'token', o.token, 'total', tot, 'wanted_date', o.wanted_date);
end $$;

-- ---------- public: a customer's own orders (by the tokens their browser kept) ----------
create or replace function public.get_my_orders(p_tokens uuid[]) returns json
language sql stable security definer set search_path = public, private as $$
  select coalesce(json_agg(json_build_object(
      'code', o.code, 'token', o.token, 'status', o.status, 'total', o.total,
      'location', o.location, 'wanted_date', o.wanted_date, 'created_at', o.created_at,
      'items', (select json_agg(json_build_object('name_cn', i.name_cn, 'name_en', i.name_en,
                  'qty', i.qty, 'preorder', i.preorder, 'unit_price', i.unit_price) order by i.id)
                from order_items i where i.order_id = o.id)
    ) order by o.created_at desc), '[]'::json)
  from orders o
  where o.token = any (p_tokens[1:50])
$$;

-- shared by customer cancel and owner cancel: puts in-stock items back
create or replace function private.cancel_order_internal(p_order_id bigint) returns void
language plpgsql security definer set search_path = public, private as $$
begin
  update products p set stock = p.stock + x.q
  from (select product_id, sum(qty) q from order_items
        where order_id = p_order_id and not preorder group by product_id) x
  where p.id = x.product_id;
  update orders set status = 'cancelled', updated_at = now() where id = p_order_id;
end $$;

-- customer may cancel while the owner hasn't confirmed yet
create or replace function public.cancel_my_order(p_token uuid) returns json
language plpgsql volatile security definer set search_path = public, private as $$
declare o orders%rowtype;
begin
  select * into o from orders where token = p_token for update;
  if not found then raise exception using errcode = 'P0001', message = 'not_found'; end if;
  if o.status <> 'new' then raise exception using errcode = 'P0001', message = 'cannot_cancel'; end if;
  perform private.cancel_order_internal(o.id);
  perform private.notify_owner('Order ' || o.code || ' cancelled by customer', 'WeChat: ' || o.wechat_id);
  return json_build_object('code', o.code, 'status', 'cancelled');
end $$;

-- ---------- owner: change an order's status ----------
create or replace function public.set_order_status(p_order_id bigint, p_status text) returns void
language plpgsql volatile security definer set search_path = public, private as $$
declare o orders%rowtype;
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  if p_status not in ('new','confirmed','delivered','cancelled') then
    raise exception using errcode = 'P0001', message = 'bad_status';
  end if;
  select * into o from orders where id = p_order_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'not_found'; end if;
  if o.status = p_status then return; end if;
  if o.status = 'cancelled' then
    raise exception using errcode = 'P0001', message = 'already_cancelled';
  end if;
  if p_status = 'cancelled' then
    perform private.cancel_order_internal(o.id);
  else
    update orders set status = p_status, updated_at = now() where id = o.id;
  end if;
end $$;

-- ---------- owner: record a sale made outside the site ----------
create or replace function public.owner_record_sale(p_product_id text, p_qty int, p_price numeric, p_note text default '')
returns void
language plpgsql volatile security definer set search_path = public, private as $$
declare p products%rowtype; o_id bigint;
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  if p_qty is null or p_qty < 1 then raise exception using errcode = 'P0001', message = 'bad_qty'; end if;
  select * into p from products where id = p_product_id for update;
  if not found then raise exception using errcode = 'P0001', message = 'not_found'; end if;
  if p.stock < p_qty then raise exception using errcode = 'P0001', message = 'out_of_stock:' || p_product_id; end if;
  update products set stock = stock - p_qty where id = p_product_id;
  insert into orders (code, wechat_id, location, note, status, total, is_offline)
  values (private.new_order_code(), '(offline)', 'Offline sale', left(coalesce(p_note, ''), 300), 'delivered',
          p_qty * coalesce(p_price, p.price, 0), true)
  returning id into o_id;
  insert into order_items (order_id, product_id, name_cn, name_en, qty, preorder, unit_price, unit_cost)
  values (o_id, p.id, p.name_cn, p.name_en, p_qty, false, coalesce(p_price, p.price, 0), p.cost);
end $$;

-- ---------- owner: restock (adds to stock and to "bought" for the spent total) ----------
create or replace function public.owner_restock(p_product_id text, p_qty int, p_cost numeric default null)
returns void
language plpgsql volatile security definer set search_path = public, private as $$
begin
  if not is_owner() then raise exception using errcode = '42501', message = 'not_owner'; end if;
  if p_qty is null or p_qty < 1 or p_qty > 10000 then raise exception using errcode = 'P0001', message = 'bad_qty'; end if;
  update products set stock = stock + p_qty, purchased = purchased + p_qty,
         cost = coalesce(p_cost, cost)
  where id = p_product_id;
  if not found then raise exception using errcode = 'P0001', message = 'not_found'; end if;
end $$;


-- ---------- storage bucket for product photos you upload ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "owner uploads product images" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and (select public.is_owner()));
create policy "owner updates product images" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and (select public.is_owner()));
create policy "owner deletes product images" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and (select public.is_owner()));
