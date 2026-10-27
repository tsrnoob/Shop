// In-memory stand-in for api.js (v2: accounts + meal sets), for clicking through the pages without Supabase.
(function () {
  const plus = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  const err = (m) => { const e = new Error(m); e.code = m; throw e; };
  const S = { owner_email: "owner@test", shop_name: "Garching Snack Shop", wechat_contact: "tsrnoob", shop_open: true, shop_paused: false, status_message: null,
    locations: ["Garching Forschungszentrum"], preorder_days: 5, max_qty: 10, max_open_orders: 5, notice: null, ntfy_topic: null, bundle_discount: 0.50, bundle_min_profit: 1.50 };
  const P = [
    ["5885", "小龙坎 方便火锅粉 经典款", "Shoo Loong Kan Instant Hot Pot Vermicelli (Classic)", "Bowl · 295 g", 5.00, 3.68, 1, "main", true],
    ["5886", "自嗨锅 川式卤肉盖浇饭", "Zihaiguo Sichuan Braised Pork Rice (self-heating)", "Self-heating rice box · 262 g", 5.00, 3.57, 2, "main", true],
    ["5888", "小龙坎 自热蔬菜火锅 酸辣金汤味", "Shoo Loong Kan Veg Hot Pot, Hot & Sour Golden Soup", "Self-heating · 312 g", 4.50, 3.02, 0, "main", true],
    ["5892", "自嗨锅 菌菇牛肉煲仔饭", "Zihaiguo Mushroom Beef Claypot Rice (self-heating)", "Self-heating cup · 245 g", 4.00, 2.63, 2, "main", true],
    ["5893", "自嗨锅 鱼香肉丝煲仔饭", "Zihaiguo Yu-Xiang Shredded Pork Claypot Rice (self-heating)", "Self-heating cup", 4.00, 2.63, 2, "main", true],
    ["5891", "小龙坎 自热蔬菜火锅 麻辣清油味", "Shoo Loong Kan Veg Hot Pot, Spicy Clear Oil", "Self-heating · 312 g", 4.50, 3.02, 2, "main", true],
    ["5889", "卧龙锅巴 麻辣味", "Wolong Crispy Rice Crackers, Spicy Mala", "Bag · 200 g", 3.00, 2.22, 2, "guoba", true],
    ["5890", "良品铺子 小米锅巴 麻辣味", "Bestore Millet Crispy Rice, Spicy", "Bag · 90 g", 2.00, 1.06, 4, "guoba", true],
    ["5896", "喜之郎 CiCi 果汁果冻 芒果味", "Strong CiCi Drinkable Jelly, Mango", "Pouch", 2.50, 1.02, 9, "drink", true],
    ["wl252", "卫龙 魔芋爽 酸辣素毛肚", "Weilong Konjac Shuang, Sour & Hot", "Bag · 252 g (28 pieces)", null, 2.76, 1, "snack", true],
    ["wl-pc-sour", "卫龙 魔芋爽 酸辣 (单包)", "Weilong Konjac Shuang, Sour & Hot (single pack)", "Single pack · for meal sets", null, 0.10, 0, "konjac", false],
    ["wl-pc-spicy", "卫龙 魔芋爽 香辣 (单包)", "Weilong Konjac Shuang, Hot & Spicy (single pack)", "Single pack · for meal sets", null, 0.18, 0, "konjac", false],
    ["wl-pc-mala", "卫龙 魔芋爽 麻辣 (单包)", "Weilong Konjac Shuang, Numbing & Spicy (single pack)", "Single pack · for meal sets", null, 0.19, 0, "konjac", false],
    ["water-550", "矿泉水 550ml", "Still water 550 ml", "550 ml bottle · for meal sets", null, 0.30, 0, "water", false],
    ["hb-lava", "烘焙村 爆浆流心面包 牛奶味", "Honbear Lava Bread, Milk Filling", "Bag · 85 g", 2.50, 1.33, 1, "snack", true]
  ].map(([id, cn, en, meta, price, cost, stock, category, on_shelf], i) => ({ id, name_cn: cn, name_en: en, meta,
    image_url: id === "water-550" ? "img/water.svg" : id === "hb-lava" ? "img/hb-lava.jpg" : "img/" + (id.startsWith("wl-pc") ? { "wl-pc-sour": "wl252", "wl-pc-spicy": "wl360", "wl-pc-mala": "wlmala" }[id] : id) + ".jpg",
    section: category === "main" ? (["5885", "5888", "5891", "5894"].includes(id) ? "hotpot" : "rice") : id === "hb-lava" ? "breakfast" : ["drink", "water"].includes(category) ? "drink" : "snack",
    price, cost, stock, purchased: Math.max(stock, 2), active: true, preorder_ok: on_shelf, sort: i * 10, category, on_shelf, created_at: new Date().toISOString() }));
  const B = [
    { id: "set-a", name_cn: "套餐A：饭/火锅 + 饮料 + 送3包魔芋爽", name_en: "Set A: rice or hot pot + drink + 3 free konjac packs", description: "", price: 7.90, active: true, sort: 10,
      bundle_slots: [{ id: 1, label_cn: "饭 / 火锅", label_en: "Rice or hot pot", category: "main", qty: 1, is_gift: false, sort: 10, options: ["5885", "5886", "5888", "5891", "5892", "5893"] },
                     { id: 2, label_cn: "饮料", label_en: "Drink", category: "drink", qty: 1, is_gift: false, sort: 20, options: ["5896"] },
                     { id: 3, label_cn: "魔芋爽", label_en: "Konjac packs", category: "konjac", qty: 3, is_gift: true, sort: 30, options: ["wl-pc-sour", "wl-pc-spicy", "wl-pc-mala"] }] },
    { id: "set-b", name_cn: "套餐B：饭/火锅 + 锅巴 + 送550ml矿泉水", name_en: "Set B: rice or hot pot + guoba + free 550 ml water", description: "", price: 7.50, active: true, sort: 20,
      bundle_slots: [{ id: 4, label_cn: "饭 / 火锅", label_en: "Rice or hot pot", category: "main", qty: 1, is_gift: false, sort: 10, options: ["5885", "5886", "5888", "5891", "5892", "5893"] },
                     { id: 5, label_cn: "锅巴", label_en: "Guoba", category: "guoba", qty: 1, is_gift: false, sort: 20, options: ["5889", "5890"] },
                     { id: 6, label_cn: "矿泉水", label_en: "Water", category: "water", qty: 1, is_gift: true, sort: 30, options: ["water-550"] }] }
  ];
  let slotSeq = 7;
  const cents = (x) => Math.round(Number(x) * 100);
  for (const p of P) if (p.id.startsWith("wl-pc")) { p.preorder_ok = true; p.price = { "wl-pc-sour": 0.39, "wl-pc-spicy": 0.52, "wl-pc-mala": 0.55 }[p.id]; p.cost = { "wl-pc-sour": 0.09, "wl-pc-spicy": 0.22, "wl-pc-mala": 0.25 }[p.id]; p.stock = { "wl-pc-sour": 5, "wl-pc-spicy": 1, "wl-pc-mala": 0 }[p.id]; }
  B.push({ id: "pack-konjac3", name_cn: "卫龙魔芋爽 3包 · 口味任选", name_en: "Weilong Konjac Shuang — any 3 packs", description: "3 packs, mix any flavours", price: null, active: true, sort: 100, kind: "pack", section: "snack",
    bundle_slots: [{ id: 9, label_cn: "魔芋爽 口味任选", label_en: "Pick any 3 packs", category: "konjac", qty: 3, is_gift: false, sort: 10, options: ["wl-pc-sour", "wl-pc-spicy", "wl-pc-mala"] }] });
  function combos(b) {
    if (b.kind === "pack") { const lo = b.price ?? b.bundle_slots.reduce((a, s) => a + s.qty * Math.min(...s.options.map((id) => P.find((p) => p.id === id).price)), 0); const r = Math.round(lo * 2) / 2; return [{ p: [], retail: r, price: r }]; }
    const prod = (id) => P.find((p) => p.id === id && p.active);
    const slots = [...b.bundle_slots].sort((x, y) => x.sort - y.sort || x.id - y.id);
    const paid = slots.filter((s) => !s.is_gift), gifts = slots.filter((s) => s.is_gift);
    let giftC = 0;
    for (const g of gifts) { const cs = g.options.map(prod).filter(Boolean).map((p) => cents(p.cost)); if (cs.length) giftC += Math.max(...cs) * g.qty; }
    if (!paid.length) return [];
    let acc = [{ p: [], r: 0, c: 0 }];
    for (const s of paid) acc = acc.flatMap((a) => s.options.map(prod).filter((p) => p && p.price != null).map((p) => ({ p: [...a.p, p.id], r: a.r + cents(p.price), c: a.c + cents(p.cost) })));
    return acc.map((a) => ({ p: a.p, retail: a.r / 100, price: Math.min(a.r, Math.max(Math.ceil((a.r - cents(S.bundle_discount)) / 50) * 50, Math.floor((a.c + giftC + cents(S.bundle_min_profit)) / 50) * 50)) / 100 }));
  }
  const C = [{ id: 1, username: "lin2002", wechat_id: "wxid_lin2002", note: "MI", pw: "test", active: true, failed_logins: 0, locked_until: null, last_login_at: null, created_at: new Date().toISOString() }];
  const sessions = JSON.parse(sessionStorage.getItem("mock.sessions") || "{}");
  const saveSess = () => sessionStorage.setItem("mock.sessions", JSON.stringify(sessions));
  const O = []; let oid = 1, ibid = 1;
  const code = () => Math.random().toString(36).slice(2, 7).toUpperCase();
  const sessCust = (t) => { const c = C.find((x) => x.id === sessions[t]); if (!c || !c.active) err("login_required"); return c; };
  const wait = (v) => new Promise((r) => setTimeout(() => r(JSON.parse(JSON.stringify(v ?? null))), 100));
  function place(c, o, extra) {
    const prod = (id) => P.find((p) => p.id === id);
    const items = [], obs = []; let total = 0;
    for (const l of o.items) {
      if (l.bundle) {
        const b = B.find((x) => x.id === l.bundle); const obid = ibid++;
        const paidIds = [...b.bundle_slots].sort((x, y) => x.sort - y.sort).filter((s) => !s.is_gift).map((s) => Object.keys(l.picks[s.id] || {})[0]);
        const cb = combos(b).find((c) => c.p.every((id, i) => id === paidIds[i])); if (!cb) err("bad_picks:" + b.id);
        const unit = b.kind === "pack" && b.price == null ? Math.round(b.bundle_slots.reduce((a, s) => a + Object.entries(l.picks[s.id] || {}).reduce((x, [pid, n]) => x + n * prod(pid).price, 0), 0) * 2) / 2 : cb.price;
        obs.push({ id: obid, bundle_id: b.id, name_cn: b.name_cn, name_en: b.name_en, qty: l.qty, unit_price: unit }); total += l.qty * unit;
        for (const s of b.bundle_slots) {
          const picks = l.picks[s.id] || {}; const sum = Object.values(picks).reduce((a, n) => a + n, 0);
          const fixed = s.is_gift && !s.options.some((id) => prod(id)?.active);
          if (sum !== (fixed ? 0 : s.qty)) err("bad_picks:" + b.id);
          for (const [pid, n] of Object.entries(picks)) { const p = prod(pid); if (!l.preorder && !s.is_gift && p.stock < n * l.qty) err("out_of_stock:" + pid);
            const taken = l.preorder ? 0 : s.is_gift ? Math.min(Math.max(p.stock, 0), n * l.qty) : n * l.qty; p.stock -= taken; items.push({ id: ibid++, product_id: pid, name_cn: p.name_cn, name_en: p.name_en, qty: n * l.qty, preorder: !!l.preorder, unit_price: 0, unit_cost: p.cost, order_bundle_id: obid, is_gift: s.is_gift }); }
        }
      } else {
        const p = prod(l.id); if (!l.preorder) { if (p.stock < l.qty) err("out_of_stock:" + l.id); p.stock -= l.qty; }
        items.push({ id: ibid++, product_id: p.id, name_cn: p.name_cn, name_en: p.name_en, qty: l.qty, preorder: !!l.preorder, unit_price: p.price, unit_cost: p.cost, order_bundle_id: null, is_gift: false });
        total += l.qty * p.price;
      }
    }
    const ord = { id: oid++, code: code(), wechat_id: c.wechat_id, customer_id: c.id, location: o.location || S.locations[0], note: o.note || "",
      wanted_date: o.items.some((l) => l.preorder) ? o.wanted_date : null, status: "new", total, is_offline: false,
      created_at: new Date().toISOString(), order_items: items, order_bundles: obs, ...extra };
    O.unshift(ord); return ord;
  }
  place(C[0], { note: "Weekdays after 14:00", items: [{ bundle: "set-a", qty: 1, picks: { 1: { "5886": 1 }, 2: { "5896": 1 }, 3: { "wl-pc-sour": 2, "wl-pc-spicy": 1 } } }, { id: "5890", qty: 1 }] });
  const cancel = (o) => { for (const i of o.order_items) if (!i.preorder) P.find((p) => p.id === i.product_id).stock += i.qty; o.status = "cancelled"; };
  const signedIn = () => sessionStorage.getItem("mock.owner") === "1";

  window.API = {
    configured: true,
    getShop: () => wait({ settings: { ...S, earliest_preorder: plus(S.preorder_days) },
      products: P.filter((p) => p.active).map(({ cost, purchased, ...p }) => ({ ...p, stock: S.shop_open ? p.stock : 0, next_stock: !S.shop_open && !S.shop_paused ? p.stock : null })),
      bundles: B.filter((b) => b.active && combos(b).length).map((b) => ({ ...b, slots: [...b.bundle_slots].sort((x, y) => x.sort - y.sort), combos: combos(b) })) }),
    async login(u) { await wait(); const c = C.find((x) => x.username.toLowerCase() === u.toLowerCase());
      if (!c) err("bad_login"); if (!c.active) err("account_disabled");
      const t = crypto.randomUUID(); sessions[t] = c.id; saveSess(); c.last_login_at = new Date().toISOString(); return { token: t, username: c.username, wechat_id: c.wechat_id }; },
    me: async (t) => { await wait(); const c = sessCust(t); return { username: c.username, wechat_id: c.wechat_id }; },
    logout: async (t) => { delete sessions[t]; saveSess(); },
    placeOrder: async (o) => { await wait(); const c = sessCust(o.session); if (!S.shop_open && o.items.some((l) => !l.preorder)) err("shop_closed"); const r = place(c, o); return { code: r.code, total: r.total, wanted_date: r.wanted_date, location: r.location }; },
    myOrders: async (t) => { const c = sessCust(t); return wait(O.filter((o) => o.customer_id === c.id).map((o) => ({ ...o, items: o.order_items, bundles: o.order_bundles }))); },
    cancelOrder: async (t, code) => { const c = sessCust(t); const o = O.find((x) => x.code === code && x.customer_id === c.id); if (o.status !== "new") err("cannot_cancel"); cancel(o); return wait({ status: "cancelled" }); },

    session: async () => (signedIn() ? { user: { email: S.owner_email } } : null),
    signIn: async (e, p) => { if (e !== S.owner_email || p !== "test") err("Invalid login credentials"); sessionStorage.setItem("mock.owner", "1"); },
    signOut: async () => sessionStorage.removeItem("mock.owner"),
    isOwner: async () => signedIn(),
    setShopState: async (state, msg) => { let n = 0;
      if (state === "closed") for (const p of P) if (p.stock) { p.stock = 0; n++; }
      S.shop_open = state === "open"; S.shop_paused = state === "paused"; S.status_message = state === "open" ? null : (msg || null);
      return wait({ state, cleared: n }); },
    setStatusMessage: async (msg) => { S.status_message = msg || null; return wait(); },
    listOrders: () => wait(O),
    setStatus: async (id, st) => { const o = O.find((x) => x.id === id); if (st === "cancelled") cancel(o); else o.status = st; return wait(); },
    listProducts: () => wait([...P].sort((a, b) => a.sort - b.sort)),
    updateProduct: async (id, patch) => { Object.assign(P.find((p) => p.id === id), patch); return wait(); },
    setStock: async (id, from, to) => { const p = P.find((x) => x.id === id); if (p.stock !== from) err("stock_changed"); p.stock = to; return wait(); },
    addProduct: async (row) => { P.push({ created_at: new Date().toISOString(), ...row }); return wait(); },
    restock: async (id, n) => { const p = P.find((x) => x.id === id); p.stock += n; p.purchased += n; return wait(); },
    recordSale: async () => wait(),
    uploadImage: async (f) => URL.createObjectURL(f),
    listCustomers: () => wait(C.map(({ pw, ...c }) => c)),
    createCustomer: async (u, w, note) => { if (C.some((c) => c.username.toLowerCase() === u.toLowerCase())) err("username_taken");
      const pw = Math.random().toString(36).slice(2, 10); C.unshift({ id: C.length + 1, username: u, wechat_id: w, note, pw, active: true, failed_logins: 0, locked_until: null, last_login_at: null, created_at: new Date().toISOString() });
      return wait({ username: u, password: pw }); },
    resetPassword: async (id) => { const c = C.find((x) => x.id === id); c.pw = Math.random().toString(36).slice(2, 10); return wait({ username: c.username, password: c.pw }); },
    setCustomerActive: async (id, a) => { C.find((x) => x.id === id).active = a; return wait(); },
    updateCustomer: async (id, patch) => { Object.assign(C.find((x) => x.id === id), patch); return wait(); },
    listBundles: () => wait(B),
    setSlotOptions: async (sid, options) => { for (const b of B) for (const s of b.bundle_slots) if (s.id === sid) s.options = options; return wait(); },
    updateBundle: async (id, patch) => { Object.assign(B.find((b) => b.id === id), patch); return wait(); },
    addBundle: async (row) => { B.push({ ...row, description: "", bundle_slots: [] }); return wait(); },
    saveSlots: async (bid, slots, removed) => { const b = B.find((x) => x.id === bid);
      b.bundle_slots = slots.map((s) => ({ ...s, id: s.id || slotSeq++ })).filter((s) => !removed.includes(s.id)); return wait(); },
    getSettings: () => wait(S),
    saveSettings: async (patch) => { Object.assign(S, patch); return wait(); }
  };
})();
