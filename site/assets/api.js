// Thin layer between the pages and Supabase. Every call returns data or throws an Error
// whose .code is the short reason the database gave (e.g. "out_of_stock:5890").
(function () {
  const cfg = window.SHOP_CONFIG || {};
  const configured = cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT");
  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true } })
    : null;

  function fail(error) {
    const msg = (error && (error.message || error.error_description)) || "unknown";
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

  // Shrinks a phone photo to a square-ish 800px JPEG before upload.
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
    // ---- customers ----
    getShop: () => rpc("get_shop"),
    placeOrder: (o) => rpc("place_order", {
      p_wechat_id: o.wechat_id, p_location: o.location, p_note: o.note || "",
      p_items: o.items, p_wanted_date: o.wanted_date || null
    }),
    getMyOrders: (tokens) => tokens.length ? rpc("get_my_orders", { p_tokens: tokens }) : Promise.resolve([]),
    cancelMyOrder: (token) => rpc("cancel_my_order", { p_token: token }),

    // ---- owner ----
    async session() { if (!sb) return null; const { data } = await sb.auth.getSession(); return data.session; },
    async signIn(email, password) { if (!sb) fail({ message: "not_configured" }); const { error } = await sb.auth.signInWithPassword({ email, password }); if (error) fail(error); },
    async signOut() { if (sb) await sb.auth.signOut(); },
    isOwner: () => rpc("is_owner"),
    listOrders: () => q(sb.from("orders").select("*, order_items(*)").order("created_at", { ascending: false }).limit(500)),
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
    getSettings: () => q(sb.from("settings").select("*").eq("id", 1).single()),
    saveSettings: (patch) => q(sb.from("settings").update(patch).eq("id", 1))
  };
})();
