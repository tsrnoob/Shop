// In-memory stand-in for api.js, for clicking through the pages without Supabase.
(function () {
  const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const iso = (d) => d.toISOString().slice(0, 10);
  const plus = (n) => { const d = today(); d.setDate(d.getDate() + n + 1); return iso(d).slice(0, 10); };
  const err = (m) => { const e = new Error(m); e.code = m; throw e; };
  const S = {
    owner_email: "owner@test", shop_name: "Garching Snack Shop", wechat_contact: "guest19191231",
    locations: ["Mensa Garching", "MI building (Maths & Informatics), main entrance", "U6 Garching-Forschungszentrum station", "Maschinenwesen (MW), main entrance"],
    preorder_days: 5, max_qty: 10, max_open_orders: 5, notice: null, ntfy_topic: null
  };
  const P = [
    ["5885", "小龙坎 方便火锅粉 经典款", "Shoo Loong Kan Instant Hot Pot Vermicelli (Classic)", "Bowl · 295 g", 4.50, 3.68, 2],
    ["5886", "自嗨锅 川式卤肉盖浇饭", "Zihaiguo Sichuan Braised Pork Rice (self-heating)", "Self-heating rice box · 262 g", 4.90, 3.57, 2],
    ["5888", "小龙坎 自热蔬菜火锅 酸辣金汤味", "Shoo Loong Kan Veg Hot Pot, Hot & Sour Golden Soup", "Self-heating · 312 g", 4.20, 3.02, 0],
    ["5891", "小龙坎 自热蔬菜火锅 麻辣清油味", "Shoo Loong Kan Veg Hot Pot, Spicy Clear Oil", "Self-heating · 312 g", 4.20, 3.02, 2],
    ["5889", "卧龙锅巴 麻辣味", "Wolong Crispy Rice Crackers, Spicy Mala", "Bag · 200 g", 3.00, 2.22, 2],
    ["5890", "良品铺子 小米锅巴 麻辣味", "Bestore Millet Crispy Rice, Spicy", "Bag · 90 g", 1.80, 1.06, 5],
    ["wl252", "卫龙 魔芋爽 酸辣素毛肚", "Weilong Konjac Shuang, Sour & Hot", "Bag · 252 g (28 pieces)", 3.80, 2.76, 1],
    ["5896", "喜之郎 CiCi 果汁果冻 芒果味", "Strong CiCi Drinkable Jelly, Mango", "Drinkable jelly pouch", 1.50, 1.02, 10],
    ["wlmala", "卫龙 魔芋爽 麻辣素毛肚", "Weilong Konjac Shuang, Numbing & Spicy (box)", "Box · +20% bonus pack", null, 4.46, 1]
  ].map(([id, cn, en, meta, price, cost, stock], i) => ({ id, name_cn: cn, name_en: en, meta, image_url: "img/" + id + ".jpg", price, cost, stock, purchased: Math.max(stock, 2), active: true, preorder_ok: true, sort: i * 10, created_at: new Date().toISOString() }));
  const O = []; let oid = 1;
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase();
  function place(o, owner) {
    const wid = (o.wechat_id || "").trim();
    if (wid.length < 2) err("bad_wechat");
    if (!owner && !S.locations.includes(o.location)) err("bad_location");
    if (!o.items.length) err("empty_cart");
    const hasPre = o.items.some((i) => i.preorder);
    if (hasPre && (!o.wanted_date || o.wanted_date < plus(S.preorder_days - 1))) err("bad_preorder_date");
    for (const l of o.items) { const p = P.find((x) => x.id === l.id); if (!p || p.price == null) err("unavailable:" + l.id); if (!l.preorder && p.stock < l.qty) err("out_of_stock:" + l.id); }
    const items = o.items.map((l, k) => { const p = P.find((x) => x.id === l.id); if (!l.preorder) p.stock -= l.qty; return { id: oid * 100 + k, product_id: p.id, name_cn: p.name_cn, name_en: p.name_en, qty: l.qty, preorder: !!l.preorder, unit_price: p.price, unit_cost: p.cost }; });
    const ord = { id: oid++, code: code(), token: crypto.randomUUID(), wechat_id: wid, location: o.location, note: o.note || "", wanted_date: hasPre ? o.wanted_date : null, status: o.status || "new", total: items.reduce((a, i) => a + i.qty * i.unit_price, 0), is_offline: !!owner, created_at: o.created_at || new Date().toISOString(), order_items: items };
    O.unshift(ord); return ord;
  }
  // a few sample orders for the owner view
  place({ wechat_id: "wxid_lin2002", location: "Mensa Garching", note: "Weekdays after 14:00", items: [{ id: "5890", qty: 2 }, { id: "5896", qty: 3 }] });
  place({ wechat_id: "chen_yu_tum", location: "U6 Garching-Forschungszentrum station", items: [{ id: "5888", qty: 2, preorder: true }], wanted_date: plus(5) });
  const d = place({ wechat_id: "mia.zhang", location: "MI building (Maths & Informatics), main entrance", items: [{ id: "5885", qty: 1 }], created_at: new Date(Date.now() - 864e5).toISOString() }); d.status = "delivered";
  O[0].created_at = new Date(Date.now() - 6 * 60000).toISOString();
  const cancel = (o) => { for (const i of o.order_items) if (!i.preorder) P.find((p) => p.id === i.product_id).stock += i.qty; o.status = "cancelled"; };
  const wait = (v) => new Promise((r) => setTimeout(() => r(JSON.parse(JSON.stringify(v ?? null))), 120));
  const signedIn = () => sessionStorage.getItem("mock.owner") === "1";

  window.API = {
    configured: true,
    getShop: () => wait({ settings: { ...S, earliest_preorder: plus(S.preorder_days - 1) }, products: P.filter((p) => p.active && p.price != null).map(({ cost, purchased, ...p }) => p) }),
    placeOrder: async (o) => { await wait(); const r = place(o); return { code: r.code, token: r.token, total: r.total, wanted_date: r.wanted_date }; },
    getMyOrders: (t) => wait(O.filter((o) => t.includes(o.token)).map((o) => ({ ...o, items: o.order_items }))),
    cancelMyOrder: async (t) => { const o = O.find((x) => x.token === t); if (!o) err("not_found"); if (o.status !== "new") err("cannot_cancel"); cancel(o); return wait({ code: o.code, status: "cancelled" }); },
    session: async () => (signedIn() ? { user: { email: S.owner_email } } : null),
    signIn: async (e, p) => { if (e !== S.owner_email || p !== "test") err("Invalid login credentials"); sessionStorage.setItem("mock.owner", "1"); },
    signOut: async () => sessionStorage.removeItem("mock.owner"),
    isOwner: async () => signedIn(),
    listOrders: () => wait(O),
    setStatus: async (id, st) => { const o = O.find((x) => x.id === id); if (o.status === "cancelled") err("already_cancelled"); if (st === "cancelled") cancel(o); else o.status = st; return wait(); },
    listProducts: () => wait([...P].sort((a, b) => a.sort - b.sort)),
    updateProduct: async (id, patch) => { Object.assign(P.find((p) => p.id === id), patch); return wait(); },
    setStock: async (id, from, to) => { const p = P.find((x) => x.id === id); if (p.stock !== from) err("stock_changed"); p.stock = to; return wait(); },
    addProduct: async (row) => { P.push({ created_at: new Date().toISOString(), ...row }); return wait(); },
    restock: async (id, n) => { const p = P.find((x) => x.id === id); p.stock += n; p.purchased += n; return wait(); },
    recordSale: async (id, qty, price, note) => { const p = P.find((x) => x.id === id); const keep = p.price; p.price = price; place({ wechat_id: "(offline)", location: "Offline sale", note, items: [{ id, qty }], status: "delivered" }, true); p.price = keep; return wait(); },
    uploadImage: async (f) => URL.createObjectURL(f),
    getSettings: () => wait(S),
    saveSettings: async (patch) => { Object.assign(S, patch); return wait(); }
  };
})();
