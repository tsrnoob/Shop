-- =====================================================================
--  v18: crossed-out "was" price for real price cuts.
--   products.compare_price: the price the product actually sold for before.
--   get_shop returns it as was_price only while it's above the current price.
--   Additive only.
-- =====================================================================

alter table public.products add column if not exists compare_price numeric(8,2)
  check (compare_price is null or compare_price >= 0);

do $$
declare d text := pg_get_functiondef('public.get_shop()'::regprocedure);
begin
  if position('was_price' in d) = 0 then
    d := replace(d, $r$'price', price, 'stock',$r$,
      $r$'price', price, 'was_price', case when compare_price > price then compare_price end, 'stock',$r$);
    if position('was_price' in d) = 0 then raise exception 'get_shop: anchor not found'; end if;
    execute d;
  end if;
end $$;

-- the prices these products really had before the price cuts (Oct–Nov 2026)
update public.products p set compare_price = v.was
from (values ('5885', 4.50), ('5886', 5.00), ('5888', 4.50), ('5891', 4.50), ('5894', 4.50),
             ('5892', 4.00), ('5893', 4.00), ('zhg-xgjh', 5.00), ('5895', 5.00),
             ('5896', 2.50), ('ksf-icetea', 2.50), ('hb-lava', 2.50), ('tk-melon', 2.50),
             ('hb-chestnut', 2.50), ('redbull-330', 2.50)) as v(id, was)
where p.id = v.id and p.compare_price is null;
