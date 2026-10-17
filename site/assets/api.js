// Thin layer between the pages and Supabase. Every call returns data or throws an Error
// whose .code is the short reason the database gave (e.g. "out_of_stock:5890").
(function () {
  const cfg = window.SHOP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT");
  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true } })
    : null;

  function fail(error) {
    const msg = (error && (error.message || error.error_description || error.error)) || "unknown";
    const e = new Error(msg);
    e.code = msg;
    throw e;
  }
  async function rpc(name, args) {
    if (!sb) fail({ message: "not_configured" });
    const { data, error } = await sb.rpc(name, args || {});
    if (error) fail(error);
    return data;
  }
  async function q(promise) {
    const { data, error } = await promise;
    if (error) fail(error);
    return data;
  }

  // Shrinks a phone photo to an 800px JPEG before upload.
  async function shrink(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const s = Math.min(1, 800 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
    } finally { URL.revokeObjectURL(url); }
  }

  window.API = {
    configured: !!sb,

    // ---- customers (log in with an account the owner created) ----
    getShop: () => rpc("get_shop"),
    async login(username, password) {
      const r = await rpc("shop_login", { p_username: username, p_password: password });
      if (r && r.error) fail({ message: r.error });
      return r;
    },
    me: (session) => rpc("shop_me", { p_session: session }),
    logout: (session) => rpc("shop_logout", { p_session: session }),
    placeOrder: (o) => rpc("shop_place_order", {
      p_session: o.session, p_note: o.note || "", p_items: o.items,
      p_wanted_date: o.wanted_date || null, p_location: o.location || null
    }),
    myOrders: (session) => rpc("shop_my_orders", { p_session: session }),
    cancelOrder: (session, code) => rpc("shop_cancel_order", { p_session: session, p_code: code }),

    // ---- owner ----
    async session() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { if (!sb) fail({ message: "not_configured" }); const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) fail(error); },
    async signOut() { if (sb) await sb.auth.signOut(); },
    isOwner: () => rpc("is_owner"),

    listOrders: () => q(sb.from("orders")
      .select("*, order_items!order_items_order_id_fkey(*), order_bundles!order_bundles_order_id_fkey(*)")
      .order("created_at", { ascending: false }).limit(500)),
    setStatus: (id, status) => rpc("set_order_status", { p_order_id: id, p_status: status }),

    listProducts: () => q(sb.from("products").select("*").order("sort").order("created_at")),
    updateProduct: (id, patch) => q(sb.from("products").update(patch).eq("id", id)),
    // Only applies if stock is still what the page showed, so a correction can't wipe out an order placed meanwhile.
    async setStock(id, from, to) {
      const rows = await q(sb.from("products").update({ stock: to }).eq("id", id).eq("stock", from).select("id"));
      if (!rows || !rows.length) fail({ message: "stock_changed" });
    },
    addProduct: (row) => q(sb.from("products").insert(row)),
    restock: (id, qty, cost) => rpc("owner_restock", { p_product_id: id, p_qty: qty, p_cost: cost ?? null }),
    recordSale: (id, qty, price, note) => rpc("owner_record_sale", { p_product_id: id, p_qty: qty, p_price: price, p_note: note || "" }),
    async uploadImage(file) {
      const blob = await shrink(file);
      const path = "p-" + Date.now().toString(36) + ".jpg";
      const { error } = await sb.storage.from("product-images").upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (error) fail(error);
      return sb.storage.from("product-images").getPublicUrl(path).data.publicUrl;
    },

    listCustomers: () => q(sb.from("customers")
      .select("id, username, wechat_id, note, active, failed_logins, locked_until, last_login_at, created_at")
      .order("created_at", { ascending: false })),
    createCustomer: (username, wechat, note) => rpc("owner_create_customer", { p_username: username, p_wechat_id: wechat, p_note: note || "" }),
    resetPassword: (id) => rpc("owner_reset_customer_password", { p_customer_id: id }),
    setCustomerActive: (id, active) => rpc("owner_set_customer_active", { p_customer_id: id, p_active: active }),
    updateCustomer: (id, patch) => q(sb.from("customers").update(patch).eq("id", id)),

    listBundles: () => q(sb.from("bundles").select("*, bundle_slots(*)").order("sort").order("created_at")),
    updateBundle: (id, patch) => q(sb.from("bundles").update(patch).eq("id", id)),
    addBundle: (row) => q(sb.from("bundles").insert(row)),
    // Keeps existing slot ids (so customers' carts stay valid), adds new ones, removes deleted ones.
    async saveSlots(bundleId, slots, removedIds) {
      for (const s of slots) {
        const row = { label_cn: s.label_cn, label_en: s.label_en, category: s.category, qty: s.qty, is_gift: s.is_gift, sort: s.sort };
        if (s.id) await q(sb.from("bundle_slots").update(row).eq("id", s.id));
        else await q(sb.from("bundle_slots").insert({ ...row, bundle_id: bundleId }));
      }
      if (removedIds && removedIds.length) await q(sb.from("bundle_slots").delete().in("id", removedIds));
    },

    getSettings: () => q(sb.from("settings").select("*").eq("id", 1).single()),
    saveSettings: (patch) => q(sb.from("settings").update(patch).eq("id", 1))
  };
})();
