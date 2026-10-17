(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n < 0 ? "−€" : "€") + Math.abs(Number(n || 0)).toFixed(2);
  const num = (v) => { if (v === null || v === undefined || String(v).trim() === "") return null; const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : NaN; };
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  let orders = [], products = [], settings = null;
  let filter = "open", search = "", tab = ls.get("owner.tab", "orders");

  let toastT;
  function toast(m) { const t = $("#toast"); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3000); }
  async function copy(text) { try { await navigator.clipboard.writeText(text); toast("Copied " + text); } catch (e) { toast("Copy failed. Long-press the ID to copy."); } }

  // ---------- auth ----------
  async function boot() {
    if (!API.configured) { showSignin("The site isn't connected to Supabase yet. Fill in assets/config.js."); return; }
    const s = await API.session();
    if (!s) return showSignin();
    let ok = false;
    try { ok = await API.isOwner(); } catch (e) {}
    if (!ok) return showSignin(`${s.user.email} isn't the shop owner account.`, true);
    $("#owner-who").textContent = s.user.email; $("#owner-who").hidden = false;
    $("#signin-view").hidden = true; $("#owner-view").hidden = false; $("#tabs").hidden = false; $("#signout").hidden = false;
    setTab(tab);
    await Promise.all([loadSettings(), loadProducts(), loadOrders()]);
    setInterval(() => { if (!document.hidden) loadOrders(true); }, 20000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) loadOrders(true); });
  }
  function showSignin(msg, signedIn) {
    $("#signin-view").hidden = false; $("#owner-view").hidden = true; $("#tabs").hidden = true;
    $("#signout").hidden = !signedIn;
    const e = $("#si-err"); e.hidden = !msg; e.textContent = msg || "";
  }
  $("#signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#si-err"); err.hidden = true;
    try { await API.signIn($("#si-email").value.trim(), $("#si-pass").value); location.reload(); }
    catch (ex) { err.textContent = /invalid/i.test(ex.message) ? "Wrong email or password." : "Couldn't sign in: " + ex.message; err.hidden = false; }
  });
  $("#signout").onclick = async () => { await API.signOut(); location.reload(); };

  // ---------- tabs ----------
  function setTab(t) {
    tab = t; ls.set("owner.tab", t);
    $$("#tabs [data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    $$("[data-panel]").forEach((p) => (p.hidden = p.dataset.panel !== t));
    if (t === "inventory") renderInventory();
  }
  $$("#tabs [data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));

  // ---------- orders ----------
  async function loadOrders(quiet) {
    try {
      const before = new Set(orders.map((o) => o.id));
      orders = await API.listOrders();
      const fresh = orders.filter((o) => !before.has(o.id) && o.status === "new");
      if (quiet && before.size && fresh.length) toast(`New order from ${fresh[0].wechat_id}`);
      $("#refreshed").textContent = "Updated " + new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      renderOrders(); renderInventory();
      // stock may have changed through orders
      if (quiet) loadProducts(true);
    } catch (e) { if (!quiet) $("#orders").innerHTML = `<div class="empty">Couldn't load orders: ${esc(e.message)}</div>`; }
  }
  const STATUS = { new: "New", confirmed: "Confirmed", delivered: "Delivered", cancelled: "Cancelled" };
  function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return "just now"; if (m < 60) return m + " min ago";
    const h = Math.round(m / 60); if (h < 24) return h + " h ago";
    return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function daysUntil(iso) {
    const today = new Date(); today.setHours(12, 0, 0, 0);
    return Math.round((new Date(iso + "T12:00:00") - today) / 86400000);
  }
  function renderOrders() {
    const n = orders.filter((o) => o.status === "new").length;
    $("#new-count").hidden = !n; $("#new-count").textContent = n;
    document.title = (n ? `(${n}) ` : "") + "Shop Owner";

    const s = search.toLowerCase();
    let list = orders.filter((o) => {
      if (s && !(o.wechat_id.toLowerCase().includes(s) || o.code.toLowerCase().includes(s))) return false;
      if (filter === "open") return (o.status === "new" || o.status === "confirmed");
      if (filter === "preorder") return o.wanted_date && (o.status === "new" || o.status === "confirmed");
      if (filter === "all") return true;
      return o.status === filter;
    });
    if (filter === "preorder") list = [...list].sort((a, b) => a.wanted_date.localeCompare(b.wanted_date));
    if (filter === "open") list = [...list].sort((a, b) => (a.status === "new" ? 0 : 1) - (b.status === "new" ? 0 : 1) || b.created_at.localeCompare(a.created_at));

    if (!list.length) { $("#orders").innerHTML = `<div class="empty">${filter === "open" ? "No open orders right now." : "Nothing here."}</div>`; return; }
    $("#orders").innerHTML = list.map((o) => {
      const items = [...(o.order_items || [])].sort((a, b) => a.id - b.id);
      let due = "";
      if (o.wanted_date) {
        const d = daysUntil(o.wanted_date);
        const label = new Date(o.wanted_date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
        due = `<span class="pre-due ${d <= 2 && o.status !== "delivered" && o.status !== "cancelled" ? "soon" : ""}">Preorder for ${label} · ${d < 0 ? Math.abs(d) + " days ago" : d === 0 ? "today" : "in " + d + " day" + (d === 1 ? "" : "s")}</span>`;
      }
      const acts = [];
      if (o.status === "new") acts.push(`<button class="btn small primary" data-st="confirmed" data-id="${o.id}">Confirm</button>`);
      if (o.status === "new" || o.status === "confirmed") {
        acts.push(`<button class="btn small" data-st="delivered" data-id="${o.id}">Delivered &amp; paid</button>`);
        acts.push(`<button class="btn small ghost" data-st="cancelled" data-id="${o.id}">Cancel</button>`);
      }
      return `<article class="ord ${o.status === "new" ? "is-new" : ""}">
        <div class="top"><span class="code">${esc(o.code)}</span><span class="status ${o.status}">${STATUS[o.status]}</span>
          <span class="muted when" style="margin-left:auto" title="${esc(new Date(o.created_at).toLocaleString("en-GB"))}">${ago(o.created_at)}</span></div>
        <div class="wx"><span class="muted small">WeChat</span><b>${esc(o.wechat_id)}</b>${o.is_offline ? "" : `<button class="btn small ghost" data-copy="${esc(o.wechat_id)}">Copy</button>`}</div>
        <div class="small"><span class="muted">Meet at</span> <b>${esc(o.location)}</b></div>
        ${due}
        ${o.note ? `<div class="note">“${esc(o.note)}”</div>` : ""}
        <ul>${items.map((i) => `<li>${i.qty} × ${esc(i.name_cn || i.name_en)} <span class="muted">@ ${money(i.unit_price)}</span>${i.preorder ? ' <span class="pre-chip">preorder</span>' : ""}</li>`).join("")}</ul>
        <div class="top"><b class="num">${money(o.total)}</b><span class="muted small">pay on pickup</span></div>
        ${acts.length ? `<div class="acts">${acts.join("")}</div>` : ""}
      </article>`;
    }).join("");
  }
  $("#order-filter").addEventListener("click", (e) => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    filter = b.dataset.f;
    $$("#order-filter [data-f]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderOrders();
  });
  $("#order-search").addEventListener("input", (e) => { search = e.target.value.trim(); renderOrders(); });
  $("#orders").addEventListener("click", async (e) => {
    const c = e.target.closest("[data-copy]"); if (c) return copy(c.dataset.copy);
    const b = e.target.closest("[data-st]"); if (!b) return;
    if (b.dataset.st === "cancelled" && b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "Tap again to cancel"; return; }
    b.disabled = true;
    try {
      await API.setStatus(Number(b.dataset.id), b.dataset.st);
      toast(b.dataset.st === "cancelled" ? "Cancelled. In-stock items went back on the shelf." : "Marked " + STATUS[b.dataset.st].toLowerCase());
      await Promise.all([loadOrders(), loadProducts(true)]);
    } catch (ex) { toast("Couldn't update: " + ex.message); b.disabled = false; }
  });

  // ---------- products ----------
  async function loadProducts(quiet) {
    try { products = await API.listProducts(); renderProducts(quiet); renderInventory(); fillSaleSelect(); }
    catch (e) { if (!quiet) $("#products").innerHTML = `<div class="empty">Couldn't load products: ${esc(e.message)}</div>`; }
  }
  function renderProducts(keepEdits) {
    // don't wipe a row the owner is typing in
    if (keepEdits && $("#products").contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
    if (!products.length) { $("#products").innerHTML = `<div class="empty">No products yet. Add your first one.</div>`; return; }
    $("#products").innerHTML = products.map((p) => {
      const flags = [];
      if (p.price == null) flags.push(`<span class="flag warn">No price · not in shop</span>`);
      if (!p.active) flags.push(`<span class="flag">Hidden</span>`);
      if (p.stock <= 0) flags.push(`<span class="flag">Sold out${p.preorder_ok ? " · preorder on" : ""}</span>`);
      return `<div class="prow ${p.active && p.price != null ? "" : "off"}" data-id="${esc(p.id)}">
        <img src="${esc(p.image_url)}" alt="" data-open="${esc(p.id)}">
        <div class="t"><div class="n-cn">${esc(p.name_cn)}</div><div class="n-en">${esc(p.name_en)}</div><div class="flags">${flags.join("")}</div></div>
        <button class="btn small ghost" data-open="${esc(p.id)}">Edit</button>
        <div class="edit">
          <label class="mini"><span>Price €</span><input data-f="price" inputmode="decimal" value="${p.price == null ? "" : Number(p.price).toFixed(2)}" placeholder="—"></label>
          <label class="mini"><span>Cost €</span><input data-f="cost" inputmode="decimal" value="${Number(p.cost).toFixed(2)}"></label>
          <label class="mini"><span>Stock</span><input data-f="stock" type="number" min="0" inputmode="numeric" value="${p.stock}" data-was="${p.stock}"></label>
          <div class="mini stockbox"><div><span>Restock</span><input data-f="restock" type="number" min="1" inputmode="numeric" placeholder="+0"></div><button class="btn small" data-restock="${esc(p.id)}">Add</button></div>
          <label class="check"><input type="checkbox" data-f="active" ${p.active ? "checked" : ""}> In shop</label>
          <div class="rowsave"><span class="saved" hidden>Saved</span><button class="btn small primary" data-save="${esc(p.id)}">Save</button></div>
        </div>
      </div>`;
    }).join("");
  }
  $("#products").addEventListener("click", async (e) => {
    const open = e.target.closest("[data-open]"); if (open) return openEditor(products.find((p) => p.id === open.dataset.open));
    const rs = e.target.closest("[data-restock]");
    if (rs) {
      const row = rs.closest(".prow"), n = parseInt($("[data-f=restock]", row).value, 10);
      if (!(n > 0)) return toast("Enter how many you bought, e.g. 5");
      rs.disabled = true;
      try { await API.restock(rs.dataset.restock, n); toast(`Added ${n} to stock`); await loadProducts(); }
      catch (ex) { toast("Couldn't restock: " + ex.message); rs.disabled = false; }
      return;
    }
    const sv = e.target.closest("[data-save]"); if (!sv) return;
    const row = sv.closest(".prow"), p = products.find((x) => x.id === sv.dataset.save);
    const price = num($("[data-f=price]", row).value), cost = num($("[data-f=cost]", row).value);
    const stock = parseInt($("[data-f=stock]", row).value, 10), was = parseInt($("[data-f=stock]", row).dataset.was, 10);
    if (Number.isNaN(price) || (price !== null && price < 0)) return toast("Price must be a number, e.g. 2.50");
    if (cost === null || Number.isNaN(cost) || cost < 0) return toast("Cost must be a number, e.g. 1.06");
    if (!(stock >= 0)) return toast("Stock must be 0 or more");
    sv.disabled = true;
    try {
      await API.updateProduct(p.id, { price, cost, active: $("[data-f=active]", row).checked });
      if (stock !== was) await API.setStock(p.id, was, stock);
      await loadProducts();
      const r = $(`.prow[data-id="${CSS.escape(p.id)}"] .saved`); if (r) { r.hidden = false; setTimeout(() => (r.hidden = true), 2000); }
    } catch (ex) {
      if (ex.code === "stock_changed") { toast("Stock changed meanwhile (an order came in). Reloaded, check and save again."); await loadProducts(); }
      else toast("Couldn't save: " + ex.message);
    } finally { sv.disabled = false; }
  });

  // ---------- product editor ----------
  let editing = null, newImage = null;
  function openEditor(p) {
    editing = p || null; newImage = null;
    $("#pe-title").textContent = p ? "Edit product" : "Add product";
    $("#pe-preview").src = p?.image_url || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'/%3E";
    $("#pe-cn").value = p?.name_cn || ""; $("#pe-en").value = p?.name_en || ""; $("#pe-meta").value = p?.meta || "";
    $("#pe-price").value = p?.price == null ? "" : Number(p.price).toFixed(2); $("#pe-cost").value = p ? Number(p.cost).toFixed(2) : "";
    $("#pe-stock").value = 0; $("#pe-stock-wrap").hidden = !!p;
    $("#pe-sort").value = p?.sort ?? (Math.max(0, ...products.map((x) => x.sort)) + 10);
    $("#pe-active").checked = p ? p.active : true; $("#pe-pre").checked = p ? p.preorder_ok : true;
    $("#pe-err").hidden = true; $("#pe-file").value = "";
    $("#prod-sheet").hidden = false;
  }
  $("#add-product").onclick = () => openEditor(null);
  $("#pe-file").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    newImage = f; $("#pe-preview").src = URL.createObjectURL(f);
  });
  $("#prod-sheet").addEventListener("click", (e) => { if (e.target.id === "prod-sheet" || e.target.closest("[data-close]")) $("#prod-sheet").hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#prod-sheet").hidden = true; });
  $("#pe-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#pe-err"), btn = $("#pe-save");
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    const name_cn = $("#pe-cn").value.trim(), name_en = $("#pe-en").value.trim();
    const price = num($("#pe-price").value), cost = num($("#pe-cost").value) ?? 0;
    const stock = parseInt($("#pe-stock").value || "0", 10), sort = parseInt($("#pe-sort").value || "100", 10);
    if (!name_cn && !name_en) return fail("Give it a Chinese or English name.");
    if (Number.isNaN(price) || (price !== null && price < 0)) return fail("Price must be a number, e.g. 2.50 (or leave empty to keep it out of the shop).");
    if (Number.isNaN(cost) || cost < 0) return fail("Cost must be a number, e.g. 1.06");
    if (!editing && !newImage) return fail("Add a photo of the product.");
    err.hidden = true; btn.disabled = true; btn.textContent = "Saving…";
    try {
      let image_url = editing?.image_url || "";
      if (newImage) image_url = await API.uploadImage(newImage);
      const row = { name_cn, name_en, meta: $("#pe-meta").value.trim(), price, cost, sort, image_url,
        active: $("#pe-active").checked, preorder_ok: $("#pe-pre").checked };
      if (editing) await API.updateProduct(editing.id, row);
      else await API.addProduct({ ...row, id: "p" + Date.now().toString(36), stock: stock > 0 ? stock : 0, purchased: stock > 0 ? stock : 0 });
      $("#prod-sheet").hidden = true; toast(editing ? "Product saved" : "Product added");
      await loadProducts();
    } catch (ex) { fail("Couldn't save: " + ex.message); }
    finally { btn.disabled = false; btn.textContent = "Save product"; }
  });

  // ---------- inventory ----------
  let priv = ls.get("owner.private", false);
  function applyPriv() { document.body.classList.toggle("private", priv); $("#eye").textContent = priv ? "Show numbers" : "Hide numbers"; $("#eye").setAttribute("aria-pressed", String(priv)); }
  $("#eye").onclick = () => { priv = !priv; ls.set("owner.private", priv); applyPriv(); };
  applyPriv();

  function renderInventory() {
    if (tab !== "inventory") return;
    const per = Object.fromEntries(products.map((p) => [p.id, { sold: 0, revenue: 0, profit: 0, reserved: 0, preCost: 0 }]));
    let openValue = 0, openCount = 0;
    for (const o of orders) {
      if (o.status === "new" || o.status === "confirmed") { openValue += Number(o.total); openCount++; }
      for (const i of o.order_items || []) {
        const r = per[i.product_id]; if (!r) continue;
        if (o.status === "delivered") {
          r.sold += i.qty; r.revenue += i.qty * i.unit_price; r.profit += i.qty * (i.unit_price - i.unit_cost);
          if (i.preorder) r.preCost += i.qty * i.unit_cost;
        } else if ((o.status === "new" || o.status === "confirmed") && !i.preorder) r.reserved += i.qty;
      }
    }
    let stockVal = 0, stockCost = 0, units = 0, spent = 0, sold = 0, revenue = 0, profit = 0;
    const rows = products.map((p) => {
      const r = per[p.id], price = p.price == null ? null : Number(p.price), cost = Number(p.cost);
      if (price != null) stockVal += p.stock * price;
      stockCost += p.stock * cost; units += p.stock;
      spent += p.purchased * cost + r.preCost; sold += r.sold; revenue += r.revenue; profit += r.profit;
      return `<tr><td><span class="cn">${esc(p.name_cn || p.name_en)}</span></td>
        <td class="num">${price == null ? "—" : money(price)}</td><td class="num pv">${money(cost)}</td>
        <td class="num pv">${price == null ? "—" : money(price - cost)}</td>
        <td class="num">${p.stock}</td><td class="num">${r.reserved || ""}</td><td class="num">${r.sold || ""}</td>
        <td class="num pv">${r.revenue ? money(r.revenue) : ""}</td><td class="num pv">${r.profit ? money(r.profit) : ""}</td></tr>`;
    }).join("");
    $("#inv").innerHTML = `<thead><tr><th>Product</th><th>Price</th><th>Cost</th><th>Margin</th><th>In stock</th><th>Reserved</th><th>Sold</th><th>Revenue</th><th>Profit</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td>Total</td><td></td><td></td><td></td><td class="num">${units}</td><td></td><td class="num">${sold}</td><td class="num pv">${money(revenue)}</td><td class="num pv">${money(profit)}</td></tr></tfoot>`;
    const stat = (k, v, s, cls) => `<div class="stat ${cls || ""}"><span class="k">${k}</span><span class="v pv ${v < 0 ? "neg" : ""}">${money(v)}</span><span class="s">${s}</span></div>`;
    $("#stats").innerHTML =
      stat("Profit", profit, `${sold} sold · ${money(revenue)} taken in`, "hl") +
      stat("In stock", stockVal, `${units} items at your prices`) +
      stat("Stock cost", stockCost, "what the shelf cost you") +
      stat("Open orders", openValue, `${openCount} waiting for pickup`) +
      stat("Spent", spent, "all stock bought so far");
  }

  function fillSaleSelect() {
    const sel = $("#sale-product"), cur = sel.value;
    sel.innerHTML = products.filter((p) => p.stock > 0).map((p) => `<option value="${esc(p.id)}" ${p.id === cur ? "selected" : ""}>${esc(p.name_cn || p.name_en)} (${p.stock} left)</option>`).join("") || `<option value="">Nothing in stock</option>`;
    const p = products.find((x) => x.id === sel.value); $("#sale-price").placeholder = p?.price != null ? Number(p.price).toFixed(2) : "price";
  }
  $("#sale-product").addEventListener("change", fillSaleSelect);
  $("#sale-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#sale-err"), id = $("#sale-product").value, qty = parseInt($("#sale-qty").value, 10);
    const p = products.find((x) => x.id === id);
    let price = num($("#sale-price").value); if (price === null) price = p?.price != null ? Number(p.price) : null;
    if (!p) { err.textContent = "Choose a product."; err.hidden = false; return; }
    if (!(qty > 0) || qty > p.stock) { err.textContent = `Quantity must be between 1 and ${p.stock}.`; err.hidden = false; return; }
    if (price === null || Number.isNaN(price) || price < 0) { err.textContent = "Enter the price it sold for."; err.hidden = false; return; }
    err.hidden = true;
    try { await API.recordSale(id, qty, price, $("#sale-note").value.trim()); toast("Sale recorded"); $("#sale-qty").value = 1; $("#sale-price").value = ""; $("#sale-note").value = ""; await Promise.all([loadProducts(), loadOrders()]); }
    catch (ex) { err.textContent = "Couldn't record: " + ex.message; err.hidden = false; }
  });

  // ---------- settings ----------
  async function loadSettings() {
    try { settings = await API.getSettings(); } catch (e) { return; }
    $("#shop-label").textContent = settings.shop_name;
    $("#st-name").value = settings.shop_name; $("#st-wechat").value = settings.wechat_contact;
    $("#st-locations").value = (settings.locations || []).join("\n");
    $("#st-pre").value = settings.preorder_days; $("#st-max").value = settings.max_qty; $("#st-open").value = settings.max_open_orders;
    $("#st-notice").value = settings.notice || ""; $("#st-ntfy").value = settings.ntfy_topic || ""; $("#st-owner").textContent = settings.owner_email;
  }
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#st-err");
    const locations = [...new Set($("#st-locations").value.split("\n").map((s) => s.trim()).filter(Boolean))];
    const ntfy = $("#st-ntfy").value.trim();
    const patch = {
      shop_name: $("#st-name").value.trim() || "Garching Snack Shop",
      wechat_contact: $("#st-wechat").value.trim(),
      locations, preorder_days: parseInt($("#st-pre").value, 10), max_qty: parseInt($("#st-max").value, 10),
      max_open_orders: parseInt($("#st-open").value, 10), notice: $("#st-notice").value.trim() || null, ntfy_topic: ntfy || null
    };
    const bad = !locations.length ? "Add at least one meeting spot." :
      !(patch.preorder_days >= 0 && patch.preorder_days <= 60) ? "Preorder days must be 0–60." :
      !(patch.max_qty >= 1 && patch.max_qty <= 99) ? "Max per product must be 1–99." :
      !(patch.max_open_orders >= 1 && patch.max_open_orders <= 50) ? "Max open orders must be 1–50." :
      ntfy && !/^[A-Za-z0-9_-]{6,64}$/.test(ntfy) ? "ntfy topic: 6–64 letters, numbers, - or _." : "";
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    err.hidden = true;
    try { await API.saveSettings(patch); toast("Settings saved"); loadSettings(); }
    catch (ex) { err.textContent = "Couldn't save: " + ex.message; err.hidden = false; }
  });

  boot();
})();
