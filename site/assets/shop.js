(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "€" + Number(n || 0).toFixed(2);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let session = store.get("shop.session", null);   // {token, username, wechat_id}
  let cart = store.get("shop.cart2", {});            // key -> {id, qty, preorder} | {bundle, qty, picks}
  let shop = { settings: { locations: [], max_qty: 10, preorder_days: 5 }, products: [], bundles: [] };
  const byId = () => Object.fromEntries(shop.products.map((p) => [p.id, p]));
  const name = (x) => x.name_cn || x.name_en;
  const shelfProducts = () => shop.products.filter((p) => p.on_shelf && p.price != null);
  const optionsFor = (cat) => shop.products.filter((p) => p.category === cat);

  // ---------- toast ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200);
  }

  document.querySelectorAll(".copy-wechat").forEach((b) => b.onclick = async () => {
    const id = shop.settings.wechat_contact || b.previousElementSibling.textContent;
    try { await navigator.clipboard.writeText(id); toast("已复制 Copied: " + id); }
    catch (e) { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  });

  // ---------- login ----------
  function showView() {
    const inn = !!session;
    $("#login-view").hidden = inn;
    $("#shop-view").hidden = !inn;
    $("#who").hidden = !inn;
    $("#open-orders").hidden = !inn;
    $("#who-id").textContent = inn ? session.username : "";
    renderCartBar();
  }
  function endSession(msg) {
    session = null; store.set("shop.session", null);
    closeSheets(); showView();
    if (msg) { const e = $("#login-err"); e.textContent = msg; e.hidden = false; }
  }
  const LOGIN_ERR = {
    bad_login: "用户名或密码不对 · Wrong username or password.",
    locked: "尝试次数过多，请15分钟后再试 · Too many tries. Wait 15 minutes, or message me on WeChat.",
    account_disabled: "账号已停用 · This account is switched off. Message me on WeChat."
  };
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = $("#login-user").value.trim(), p = $("#login-pass").value;
    const err = $("#login-err"), btn = $("#login-btn");
    if (!u || !p) { err.textContent = "请输入用户名和密码 · Enter your username and password."; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true;
    try {
      const r = await API.login(u, p);
      session = { token: r.token, username: r.username, wechat_id: r.wechat_id };
      store.set("shop.session", session);
      $("#login-pass").value = "";
      showView(); renderAll();
    } catch (ex) {
      err.textContent = LOGIN_ERR[ex.code] || "登录失败 · Couldn't log in. Check your connection and try again.";
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
  $("#logout").onclick = async () => {
    const t = session?.token;
    endSession();
    if (t) { try { await API.logout(t); } catch (e) {} }
  };

  // ---------- data ----------
  async function loadShop() {
    try { shop = await API.getShop(); }
    catch (e) {
      $("#shelf").innerHTML = `<div class="empty">${e.code === "not_configured" ? "The shop isn't set up yet." : "Couldn't load the shop. Check your connection and reload."}</div>`;
      return;
    }
    const s = shop.settings || {};
    document.title = s.shop_name || document.title;
    $("#shop-name").textContent = s.shop_name || "Garching Snack Shop";
    document.querySelectorAll(".wechat-contact").forEach((el) => (el.textContent = s.wechat_contact || ""));
    $("#pre-days").textContent = s.preorder_days;
    $("#area-name").textContent = (s.locations || [])[0] || "Garching";
    $("#notice").hidden = !s.notice; $("#notice").textContent = s.notice || "";
    reconcileCart(true);
    renderAll();
  }

  // ---------- stock bookkeeping across the whole cart ----------
  function needs(exceptKey) {
    const n = {};
    for (const [k, l] of Object.entries(cart)) {
      if (k === exceptKey) continue;
      if (l.bundle) {
        for (const picks of Object.values(l.picks)) for (const [pid, c] of Object.entries(picks)) n[pid] = (n[pid] || 0) + c * l.qty;
      } else if (!l.preorder) n[l.id] = (n[l.id] || 0) + l.qty;
    }
    return n;
  }
  const freeStock = (pid, exceptKey) => (byId()[pid]?.stock || 0) - (needs(exceptKey)[pid] || 0);

  // Can this set be filled at all right now?
  function setAvailable(b) {
    return b.slots.length > 0 && b.slots.every((s) => optionsFor(s.category).reduce((a, p) => a + Math.max(0, freeStock(p.id)), 0) >= s.qty);
  }

  // ---------- cart ----------
  const singleKey = (id, pre) => "p:" + id + (pre ? ":pre" : "");
  const setKey = (bid, picks) => "b:" + bid + ":" + JSON.stringify(Object.keys(picks).sort().map((s) => [s, Object.entries(picks[s]).filter(([, c]) => c > 0).sort()]));
  function saveCart() { store.set("shop.cart2", cart); renderCartBar(); }

  function reconcileCart(quiet) {
    const P = byId(), B = Object.fromEntries(shop.bundles.map((b) => [b.id, b])), max = shop.settings.max_qty || 10;
    const notes = [];
    for (const [k, l] of Object.entries(cart)) {
      if (l.bundle) {
        const b = B[l.bundle];
        const ok = b && b.slots.length === Object.keys(l.picks).length && b.slots.every((s) => {
          const picks = l.picks[s.id]; if (!picks) return false;
          const total = Object.values(picks).reduce((a, c) => a + c, 0);
          return total === s.qty && Object.keys(picks).every((pid) => P[pid] && P[pid].category === s.category);
        });
        if (!ok) { delete cart[k]; notes.push(`${b ? name(b) : "a meal set"} changed, please choose again`); continue; }
        if (l.qty > max) l.qty = max;
        continue;
      }
      const p = P[l.id];
      if (!p || !p.on_shelf || p.price == null) { delete cart[k]; continue; }
      if (!l.preorder && l.qty > Math.min(p.stock, max)) {
        if (p.stock <= 0) {
          delete cart[k];
          if (p.preorder_ok) { cart[singleKey(p.id, true)] = { id: p.id, qty: Math.min(l.qty, max), preorder: true }; notes.push(`${name(p)} sold out, moved to preorder`); }
          else notes.push(`${name(p)} sold out`);
        } else { l.qty = Math.min(p.stock, max); notes.push(`only ${p.stock} ${name(p)} left`); }
      } else if (l.preorder && !p.preorder_ok) { delete cart[k]; notes.push(`${name(p)} can't be preordered`); }
    }
    // meal sets drawing on the same stock: trim the last ones that no longer fit
    for (const [k, l] of Object.entries(cart)) {
      if (!l.bundle) continue;
      while (l.qty > 0 && Object.values(l.picks).some((picks) => Object.keys(picks).some((pid) => freeStock(pid, k) < picks[pid] * l.qty))) l.qty--;
      if (l.qty === 0) { delete cart[k]; notes.push("a meal set sold out"); }
    }
    saveCart();
    if (notes.length && !quiet) toast("购物车已更新 Cart updated: " + notes.join(", "));
  }

  function lineMaxSingle(p, pre, key) { const m = shop.settings.max_qty || 10; return pre ? m : Math.min(m, freeStock(p.id, key)); }
  function lineMaxSet(l, key) {
    let m = shop.settings.max_qty || 10;
    for (const picks of Object.values(l.picks)) for (const [pid, c] of Object.entries(picks)) if (c > 0) m = Math.min(m, Math.floor(freeStock(pid, key) / c));
    return m;
  }
  function bump(key, d) {
    const l = cart[key]; if (!l) return;
    const max = l.bundle ? lineMaxSet(l, key) : lineMaxSingle(byId()[l.id], l.preorder, key);
    l.qty = Math.max(0, Math.min(max, l.qty + d));
    if (!l.qty) delete cart[key];
    saveCart(); renderAll(); if (!$("#cart-sheet").hidden) renderCart();
  }
  function addSingle(p, pre) {
    const k = singleKey(p.id, pre);
    if (cart[k]) return bump(k, 1);
    if (lineMaxSingle(p, pre, k) < 1) return toast("没有库存了 · No more in stock");
    cart[k] = { id: p.id, qty: 1, preorder: pre };
    saveCart(); renderAll();
    toast(pre ? "已加入预订 Added as preorder" : "已加入 Added to cart");
  }
  function lineTotal(l) {
    if (l.bundle) { const b = shop.bundles.find((x) => x.id === l.bundle); return b ? l.qty * b.price : 0; }
    const p = byId()[l.id]; return p ? l.qty * p.price : 0;
  }
  function renderCartBar() {
    const lines = session ? Object.values(cart) : [];
    const n = lines.reduce((a, l) => a + l.qty, 0);
    $("#cartbar").hidden = n === 0;
    $("#cart-count").textContent = `${n} 件 item${n === 1 ? "" : "s"}`;
    $("#cart-total").textContent = money(lines.reduce((a, l) => a + lineTotal(l), 0));
  }

  // ---------- meal sets ----------
  function renderSets() {
    const sets = shop.bundles;
    $("#sets-section").hidden = !sets.length;
    $("#sets").innerHTML = sets.map((b) => {
      const ok = setAvailable(b);
      const imgs = b.slots.map((s) => optionsFor(s.category).find((p) => p.stock > 0) || optionsFor(s.category)[0]).filter(Boolean).slice(0, 3);
      return `<article class="set ${ok ? "" : "soldout"}">
        <div class="set-imgs">${imgs.map((p) => `<img src="${esc(p.image_url)}" alt="" loading="lazy">`).join("")}</div>
        <div class="info">
          <div class="n-cn">${esc(b.name_cn)}</div>
          <div class="n-en">${esc(b.name_en)}</div>
          <ul class="slots">${b.slots.map((s) => `<li>${s.qty > 1 ? s.qty + " × " : ""}${esc(s.label_cn)} <span class="muted">${esc(s.label_en)}</span>${s.is_gift ? ' <span class="gift">送 free</span>' : ""}</li>`).join("")}</ul>
          <div class="row"><span class="tag">${money(b.price)}</span>
            ${ok ? `<button class="btn small primary" type="button" data-set="${esc(b.id)}">选择 Choose</button>` : `<button class="btn small" disabled>售罄 Sold out</button>`}</div>
        </div>
      </article>`;
    }).join("");
  }

  // configurator
  let picking = null; // {b, picks: {slotId: {pid: n}}}
  function openSet(b) {
    picking = { b, picks: {} };
    for (const s of b.slots) {
      picking.picks[s.id] = {};
      const opts = optionsFor(s.category).filter((p) => freeStock(p.id) > 0);
      if (s.qty === 1 && opts.length === 1) picking.picks[s.id][opts[0].id] = 1; // only one choice: preselect
    }
    $("#set-title").textContent = name(b);
    renderPicker();
    openSheet("#set-sheet");
  }
  function slotCount(sid) { return Object.values(picking.picks[sid]).reduce((a, c) => a + c, 0); }
  function renderPicker() {
    const { b } = picking;
    $("#set-slots").innerHTML = b.slots.map((s) => {
      const opts = optionsFor(s.category);
      const have = slotCount(s.id);
      const head = `<div class="slot-head"><b>${esc(s.label_cn)}</b> <span class="muted">${esc(s.label_en)}</span>
        ${s.is_gift ? '<span class="gift">送 free</span>' : ""}<span class="count ${have === s.qty ? "done" : ""}">${have}/${s.qty}</span></div>`;
      if (!opts.length) return `<div class="slot">${head}<div class="hint">暂时没有 · Nothing available right now</div></div>`;
      return `<div class="slot">${head}<div class="opts">${opts.map((p) => {
        const n = picking.picks[s.id][p.id] || 0;
        const free = freeStock(p.id) - otherSlotUse(s.id, p.id);
        const out = free <= 0 && !n;
        const ctrl = s.qty === 1
          ? `<span class="radio ${n ? "on" : ""}" aria-hidden="true"></span>`
          : `<span class="stepper"><button type="button" data-dec="${s.id}|${esc(p.id)}" ${n ? "" : "disabled"} aria-label="One less">−</button><span>${n}</span><button type="button" data-inc="${s.id}|${esc(p.id)}" ${have >= s.qty || free <= 0 ? "disabled" : ""} aria-label="One more">+</button></span>`;
        return `<${s.qty === 1 ? "button type=\"button\"" : "div"} class="opt ${n ? "on" : ""} ${out ? "out" : ""}" ${s.qty === 1 && !out ? `data-pick="${s.id}|${esc(p.id)}"` : ""} ${s.qty === 1 && out ? "disabled" : ""}>
          <img src="${esc(p.image_url)}" alt="">
          <span class="t"><span class="n-cn">${esc(p.name_cn)}</span><span class="sub">${out ? "售罄 sold out" : esc(p.meta || p.name_en)}</span></span>
          ${ctrl}
        </${s.qty === 1 ? "button" : "div"}>`;
      }).join("")}</div></div>`;
    }).join("");
    const complete = b.slots.every((s) => slotCount(s.id) === s.qty);
    const btn = $("#set-add");
    btn.disabled = !complete;
    btn.textContent = complete ? `加入购物车 Add to cart · ${money(b.price)}` : "请选择 Choose everything above";
    $("#set-err").hidden = true;
  }
  // same product picked in another slot of this set (e.g. if two slots share a category)
  function otherSlotUse(sid, pid) {
    let n = 0; for (const [s, picks] of Object.entries(picking.picks)) if (s !== String(sid)) n += picks[pid] || 0; return n;
  }
  $("#set-slots").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]"), inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]");
    const el = pick || inc || dec; if (!el) return;
    const [sid, pid] = (el.dataset.pick || el.dataset.inc || el.dataset.dec).split("|");
    const slot = picking.picks[sid];
    if (pick) { picking.picks[sid] = { [pid]: 1 }; }
    else if (inc) slot[pid] = (slot[pid] || 0) + 1;
    else if (dec) { slot[pid] = Math.max(0, (slot[pid] || 0) - 1); if (!slot[pid]) delete slot[pid]; }
    renderPicker();
  });
  $("#set-add").onclick = () => {
    const { b, picks } = picking;
    const clean = {};
    for (const s of b.slots) clean[s.id] = Object.fromEntries(Object.entries(picks[s.id]).filter(([, c]) => c > 0));
    const k = setKey(b.id, clean);
    const line = cart[k] || { bundle: b.id, qty: 0, picks: clean };
    if (lineMaxSet(line, k) < line.qty + 1) { const err = $("#set-err"); err.textContent = "库存不够 · Not enough stock for this combination."; err.hidden = false; return; }
    line.qty += 1; cart[k] = line;
    saveCart(); closeSheets(); renderAll();
    toast("已加入 Added to cart");
  };

  // ---------- single items ----------
  function stepper(key, qty, max) {
    return `<div class="stepper" role="group" aria-label="Quantity">
      <button type="button" data-bump="${esc(key)}" data-d="-1" aria-label="One less">−</button>
      <span>${qty}</span>
      <button type="button" data-bump="${esc(key)}" data-d="1" aria-label="One more" ${qty >= max ? "disabled" : ""}>+</button>
    </div>`;
  }
  function renderShelf() {
    const el = $("#shelf"), list = shelfProducts();
    $("#shelf-title").hidden = !list.length && shop.bundles.length > 0;
    if (!list.length) { el.innerHTML = shop.bundles.length ? "" : `<div class="empty">Nothing on the shelf right now. Check back soon.</div>`; return; }
    el.innerHTML = list.map((p) => {
      const out = p.stock <= 0;
      const pre = out && p.preorder_ok;
      const k = singleKey(p.id, pre);
      const inCart = cart[k]?.qty || 0;
      const stockLabel = out ? "售罄 Sold out" : p.stock <= 3 ? `仅剩 ${p.stock} left` : `${p.stock} in stock`;
      let action;
      if (out && !p.preorder_ok) action = `<button class="btn small" disabled>售罄 Sold out</button>`;
      else if (inCart) action = stepper(k, inCart, lineMaxSingle(p, pre, k));
      else action = `<button class="btn small ${pre ? "" : "primary"}" type="button" data-add="${esc(p.id)}" data-pre="${pre ? 1 : 0}">${pre ? "预订 Preorder" : "加入 Add"}</button>`;
      return `<article class="prod ${out ? "soldout" : ""}">
        <div class="ph"><img src="${esc(p.image_url)}" alt="${esc(p.name_en)}" loading="lazy"><span class="stock ${out ? "out" : p.stock <= 3 ? "low" : ""}">${stockLabel}</span></div>
        <div class="info">
          <div class="n-cn">${esc(p.name_cn)}</div>
          <div class="n-en">${esc(p.name_en)}</div>
          ${p.meta ? `<div class="meta">${esc(p.meta)}</div>` : ""}
          ${pre ? `<div class="pre-chip">预订 · ready in ${shop.settings.preorder_days}+ days</div>` : ""}
          <div class="row"><span class="tag">${money(p.price)}</span>${action}</div>
        </div>
      </article>`;
    }).join("");
  }
  function renderAll() { if (!session) return; renderSets(); renderShelf(); renderCartBar(); }

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-add]");
    if (a) { const p = byId()[a.dataset.add]; if (p) addSingle(p, a.dataset.pre === "1"); return; }
    const b = e.target.closest("[data-bump]");
    if (b) { bump(b.dataset.bump, Number(b.dataset.d)); return; }
    const s = e.target.closest("[data-set]");
    if (s) { const set = shop.bundles.find((x) => x.id === s.dataset.set); if (set) openSet(set); }
  });

  // ---------- sheets ----------
  function openSheet(id) { $("#toast").hidden = true; closeSheets(true); $(id).hidden = false; document.body.style.overflow = "hidden"; $(id).querySelector(".x").focus(); }
  function closeSheets(keepScroll) { document.querySelectorAll(".overlay").forEach((o) => (o.hidden = true)); if (!keepScroll) document.body.style.overflow = ""; }
  document.querySelectorAll(".overlay").forEach((o) => {
    o.addEventListener("click", (e) => { if (e.target === o || e.target.closest("[data-close]")) closeSheets(); });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });

  // ---------- cart sheet ----------
  $("#open-cart").onclick = () => { renderCart(); openSheet("#cart-sheet"); };
  function renderCart() {
    const P = byId();
    const entries = Object.entries(cart);
    if (!entries.length) { closeSheets(); return; }
    $("#cart-lines").innerHTML = entries.map(([k, l]) => {
      if (l.bundle) {
        const b = shop.bundles.find((x) => x.id === l.bundle); if (!b) return "";
        const parts = b.slots.flatMap((s) => Object.entries(l.picks[s.id] || {}).map(([pid, c]) =>
          `<li>${c > 1 ? c + " × " : ""}${esc(P[pid] ? name(P[pid]) : pid)}${s.is_gift ? ' <span class="gift">送</span>' : ""}</li>`));
        const firstImg = P[Object.keys(l.picks[b.slots[0].id] || {})[0]];
        return `<div class="line">
          <img src="${esc(firstImg?.image_url || "")}" alt="">
          <div class="t"><div class="n-cn">${esc(name(b))}</div><ul class="sub parts">${parts.join("")}</ul></div>
          <div class="r"><b class="num">${money(lineTotal(l))}</b>${stepper(k, l.qty, lineMaxSet(l, k))}</div>
        </div>`;
      }
      const p = P[l.id]; if (!p) return "";
      return `<div class="line">
        <img src="${esc(p.image_url)}" alt="">
        <div class="t"><div class="n-cn">${esc(name(p))}</div>
          <div class="sub">${money(p.price)} each${l.preorder ? ' · <span class="pre-chip">预订 Preorder</span>' : ""}</div></div>
        <div class="r"><b class="num">${money(lineTotal(l))}</b>${stepper(k, l.qty, lineMaxSingle(p, l.preorder, k))}</div>
      </div>`;
    }).join("");
    $("#cart-sum").textContent = money(Object.values(cart).reduce((a, l) => a + lineTotal(l), 0));

    const s = shop.settings, locs = s.locations || [];
    const sel = $("#co-location");
    if (locs.length > 1) {
      const prev = sel.value || store.get("shop.location", "");
      sel.innerHTML = `<option value="">选择地点 Choose a spot…</option>` + locs.map((x) => `<option ${x === prev ? "selected" : ""}>${esc(x)}</option>`).join("");
      sel.hidden = false; $("#co-area").hidden = true;
    } else {
      sel.hidden = true; $("#co-area").hidden = false;
      $("#co-area").innerHTML = `<b>${esc(locs[0] || "Garching")}</b><span class="hint">只限这个区域 · Only available here. We'll agree on the exact spot and time on WeChat.</span>`;
    }

    const hasPre = Object.values(cart).some((l) => l.preorder);
    $("#co-date-wrap").hidden = !hasPre;
    const d = $("#co-date");
    d.min = s.earliest_preorder;
    const max = new Date(s.earliest_preorder); max.setDate(max.getDate() + 85);
    d.max = max.toISOString().slice(0, 10);
    if (hasPre && (!d.value || d.value < d.min)) d.value = d.min;
    $("#co-date-hint").textContent = `Earliest ${fmtDate(s.earliest_preorder)} (${s.preorder_days} days, so I can order it in).`;
    $("#co-err").hidden = true;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  const ERR = {
    bad_preorder_date: () => `请选择至少 ${shop.settings.preorder_days} 天后的日期 · Pick a date at least ${shop.settings.preorder_days} days from today.`,
    bad_location: () => "请选择地点 · Choose a pickup spot.",
    too_many_open_orders: () => "你还有未完成的订单 · You already have several open orders. Message me on WeChat or wait until they're delivered.",
    bad_qty: () => `每样最多 ${shop.settings.max_qty} 件 · Max ${shop.settings.max_qty} of each.`,
    empty_cart: () => "购物车是空的 · Your cart is empty.",
    not_configured: () => "The shop isn't set up yet."
  };
  $("#checkout").addEventListener("input", () => ($("#co-err").hidden = true));
  $("#checkout").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#co-err"), btn = $("#co-submit");
    const lines = Object.values(cart);
    const locs = shop.settings.locations || [];
    const location = locs.length > 1 ? $("#co-location").value : locs[0];
    const hasPre = lines.some((l) => l.preorder);
    const wanted = hasPre ? $("#co-date").value : null;
    const showErr = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: "nearest" }); };
    if (!location) return showErr(ERR.bad_location());
    if (hasPre && (!wanted || wanted < shop.settings.earliest_preorder)) return showErr(ERR.bad_preorder_date());
    err.hidden = true; btn.disabled = true; btn.textContent = "提交中… Placing order…";
    try {
      const res = await API.placeOrder({
        session: session.token, location, note: $("#co-note").value.trim(), wanted_date: wanted,
        items: lines.map((l) => l.bundle ? { bundle: l.bundle, qty: l.qty, picks: l.picks } : { id: l.id, qty: l.qty, preorder: !!l.preorder })
      });
      if (locs.length > 1) store.set("shop.location", location);
      cart = {}; saveCart(); $("#co-note").value = "";
      showDone(res);
      loadShop();
    } catch (ex) {
      const c = ex.code || "";
      if (c === "login_required") return endSession("请重新登录 · Please log in again.");
      if (/^(out_of_stock|unavailable|no_preorder|bad_picks):/.test(c)) {
        await loadShop(); reconcileCart(false); renderCart();
        showErr("有商品刚刚卖完或有变动 · Something in your cart just sold out or changed. Your cart was updated; check it and try again.");
      } else showErr((ERR[c] && ERR[c]()) || "下单失败 · Couldn't place the order. Check your connection and try again.");
    } finally { btn.disabled = false; btn.textContent = "下单 Place order"; }
  });

  function showDone(res) {
    $("#cart-lines").innerHTML = "";
    $("#cart-body").querySelectorAll(".totalrow, #checkout").forEach((x) => (x.hidden = true));
    const box = document.createElement("div");
    box.className = "done";
    box.innerHTML = `<h3>下单成功 · Order placed</h3>
      <div class="code">${esc(res.code)}</div>
      <p>Total <b class="num">${money(res.total)}</b> · ${esc(res.location)}${res.wanted_date ? `<br>Preorder for <b>${fmtDate(res.wanted_date)}</b>` : ""}</p>
      <p class="hint">我会在微信上联系你约时间和地点 · I'll message you on WeChat to arrange the time and spot.<br>Please have cash, PayPal or WeChat Pay ready.</p>
      <button class="btn" type="button" id="done-orders">查看订单 See my orders</button>`;
    $("#cart-body").appendChild(box);
    $("#done-orders").onclick = () => { openOrders(); };
    const obs = new MutationObserver(() => {
      if ($("#cart-sheet").hidden) { box.remove(); $("#cart-body").querySelectorAll(".totalrow, #checkout").forEach((x) => (x.hidden = false)); obs.disconnect(); }
    });
    obs.observe($("#cart-sheet"), { attributes: true, attributeFilter: ["hidden"] });
  }

  // ---------- my orders ----------
  $("#open-orders").onclick = openOrders;
  const STATUS = { new: "待确认 Waiting", confirmed: "已确认 Confirmed", delivered: "已完成 Delivered", cancelled: "已取消 Cancelled" };
  async function openOrders() {
    openSheet("#orders-sheet");
    const body = $("#orders-body");
    body.innerHTML = `<div class="empty">Loading…</div>`;
    let list;
    try { list = await API.myOrders(session.token); }
    catch (e) {
      if (e.code === "login_required") return endSession("请重新登录 · Please log in again.");
      body.innerHTML = `<div class="empty">Couldn't load your orders. Check your connection.</div>`; return;
    }
    if (!list.length) { body.innerHTML = `<div class="empty">还没有订单 · No orders yet.</div>`; return; }
    body.innerHTML = list.map((o) => {
      const items = o.items || [];
      const sets = (o.bundles || []).map((b) => `<li><b>${b.qty > 1 ? b.qty + " × " : ""}${esc(b.name_cn || b.name_en)}</b><ul>${items.filter((i) => i.order_bundle_id === b.id)
        .map((i) => `<li>${i.qty} × ${esc(i.name_cn || i.name_en)}${i.is_gift ? ' <span class="gift">送</span>' : ""}</li>`).join("")}</ul></li>`).join("");
      const singles = items.filter((i) => !i.order_bundle_id).map((i) => `<li>${i.qty} × ${esc(i.name_cn || i.name_en)}${i.preorder ? ' <span class="pre-chip">预订</span>' : ""}</li>`).join("");
      return `<div class="ord">
        <div class="top"><span class="code">${esc(o.code)}</span><span class="status ${o.status}">${STATUS[o.status] || o.status}</span>
          <span class="muted small" style="margin-left:auto">${new Date(o.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
        <ul>${sets}${singles}</ul>
        <div class="small muted">${esc(o.location)}${o.wanted_date ? ` · preorder for <b>${fmtDate(o.wanted_date)}</b>` : ""}</div>
        <div class="top"><b class="num">${money(o.total)}</b>
          ${o.status === "new" ? `<button class="btn small ghost" type="button" data-cancel="${esc(o.code)}" style="margin-left:auto">取消订单 Cancel</button>` : ""}</div>
      </div>`;
    }).join("") + `<p class="hint">Questions? WeChat <b class="num">${esc(shop.settings.wechat_contact || "")}</b></p>`;
  }
  $("#orders-body").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cancel]"); if (!b) return;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "确定取消？Tap again to cancel"; return; }
    b.disabled = true;
    try { await API.cancelOrder(session.token, b.dataset.cancel); toast("订单已取消 Order cancelled"); loadShop(); openOrders(); }
    catch (ex) { toast(ex.code === "cannot_cancel" ? "Already confirmed. Message me on WeChat to change it." : "Couldn't cancel. Try again."); b.disabled = false; }
  });

  // ---------- start ----------
  async function boot() {
    showView();
    await loadShop();
    if (session) {
      try { const me = await API.me(session.token); session = { ...session, ...me }; store.set("shop.session", session); showView(); renderAll(); }
      catch (e) { if (e.code === "login_required") endSession(); }
    }
  }
  boot();
  window.addEventListener("focus", () => { if (session) loadShop(); });
})();
