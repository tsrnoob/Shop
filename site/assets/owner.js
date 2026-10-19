(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => (n < 0 ? "−€" : "€") + Math.abs(Number(n || 0)).toFixed(2);
  const num = (v) => { if (v === null || v === undefined || String(v).trim() === "") return null; const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : NaN; };
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };

  let orders = [], products = [], settings = null, customers = [], bundles = [];
  const CATS = { main: "饭/火锅 Rice & hot pot", drink: "饮料 Drink", konjac: "魔芋爽单包 Konjac pack", guoba: "锅巴 Guoba", water: "水 Water", snack: "零食 Snack" };
  const catOptions = (sel) => Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === sel ? "selected" : ""}>${v}</option>`).join("");
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
    await Promise.all([loadSettings(), loadProducts(), loadCustomers(), loadBundles()]);
    await loadOrders();
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
    if (t === "menus") renderBundles();
    if (t === "customers") renderCustomers();
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
      const un = (customers.find((c) => c.id === o.customer_id)?.username || "").toLowerCase();
      if (s && !(o.wechat_id.toLowerCase().includes(s) || o.code.toLowerCase().includes(s) || un.includes(s))) return false;
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
      const cust = customers.find((c) => c.id === o.customer_id);
      const sets = (o.order_bundles || []).map((b) => `<li><b>${b.qty > 1 ? b.qty + " × " : ""}${esc(b.name_cn || b.name_en)}</b> <span class="muted">@ ${money(b.unit_price)}</span><ul>${items.filter((i) => i.order_bundle_id === b.id)
        .map((i) => `<li>${i.qty} × ${esc(i.name_cn || i.name_en)}${i.is_gift ? ' <span class="gift">gift</span>' : ""}</li>`).join("")}</ul></li>`).join("");
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
        <div class="wx"><span class="muted small">WeChat</span><b>${esc(o.wechat_id)}</b>${o.is_offline ? "" : `<button class="btn small ghost" data-copy="${esc(o.wechat_id)}">Copy</button>`}${cust ? `<span class="muted small">· ${esc(cust.username)}</span>` : ""}</div>
        <div class="small"><span class="muted">Meet at</span> <b>${esc(o.location)}</b></div>
        ${due}
        ${o.note ? `<div class="note">“${esc(o.note)}”</div>` : ""}
        <ul class="setgroup">${sets}${items.filter((i) => !i.order_bundle_id).map((i) => `<li>${i.qty} × ${esc(i.name_cn || i.name_en)} <span class="muted">@ ${money(i.unit_price)}</span>${i.preorder ? ' <span class="pre-chip">preorder</span>' : ""}</li>`).join("")}</ul>
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
    try { products = await API.listProducts(); renderProducts(quiet); renderInventory(); fillSaleSelect(); if (!quiet) renderBundles(); }
    catch (e) { if (!quiet) $("#products").innerHTML = `<div class="empty">Couldn't load products: ${esc(e.message)}</div>`; }
  }
  function renderProducts(keepEdits) {
    // don't wipe a row the owner is typing in
    if (keepEdits && $("#products").contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName)) return;
    if (!products.length) { $("#products").innerHTML = `<div class="empty">No products yet. Add your first one.</div>`; return; }
    $("#products").innerHTML = products.map((p) => {
      const flags = [];
      flags.push(`<span class="flag">${esc(CATS[p.category] || p.category)}</span>`);
      if (!p.on_shelf) flags.push(`<span class="flag">Only in meal sets</span>`);
      else if (p.price == null) flags.push(`<span class="flag warn">No price · not sold alone</span>`);
      if (!p.active) flags.push(`<span class="flag">Hidden</span>`);
      if (p.stock <= 0) flags.push(`<span class="flag">Sold out${p.preorder_ok ? " · preorder on" : ""}</span>`);
      return `<div class="prow ${p.active && (p.price != null || !p.on_shelf) ? "" : "off"}" data-id="${esc(p.id)}">
        <img src="${esc(p.image_url)}" alt="" data-open="${esc(p.id)}">
        <div class="t"><div class="n-cn">${esc(p.name_cn)}</div><div class="n-en">${esc(p.name_en)}</div><div class="flags">${flags.join("")}</div></div>
        <button class="btn small ghost" data-open="${esc(p.id)}">Edit</button>
        <div class="edit">
          <label class="mini"><span>Price €</span><input data-f="price" inputmode="decimal" value="${p.price == null ? "" : Number(p.price).toFixed(2)}" placeholder="—"></label>
          <label class="mini"><span>Cost €</span><input data-f="cost" inputmode="decimal" value="${Number(p.cost).toFixed(2)}"></label>
          <label class="mini"><span>Stock</span><input data-f="stock" type="number" min="0" inputmode="numeric" value="${p.stock}" data-was="${p.stock}"></label>
          <div class="mini stockbox"><div><span>Restock</span><input data-f="restock" type="number" min="1" inputmode="numeric" placeholder="+0"></div><button class="btn small" data-restock="${esc(p.id)}">Add</button></div>
          <label class="mini"><span>Category</span><select data-f="category">${catOptions(p.category)}</select></label>
          <label class="check"><input type="checkbox" data-f="active" ${p.active ? "checked" : ""}> In shop</label>
          <label class="check"><input type="checkbox" data-f="on_shelf" ${p.on_shelf ? "checked" : ""}> Sell alone</label>
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
      await API.updateProduct(p.id, { price, cost, active: $("[data-f=active]", row).checked,
        on_shelf: $("[data-f=on_shelf]", row).checked, category: $("[data-f=category]", row).value });
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
    $("#pe-shelf").checked = p ? p.on_shelf : true; $("#pe-cat").innerHTML = catOptions(p?.category || "snack");
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
    if (Number.isNaN(price) || (price !== null && price < 0)) return fail("Price must be a number, e.g. 2.50 (or leave empty if it's only used in meal sets).");
    if (Number.isNaN(cost) || cost < 0) return fail("Cost must be a number, e.g. 1.06");
    if (!editing && !newImage) return fail("Add a photo of the product.");
    err.hidden = true; btn.disabled = true; btn.textContent = "Saving…";
    try {
      let image_url = editing?.image_url || "";
      if (newImage) image_url = await API.uploadImage(newImage);
      const row = { name_cn, name_en, meta: $("#pe-meta").value.trim(), price, cost, sort, image_url,
        active: $("#pe-active").checked, preorder_ok: $("#pe-pre").checked,
        on_shelf: $("#pe-shelf").checked, category: $("#pe-cat").value };
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
    const per = Object.fromEntries(products.map((p) => [p.id, { sold: 0, inSets: 0, revenue: 0, profit: 0, reserved: 0, preCost: 0 }]));
    const perSet = {};
    let openValue = 0, openCount = 0;
    for (const o of orders) {
      const open = o.status === "new" || o.status === "confirmed";
      if (open) { openValue += Number(o.total); openCount++; }
      for (const b of o.order_bundles || []) {
        if (o.status !== "delivered") continue;
        const r = perSet[b.bundle_id] || (perSet[b.bundle_id] = { name: b.name_cn || b.name_en, sold: 0, revenue: 0, cost: 0 });
        r.sold += b.qty; r.revenue += b.qty * b.unit_price;
      }
      for (const i of o.order_items || []) {
        const r = per[i.product_id]; if (!r) continue;
        if (o.status === "delivered") {
          if (i.order_bundle_id) {
            r.inSets += i.qty;
            const ob = (o.order_bundles || []).find((b) => b.id === i.order_bundle_id);
            if (ob && perSet[ob.bundle_id]) perSet[ob.bundle_id].cost += i.qty * i.unit_cost;
          } else {
            r.sold += i.qty; r.revenue += i.qty * i.unit_price; r.profit += i.qty * (i.unit_price - i.unit_cost);
          }
          if (i.preorder) r.preCost += i.qty * i.unit_cost;
        } else if (open && !i.preorder) r.reserved += i.qty;
      }
    }
    let stockVal = 0, stockCost = 0, units = 0, spent = 0, sold = 0, revenue = 0, profit = 0;
    const rows = products.map((p) => {
      const r = per[p.id], price = p.price == null ? null : Number(p.price), cost = Number(p.cost);
      if (price != null && p.on_shelf) stockVal += p.stock * price;
      stockCost += p.stock * cost; units += p.stock;
      spent += p.purchased * cost + r.preCost; sold += r.sold; revenue += r.revenue; profit += r.profit;
      return `<tr><td><span class="cn">${esc(p.name_cn || p.name_en)}</span></td>
        <td class="num">${price == null ? "—" : money(price)}</td><td class="num pv">${money(cost)}</td>
        <td class="num pv">${price == null ? "—" : money(price - cost)}</td>
        <td class="num">${p.stock}</td><td class="num">${r.reserved || ""}</td>
        <td class="num">${r.sold || ""}${r.inSets ? ` <span class="muted">+${r.inSets} in sets</span>` : ""}</td>
        <td class="num pv">${r.revenue ? money(r.revenue) : ""}</td><td class="num pv">${r.profit ? money(r.profit) : ""}</td></tr>`;
    }).join("");
    const setRows = Object.values(perSet).map((s) => {
      const pr = s.revenue - s.cost; sold += s.sold; revenue += s.revenue; profit += pr;
      return `<tr><td><b class="cn">${esc(s.name)}</b></td><td></td><td class="num pv">${money(s.cost / s.sold)}</td><td class="num pv">${money(pr / s.sold)}</td>
        <td></td><td></td><td class="num">${s.sold}</td><td class="num pv">${money(s.revenue)}</td><td class="num pv">${money(pr)}</td></tr>`;
    }).join("");
    $("#inv").innerHTML = `<thead><tr><th>Product</th><th>Price</th><th>Cost</th><th>Margin</th><th>In stock</th><th>Reserved</th><th>Sold</th><th>Revenue</th><th>Profit</th></tr></thead>
      <tbody>${setRows}${rows}</tbody>
      <tfoot><tr><td>Total</td><td></td><td></td><td></td><td class="num">${units}</td><td></td><td class="num">${sold}</td><td class="num pv">${money(revenue)}</td><td class="num pv">${money(profit)}</td></tr></tfoot>`;
    const stat = (k, v, s, cls) => `<div class="stat ${cls || ""}"><span class="k">${k}</span><span class="v pv ${v < 0 ? "neg" : ""}">${money(v)}</span><span class="s">${s}</span></div>`;
    $("#stats").innerHTML =
      stat("Profit", profit, `${sold} sold · ${money(revenue)} taken in`, "hl") +
      stat("In stock", stockVal, `${units} items · single items at your prices`) +
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
    $("#st-disc").value = Number(settings.bundle_discount ?? 1).toFixed(2); $("#st-minp").value = Number(settings.bundle_min_profit ?? 1.5).toFixed(2);
    $("#mh-disc").textContent = money(settings.bundle_discount ?? 1); $("#mh-minp").textContent = money(settings.bundle_min_profit ?? 1.5);
    renderBundles();
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
      max_open_orders: parseInt($("#st-open").value, 10), notice: $("#st-notice").value.trim() || null, ntfy_topic: ntfy || null,
      bundle_discount: num($("#st-disc").value), bundle_min_profit: num($("#st-minp").value)
    };
    const bad = !locations.length ? "Add at least one meeting spot." :
      !(patch.preorder_days >= 0 && patch.preorder_days <= 60) ? "Preorder days must be 0–60." :
      !(patch.max_qty >= 1 && patch.max_qty <= 99) ? "Max per product must be 1–99." :
      !(patch.max_open_orders >= 1 && patch.max_open_orders <= 50) ? "Max open orders must be 1–50." :
      ntfy && !/^[A-Za-z0-9_-]{6,64}$/.test(ntfy) ? "ntfy topic: 6–64 letters, numbers, - or _." :
      !(patch.bundle_discount >= 0 && patch.bundle_discount <= 50) ? "Menu discount must be a number, e.g. 1.00" :
      !(patch.bundle_min_profit >= 0 && patch.bundle_min_profit <= 50) ? "Menu minimum profit must be a number, e.g. 1.50" : "";
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    err.hidden = true;
    try { await API.saveSettings(patch); toast("Settings saved"); loadSettings(); }
    catch (ex) { err.textContent = "Couldn't save: " + ex.message; err.hidden = false; }
  });

  // ---------- customers ----------
  let custSearch = "";
  async function loadCustomers() {
    try { customers = await API.listCustomers(); renderCustomers(); }
    catch (e) { $("#customers").innerHTML = `<div class="empty">Couldn't load customers: ${esc(e.message)}</div>`; }
  }
  function credText(username) {
    return `${settings?.shop_name || "Garching Snack Shop"} 账号 / account\n网址 Website: ${location.origin}\n用户名 Username: ${username}`;
  }
  function showCred(title, username) {
    $("#cred-title").textContent = title;
    $("#cred-text").textContent = credText(username);
    $("#cred").hidden = false; $("#cred").scrollIntoView({ block: "nearest" });
  }
  $("#cred-copy").onclick = () => copy($("#cred-text").textContent);
  $("#cred-close").onclick = () => { $("#cred").hidden = true; $("#cred-text").textContent = ""; };
  function renderCustomers() {
    if (tab !== "customers") return;
    const s = custSearch.toLowerCase();
    const list = customers.filter((c) => !s || c.username.toLowerCase().includes(s) || c.wechat_id.toLowerCase().includes(s));
    if (!list.length) { $("#customers").innerHTML = `<div class="empty">${customers.length ? "No match." : "No customers yet. Create the first account above."}</div>`; return; }
    $("#customers").innerHTML = list.map((c) => {
      const n = orders.filter((o) => o.customer_id === c.id && o.status !== "cancelled").length;
      return `<div class="crow ${c.active ? "" : "off"}" data-cid="${c.id}">
        <div><div class="u">${esc(c.username)}</div>
          <div class="meta"><span>WeChat <b>${esc(c.wechat_id)}</b></span><span>${n} order${n === 1 ? "" : "s"}</span>
            <span>${c.last_login_at ? "last login " + new Date(c.last_login_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "never logged in"}</span>
            ${c.active ? "" : '<span class="flag">Switched off</span>'}
            ${c.note ? `<span>“${esc(c.note)}”</span>` : ""}</div></div>
        <div class="acts">
          <button class="btn small" data-cact="msg">Copy login message</button>
          <button class="btn small ${c.active ? "ghost" : "primary"}" data-cact="toggle">${c.active ? "Switch off" : "Switch on"}</button>
          <button class="btn small ghost" data-cact="edit">Edit</button>
        </div>
        <div class="editline" hidden>
          <input data-ce="wechat_id" value="${esc(c.wechat_id)}" maxlength="40" aria-label="WeChat ID">
          <input data-ce="note" value="${esc(c.note)}" maxlength="200" placeholder="Note" aria-label="Note">
          <button class="btn small primary" data-cact="save">Save</button>
        </div>
      </div>`;
    }).join("");
  }
  $("#cust-search").addEventListener("input", (e) => { custSearch = e.target.value.trim(); renderCustomers(); });
  $("#cust-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#cu-err"), btn = $("#cu-save");
    const u = $("#cu-user").value.trim(), w = $("#cu-wechat").value.trim();
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(u)) { err.textContent = "Username: 3–30 letters, numbers, . _ or -"; err.hidden = false; return; }
    if (w.length < 2) { err.textContent = "Enter their WeChat ID."; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true;
    try {
      const r = await API.createCustomer(u, w, $("#cu-note").value.trim());
      showCred(`Account created for ${r.username}`, r.username);
      $("#cu-user").value = ""; $("#cu-wechat").value = ""; $("#cu-note").value = "";
      await loadCustomers();
    } catch (ex) {
      err.textContent = ex.code === "username_taken" ? "That username is already taken." : ex.code === "bad_username" ? "Username: 3–30 letters, numbers, . _ or -" : "Couldn't create: " + ex.message;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
  $("#customers").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cact]"); if (!b) return;
    const row = b.closest(".crow"), id = Number(row.dataset.cid), c = customers.find((x) => x.id === id);
    const act = b.dataset.cact;
    if (act === "edit") { $(".editline", row).hidden = !$(".editline", row).hidden; return; }
    if (act === "msg") return copy(credText(c.username));
    b.disabled = true;
    try {
      if (act === "toggle") { await API.setCustomerActive(id, !c.active); toast(c.active ? `${c.username} switched off and logged out` : `${c.username} switched on`); }
      if (act === "save") {
        const w = $("[data-ce=wechat_id]", row).value.trim();
        if (w.length < 2) { toast("Enter their WeChat ID."); b.disabled = false; return; }
        await API.updateCustomer(id, { wechat_id: w, note: $("[data-ce=note]", row).value.trim() }); toast("Saved");
      }
      await loadCustomers();
    } catch (ex) { toast("Couldn't do that: " + ex.message); b.disabled = false; }
  });

  // ---------- menus (meal sets) ----------
  // Names and choices are fixed; the owner only ticks which products each choice offers.
  // Every tick is saved straight away.
  async function loadBundles() {
    try { bundles = await API.listBundles(); renderBundles(); }
    catch (e) { $("#bundles").innerHTML = `<div class="empty">Couldn't load menus: ${esc(e.message)}</div>`; }
  }
  const cents = (x) => Math.round(Number(x) * 100);
  const slotsOf = (b) => [...(b.bundle_slots || [])].sort((x, y) => x.sort - y.sort || x.id - y.id);
  // Same rule as the database: round UP to 10 cents of max(shop prices − discount, costs + minimum profit)
  function menuPrice(retailC, costC) {
    const disc = cents(settings?.bundle_discount ?? 1), minp = cents(settings?.bundle_min_profit ?? 1.5);
    return Math.ceil(Math.max(retailC - disc, costC + minp) / 10) * 10;
  }
  // all paid combinations of a menu, with price, saving and profit
  function menuCombos(slots) {
    const P = Object.fromEntries(products.map((p) => [p.id, p]));
    const paid = slots.filter((s) => !s.is_gift), gifts = slots.filter((s) => s.is_gift);
    let giftC = 0; const giftEmpty = [];
    for (const g of gifts) {
      const cs = (g.options || []).map((id) => P[id]).filter((p) => p && p.active).map((p) => cents(p.cost));
      if (!cs.length) giftEmpty.push(g.label_cn || g.label_en || "gift"); else giftC += Math.max(...cs) * g.qty;
    }
    const noPrice = new Set();
    let acc = paid.length ? [{ ids: [], r: 0, c: 0 }] : [];
    for (const s of paid) {
      const opts = (s.options || []).map((id) => P[id]).filter((p) => p && p.active);
      opts.filter((p) => p.price == null).forEach((p) => noPrice.add(p.name_cn || p.name_en));
      const priced = opts.filter((p) => p.price != null);
      acc = acc.flatMap((a) => priced.map((p) => ({ ids: [...a.ids, p.id], r: a.r + cents(p.price) * s.qty, c: a.c + cents(p.cost) * s.qty })));
    }
    const combos = acc.map((a) => { const price = menuPrice(a.r, a.c + giftC); return { ...a, price, save: a.r - price, profit: price - a.c - giftC }; });
    return { combos, giftEmpty, noPrice: [...noPrice] };
  }
  function pricePreview(slots) {
    const { combos, giftEmpty, noPrice } = menuCombos(slots);
    const P = Object.fromEntries(products.map((p) => [p.id, p]));
    const notes = (giftEmpty.length ? `<div class="avail">Free ${giftEmpty.map(esc).join(", ")}: nothing ticked, so the shop shows it as included and its cost counts as €0. Tick a product once you have one.</div>` : "")
      + (noPrice.length ? `<div class="avail bad">Left out because they have no price yet: ${noPrice.map(esc).join(", ")}</div>` : "");
    if (!combos.length) return `<div class="avail bad">Not shown in the shop: tick at least one product with a price in every paid choice.</div>` + notes;
    const groups = new Map();
    for (const c of combos) { if (!groups.has(c.price)) groups.set(c.price, []); groups.get(c.price).push(c); }
    const inStock = (c) => c.ids.every((id) => (P[id]?.stock || 0) > 0);
    const rng = (arr) => { const lo = Math.min(...arr), hi = Math.max(...arr); return lo === hi ? money(lo / 100) : `${money(lo / 100)}–${money(hi / 100)}`; };
    const rows = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([price, cs]) => {
      const saves = cs.map((c) => c.save), n = cs.filter(inStock).length;
      return `<tr class="${n ? "" : "muted"}"><td class="num"><b>${money(price / 100)}</b></td><td class="num">${Math.max(...saves) <= 0 ? "no saving" : rng(saves)}</td><td class="num pv">${rng(cs.map((c) => c.profit))}</td>
        <td>${cs.map((c) => `<span class="${inStock(c) ? "" : "muted"}">${c.ids.map((id) => esc(P[id]?.name_cn || id)).join(" + ")}</span>`).join("<br>")}</td>
        <td class="num">${n ? `${n}/${cs.length}` : "sold out"}</td></tr>`;
    }).join("");
    return `<div class="tablewrap"><table class="inv combos"><thead><tr><th>Price</th><th>Saving</th><th>Profit</th><th>Combinations (one card in the shop per price)</th><th>In stock</th></tr></thead><tbody>${rows}</tbody></table></div>` + notes;
  }
  function choiceBlock(s) {
    const opts = new Set(s.options || []);
    const catName = CATS[s.category] || s.category;
    const list = products.filter((p) => p.active && (p.category === s.category || opts.has(p.id)));
    return `<div class="mchoice" data-sid="${s.id}">
      <div class="mhead"><b class="cn">${esc(s.label_cn)}</b> <span class="muted">${esc(s.label_en)}</span>
        ${s.is_gift ? `<span class="gifttag">free gift${s.qty > 1 ? " × " + s.qty : ""}</span>` : ""}
        <span class="muted small" style="margin-left:auto">${opts.size} ticked</span></div>
      <div class="ticks">${list.length ? list.map((p) => `<label class="tick ${opts.has(p.id) ? "on" : ""}"><input type="checkbox" data-opt="${esc(p.id)}" ${opts.has(p.id) ? "checked" : ""}>
        <img src="${esc(p.image_url)}" alt=""><span><span class="cn">${esc(p.name_cn || p.name_en)}</span>
        <span class="muted small">${p.price == null ? (s.is_gift ? "" : "no price · ") : money(p.price) + " · "}cost ${money(p.cost)} · <span class="${p.stock > 0 ? "" : "warn"}">${p.stock} left</span></span></span></label>`).join("")
        : `<span class="muted small">No ${esc(catName)} products yet. Add one under Products (category ${esc(catName)}) and it shows up here to tick.</span>`}</div>
    </div>`;
  }
  function renderBundles() {
    if (tab !== "menus") return;
    if (!bundles.length) { $("#bundles").innerHTML = `<div class="empty">No menus yet.</div>`; return; }
    $("#bundles").innerHTML = bundles.map((b) => `<div class="bcard ${b.active ? "" : "off"}" data-bid="${esc(b.id)}">
        <div class="head"><div class="n-cn">${esc(b.name_cn)}<div class="muted small">${esc(b.name_en)}</div></div>
          <label class="check"><input type="checkbox" data-b="active" ${b.active ? "checked" : ""}> In shop</label></div>
        ${slotsOf(b).map(choiceBlock).join("")}
        <div class="preview">${pricePreview(slotsOf(b))}</div>
      </div>`).join("");
  }
  $("#bundles").addEventListener("change", async (e) => {
    const card = e.target.closest(".bcard"); if (!card) return;
    const b = bundles.find((x) => x.id === card.dataset.bid); if (!b) return;
    const box = e.target;
    if (box.matches("[data-b=active]")) {
      box.disabled = true;
      try { await API.updateBundle(b.id, { active: box.checked }); b.active = box.checked; card.classList.toggle("off", !b.active); toast(b.active ? "Menu is in the shop" : "Menu hidden from the shop"); }
      catch (ex) { box.checked = !box.checked; toast("Couldn't save: " + ex.message); }
      box.disabled = false; return;
    }
    if (!box.matches("[data-opt]")) return;
    const sid = Number(box.closest(".mchoice").dataset.sid);
    const s = (b.bundle_slots || []).find((x) => x.id === sid); if (!s) return;
    const before = [...(s.options || [])];
    const after = box.checked ? [...before.filter((id) => id !== box.dataset.opt), box.dataset.opt] : before.filter((id) => id !== box.dataset.opt);
    box.closest(".tick").classList.toggle("on", box.checked);
    box.disabled = true;
    try {
      await API.setSlotOptions(sid, after);
      s.options = after;
      $(".mhead .small", box.closest(".mchoice")).textContent = `${after.length} ticked`;
      $(".preview", card).innerHTML = pricePreview(slotsOf(b));
      toast("Saved");
    } catch (ex) {
      box.checked = !box.checked; box.closest(".tick").classList.toggle("on", box.checked);
      toast("Couldn't save: " + ex.message);
    }
    box.disabled = false;
  });

  boot();
})();
