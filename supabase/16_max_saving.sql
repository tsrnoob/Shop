-- =====================================================================
--  v16: meal-set rule — a customer saves at most "bundle_discount" (now €0.50).
--     price = the lowest 50-cent step that saves no more than €0.50,
--             but not below the target profit (rounded down to 50 cents),
--             and never more than buying the items one by one.
-- =====================================================================
create or replace function private.bundle_price(p_retail numeric, p_cost numeric) returns numeric
language sql stable set search_path = public, private as $$
  select least(p_retail,
               greatest(ceil((p_retail - st.bundle_discount) * 2) / 2,
                        floor((p_cost + st.bundle_min_profit) * 2) / 2))::numeric(8,2)
  from public.settings st where st.id = 1
$$;

update public.settings set bundle_discount = 0.50 where id = 1;
