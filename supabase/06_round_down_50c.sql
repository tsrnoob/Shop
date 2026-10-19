-- =====================================================================
--  v6: menu prices are rounded DOWN to the nearest 50 cents.
--     price = floor_to_0.50( max( paid items' shop prices − discount ,
--                                 all costs + target profit ) )
--  The profit target (€1.50) is no longer a hard floor: rounding down can
--  take up to 49 cents off it, so the real profit is at least target − €0.49.
-- =====================================================================
create or replace function private.bundle_price(p_retail numeric, p_cost numeric) returns numeric
language sql stable set search_path = public, private as $$
  select (floor(greatest(p_retail - st.bundle_discount, p_cost + st.bundle_min_profit) * 2) / 2)::numeric(8,2)
  from public.settings st where st.id = 1
$$;
