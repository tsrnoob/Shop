-- =====================================================================
--  v14: fixed-price packs, e.g. "魔芋爽 3包 · 口味任选": one price, the customer
--  mixes any flavours that add up to the pack size. Stock counts like normal
--  items (or it's a preorder). Packs show in their shop section, not with meals.
-- =====================================================================
alter table public.bundles add column if not exists kind text not null default 'meal' check (kind in ('meal', 'pack'));
alter table public.bundles add column if not exists section text check (section in ('rice', 'hotpot', 'breakfast', 'snack', 'drink'));

create or replace function private.bundle_combos(p_bundle text)
returns table (picks text[], retail numeric, cost numeric, price numeric)
language plpgsql stable security definer set search_path = public, private as $$
begin
  -- a pack has one fixed price; its "combination" is just the pack itself
  if exists (select 1 from bundles where id = p_bundle and kind = 'pack') then
    return query
      select '{}'::text[], b.price,
             coalesce((select sum(s.qty * (select max(p.cost) from products p where p.id = any (s.options) and p.active))
                         from bundle_slots s where s.bundle_id = p_bundle), 0)::numeric,
             b.price
        from bundles b
       where b.id = p_bundle and b.price is not null
         and exists (select 1 from bundle_slots s join products p on p.id = any (s.options) and p.active where s.bundle_id = p_bundle);
    return;
  end if;
  return query
  with recursive
  paid as (
    select row_number() over (order by s.sort, s.id) as rn, s.id, s.qty, s.options
    from bundle_slots s where s.bundle_id = p_bundle and not s.is_gift
  ),
  gift_cost as (
    select coalesce(sum(coalesce((select max(p.cost) from products p where p.id = any (s.options) and p.active), 0) * s.qty), 0) as c
    from bundle_slots s where s.bundle_id = p_bundle and s.is_gift
  ),
  r (n, picks, retail, cost) as (
    select 0::bigint, '{}'::text[], 0::numeric, 0::numeric
    union all
    select r.n + 1, r.picks || p.id, r.retail + p.price * s.qty, r.cost + p.cost * s.qty
    from r
    join paid s on s.rn = r.n + 1
    join products p on p.id = any (s.options) and p.active and p.price is not null
  )
  select r.picks, r.retail, r.cost + g.c, private.bundle_price(r.retail, r.cost + g.c)
  from r, gift_cost g
  where r.n = (select count(*) from paid) and r.n > 0;
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
        'category', category, 'section', section, 'on_shelf', on_shelf) order by sort, created_at)
      from products where active), '[]'::json),
    'bundles', coalesce((select json_agg(x.j order by x.sort, x.created_at) from (
        select b.sort, b.created_at, json_build_object(
          'id', b.id, 'name_cn', b.name_cn, 'name_en', b.name_en, 'description', b.description,
          'kind', b.kind, 'section', b.section, 'price', b.price,
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
  slot_sum int; n_keys int; n_opts int; taken int;
  b_retail numeric; b_cost numeric; b_price numeric; worst numeric;
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
  -- preorders no longer need a date (timing is agreed on WeChat); a date, if sent, must be sensible
  if has_pre and p_wanted_date is not null
     and (p_wanted_date < private.berlin_today() or p_wanted_date > private.berlin_today() + 90) then
    raise exception using errcode = 'P0001', message = 'bad_preorder_date';
  end if;

  -- closed: only preorders go through
  if not s.shop_open and exists (select 1 from jsonb_array_elements(p_items) x
                                  where not coalesce((x->>'preorder')::boolean, false)) then
    raise exception using errcode = 'P0001', message = 'shop_closed';
  end if;

  insert into orders (code, wechat_id, customer_id, location, note, wanted_date)
  values (private.new_order_code(), c.wechat_id, c.id, loc, left(btrim(coalesce(p_note, '')), 300),
          case when has_pre then p_wanted_date end)
  returning * into o;

  for line in select * from jsonb_array_elements(p_items) loop
    q := coalesce((line->>'qty')::int, 0);
    if q < 1 or q > s.max_qty then raise exception using errcode = 'P0001', message = 'bad_qty'; end if;

    if line ? 'bundle' then
      pre := coalesce((line->>'preorder')::boolean, false);   -- a preordered set takes nothing off stock
      select * into b from bundles where id = line->>'bundle';
      if not found or not b.active or (b.kind = 'pack' and b.price is null) then
        raise exception using errcode = 'P0001', message = 'unavailable:' || coalesce(line->>'bundle', '?');
      end if;
      if jsonb_typeof(line->'picks') is distinct from 'object' then
        raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
      end if;
      insert into order_bundles (order_id, bundle_id, name_cn, name_en, qty, unit_price)
      values (o.id, b.id, b.name_cn, b.name_en, q, 0) returning id into ob_id;
      b_retail := 0; b_cost := 0;
      summary := summary || q || '× ' || coalesce(nullif(b.name_cn, ''), b.name_en)
                 || case when pre then ' (preorder)' else '' end || ':' || E'\n';

      for sl in select * from bundle_slots where bundle_id = b.id order by sort, id loop
        select count(*), max(pp.cost) into n_opts, worst from products pp where pp.id = any (sl.options) and pp.active;

        -- gift with nothing ticked: included as is, nothing to choose
        if sl.is_gift and n_opts = 0 then
          if jsonb_typeof(line->'picks'->(sl.id::text)) = 'object'
             and exists (select 1 from jsonb_each(line->'picks'->(sl.id::text)) e
                         where jsonb_typeof(e.value) <> 'number' or (e.value)::text::int <> 0) then
            raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
          end if;
          summary := summary || '   ' || (sl.qty * q) || '× ' || coalesce(nullif(sl.label_cn, ''), sl.label_en) || ' (gift)' || E'\n';
          continue;
        end if;

        if jsonb_typeof(line->'picks'->(sl.id::text)) is distinct from 'object' then
          raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
        end if;
        slot_sum := 0; n_keys := 0;
        for pick in select key, value from jsonb_each(line->'picks'->(sl.id::text)) loop
          if jsonb_typeof(pick.value) <> 'number' or (pick.value)::text::int < 0 then
            raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
          end if;
          continue when (pick.value)::text::int = 0;
          slot_sum := slot_sum + (pick.value)::text::int;
          n_keys := n_keys + 1;
        end loop;
        -- meal sets: exactly one product per paid choice; packs and gifts: any mix that adds up
        if slot_sum <> sl.qty or (not sl.is_gift and n_keys <> 1 and b.kind <> 'pack') then
          raise exception using errcode = 'P0001', message = 'bad_picks:' || b.id;
        end if;
        if sl.is_gift then b_cost := b_cost + worst * sl.qty; end if;

        for pick in select key, (value)::text::int as n from jsonb_each(line->'picks'->(sl.id::text)) loop
          continue when pick.n = 0;
          select * into p from products where id = pick.key for update;
          if not found or not p.active or not (p.id = any (sl.options)) then
            raise exception using errcode = 'P0001', message = 'unavailable:' || pick.key;
          end if;
          if sl.is_gift then
            -- gifts never block the order; take what's on stock (nothing for a preorder)
            taken := case when pre then 0 else least(greatest(p.stock, 0), pick.n * q) end;
          else
            if p.price is null then raise exception using errcode = 'P0001', message = 'unavailable:' || pick.key; end if;
            b_retail := b_retail + p.price * pick.n;
            b_cost := b_cost + p.cost * pick.n;
            if pre then
              if not p.preorder_ok then raise exception using errcode = 'P0001', message = 'no_preorder:' || pick.key; end if;
              taken := 0;
            else
              if p.stock < pick.n * q then
                raise exception using errcode = 'P0001', message = 'out_of_stock:' || pick.key;
              end if;
              taken := pick.n * q;
            end if;
          end if;
          update products set stock = stock - taken where id = p.id;
          insert into order_items (order_id, product_id, name_cn, name_en, qty, preorder, unit_price, unit_cost, order_bundle_id, is_gift, stock_taken)
          values (o.id, p.id, p.name_cn, p.name_en, pick.n * q, pre, 0, p.cost, ob_id, sl.is_gift, taken);
          summary := summary || '   ' || (pick.n * q) || '× ' || coalesce(nullif(p.name_cn, ''), p.name_en)
                     || case when sl.is_gift then ' (gift)' else '' end || E'\n';
        end loop;
      end loop;

      b_price := case when b.kind = 'pack' then b.price else private.bundle_price(b_retail, b_cost) end;
      update order_bundles set unit_price = b_price where id = ob_id;
      tot := tot + q * b_price;

    else
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
      || case when has_pre then E'\nPreorder' || coalesce(' for: ' || to_char(p_wanted_date, 'Dy DD.MM.'), ' (tell them on WeChat when it''s in)') else '' end
      || E'\n' || summary
      || case when o.note <> '' then 'Note: ' || o.note else '' end);

  return json_build_object('code', o.code, 'total', tot, 'wanted_date', o.wanted_date, 'location', loc);
end $$;

-- the 魔芋爽 3-pack (singles stay as Menu A's gifts but aren't sold one by one any more)
insert into public.bundles (id, name_cn, name_en, description, price, active, sort, kind, section)
values ('pack-konjac3', '卫龙魔芋爽 3包 · 口味任选', 'Weilong Konjac Shuang — any 3 packs', '3 packs, mix any flavours', 2.00, true, 100, 'pack', 'snack')
on conflict (id) do nothing;
insert into public.bundle_slots (bundle_id, label_cn, label_en, category, qty, is_gift, sort, options)
select 'pack-konjac3', '魔芋爽 口味任选', 'Pick any 3 packs', 'konjac', 3, false, 10, array['wl-pc-sour', 'wl-pc-spicy', 'wl-pc-mala']
where not exists (select 1 from public.bundle_slots where bundle_id = 'pack-konjac3');
update public.products set on_shelf = false where id in ('wl-pc-sour', 'wl-pc-spicy', 'wl-pc-mala');
