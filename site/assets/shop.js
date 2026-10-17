(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) => "€" + Number(n || 0).toFixed(2);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };

  let wechat = store.get("shop.wechat", "");
  let cart = store.get("shop.cart", {});           // key -> {id, qty, preorder}
  let shop = { settings: { locations: [], max_qty: 10, preorder_days: 5 }, products: [] };
  const byId = () => Object.fromEntries(shop.products.map((p) => [p.id, p]));
  const tokenKey = () => "shop.orders." + wechat.toLowerCase();
  const tokens = () => store.get(tokenKey(), []);

  // ---------- toast ----------
  let toastT;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200);
  }

  // ---------- WeChat contact (copy) ----------
  function wireCopy() {
    document.querySelectorAll(".copy-wechat").forEach((b) => b.onclick = async () => {
      const id = shop.settings.wechat_contact || $(".wechat-contact").textContent;
      try { await navigator.clipboard.writeText(id); toast("已复制 Copied: " + id); }
      catch (e) { const r = document.createRange(); r.selectNodeContents(b.previousElementSibling); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    });
  }

  // ---------- views ----------
  function showView() {
    const loggedIn = !!wechat;
    $("#login-view").hidden = loggedIn;
    $("#shop-view").hidden = !loggedIn;
    $("#who").hidden = !loggedIn;
    $("#open-orders").hidden = !loggedIn;
    $("#who-id").textContent = wechat;
    renderCartBar();
  }

  $("#login-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#login-id").value.trim();
    const err = $("#login-err");
    if (v.length < 2 || v.length > 40) { err.textContent = "请输入正确的微信号 · Please enter your WeChat ID."; err.hidden = false; return; }
    err.hidden = true;
    wechat = v; store.set("shop.wechat", v);
    showView(); renderShelf();
  });
  $("#logout").onclick = () => { wechat = ""; store.set("shop.wechat", ""); $("#login-id").value = ""; showView(); };

  // ---------- data ----------
  async function loadShop() {
    try {
      shop = await API.getShop();
    } catch (e) {
      $("#shelf").innerHTML = `<div class="empty">${e.code === "not_configured" ? "The shop isn't set up yet." : "Couldn't load the shop. Check your connection and reload."}</div>`;
      return;
    }
    const s = shop.settings || {};
    document.title = s.shop_name || document.title;
    $("#shop-name").textContent = s.shop_name || "Garching Snack Shop";
    document.querySelectorAll(".wechat-contact").forEach((el) => (el.textContent = s.wechat_contact || ""));
    $("#pre-days").textContent = s.preorder_days;
    $("#notice").hidden = !s.notice; $("#notice").textContent = s.notice || "";
    reconcileCart(true);
    renderShelf();
  }

  // Keep the cart honest against current stock.
  function reconcileCart(quiet) {
    const P = byId(), max = shop.settings.max_qty || 10;
    const notes = [];
    for (const [k, l] of Object.entries(cart)) {
      const p = P[l.id];
      if (!p) { delete cart[k]; continue; }
      if (!l.preorder) {
        if (p.stock <= 0) {
          delete cart[k];
          if (p.preorder_ok) { addLine(p, true, l.qty, true); notes.push(`${p.name_cn || p.name_en} sold out, moved to preorder`); }
          else notes.push(`${p.name_cn || p.name_en} sold out`);
        } else if (l.qty > Math.min(p.stock, max)) { l.qty = Math.min(p.stock, max); notes.push(`only ${p.stock} ${p.name_cn || p.name_en} left`); }
      } else if (!p.preorder_ok) { delete cart[k]; notes.push(`${p.name_cn || p.name_en} can't be preordered`); }
      else if (l.qty > max) l.qty = max;
    }
    saveCart();
    if (notes.length && !quiet) toast("购物车已更新 Cart updated: " + notes.join(", "));
    return notes;
  }

  // ---------- cart ----------
  const key = (id, pre) => id + (pre ? ":pre" : "");
  function saveCart() { store.set("shop.cart", cart); renderCartBar(); }
  function lineMax(p, pre) { const m = shop.settings.max_qty || 10; return pre ? m : Math.min(m, p.stock); }
  function addLine(p, pre, qty, silent) {
    const k = key(p.id, pre);
    const cur = cart[k]?.qty || 0;
    const next = Math.max(0, Math.min(lineMax(p, pre), cur + qty));
    if (next === 0) delete cart[k]; else cart[k] = { id: p.id, qty: next, preorder: pre };
    if (!silent) { saveCart(); renderShelf(); if (!$("#cart-sheet").hidden) renderCart(); }
  }
  function cartLines() {
    const P = byId();
    return Object.values(cart).filter((l) => P[l.id]).map((l) => ({ ...l, p: P[l.id] }));
  }
  function renderCartBar() {
    const lines = wechat ? cartLines() : [];
    const n = lines.reduce((a, l) => a + l.qty, 0);
    const sum = lines.reduce((a, l) => a + l.qty * l.p.price, 0);
    $("#cartbar").hidden = n === 0;
    $("#cart-count").textContent = `${n} 件 item${n === 1 ? "" : "s"}`;
    $("#cart-total").textContent = money(sum);
  }

  // ---------- shelf ----------
  function stepper(p, pre, qty) {
    return `<div class="stepper" role="group" aria-label="Quantity">
      <button type="button" data-act="dec" data-id="${esc(p.id)}" data-pre="${pre ? 1 : 0}" aria-label="One less">−</button>
      <span>${qty}</span>
      <button type="button" data-act="inc" data-id="${esc(p.id)}" data-pre="${pre ? 1 : 0}" aria-label="One more" ${qty >= lineMax(p, pre) ? "disabled" : ""}>+</button>
    </div>`;
  }
  function renderShelf() {
    const el = $("#shelf");
    if (!shop.products.length) { el.innerHTML = `<div class="empty">Nothing on the shelf right now. Check back soon.</div>`; return; }
    el.innerHTML = shop.products.map((p) => {
      const out = p.stock <= 0;
      const pre = out && p.preorder_ok;
      const inCart = cart[key(p.id, pre)]?.qty || 0;
      let stockLabel = out ? "售罄 Sold out" : p.stock <= 3 ? `仅剩 ${p.stock} left` : `${p.stock} in stock`;
      let action;
      if (out && !p.preorder_ok) action = `<button class="btn small" disabled>售罄 Sold out</button>`;
      else if (inCart) action = stepper(p, pre, inCart);
      else action = `<button class="btn small ${pre ? "" : "primary"}" type="button" data-act="add" data-id="${esc(p.id)}" data-pre="${pre ? 1 : 0}">${pre ? "预订 Preorder" : "加入 Add"}</button>`;
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
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const p = byId()[b.dataset.id]; if (!p) return;
    const pre = b.dataset.pre === "1";
    if (b.dataset.act === "add" || b.dataset.act === "inc") addLine(p, pre, 1);
    if (b.dataset.act === "dec") addLine(p, pre, -1);
    if (b.dataset.act === "add") toast(pre ? "已加入预订 Added as preorder" : "已加入 Added to cart");
  });

  // ---------- sheets ----------
  function openSheet(id) { $("#toast").hidden = true; $(id).hidden = false; document.body.style.overflow = "hidden"; $(id).querySelector(".x").focus(); }
  function closeSheets() { document.querySelectorAll(".overlay").forEach((o) => (o.hidden = true)); document.body.style.overflow = ""; }
  document.querySelectorAll(".overlay").forEach((o) => {
    o.addEventListener("click", (e) => { if (e.target === o || e.target.closest("[data-close]")) closeSheets(); });
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheets(); });

  // ---------- cart sheet ----------
  $("#open-cart").onclick = () => { renderCart(); openSheet("#cart-sheet"); };
  function renderCart() {
    const lines = cartLines();
    if (!lines.length) { closeSheets(); return; }
    $("#cart-lines").innerHTML = lines.map((l) => `
      <div class="line">
        <img src="${esc(l.p.image_url)}" alt="">
        <div class="t"><div class="n-cn">${esc(l.p.name_cn || l.p.name_en)}</div>
          <div class="sub">${money(l.p.price)} each${l.preorder ? ' · <span class="pre-chip">预订 Preorder</span>' : ""}</div></div>
        <div class="r"><b class="num">${money(l.qty * l.p.price)}</b>${stepper(l.p, l.preorder, l.qty)}</div>
      </div>`).join("");
    $("#cart-sum").textContent = money(lines.reduce((a, l) => a + l.qty * l.p.price, 0));

    const s = shop.settings;
    const sel = $("#co-location"), prev = sel.value || store.get("shop.location", "");
    sel.innerHTML = `<option value="">选择地点 Choose a spot…</option>` +
      (s.locations || []).map((x) => `<option ${x === prev ? "selected" : ""}>${esc(x)}</option>`).join("");

    const hasPre = lines.some((l) => l.preorder);
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
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  const ERR = {
    bad_preorder_date: () => `请选择至少 ${shop.settings.preorder_days} 天后的日期 · Pick a date at least ${shop.settings.preorder_days} days from today.`,
    bad_location: () => "请选择见面地点 · Choose a meeting spot on the Garching campus.",
    too_many_open_orders: () => "你还有未完成的订单 · You already have several open orders. Message me on WeChat or wait until they're delivered.",
    bad_qty: () => `每样最多 ${shop.settings.max_qty} 件 · Max ${shop.settings.max_qty} of each product.`,
    bad_wechat: () => "请检查微信号 · Check your WeChat ID (tap Change at the top).",
    empty_cart: () => "购物车是空的 · Your cart is empty.",
    not_configured: () => "The shop isn't set up yet."
  };
  $("#checkout").addEventListener("input", () => ($("#co-err").hidden = true));
  $("#checkout").addEventListener("change", () => ($("#co-err").hidden = true));
  $("#checkout").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#co-err"), btn = $("#co-submit");
    const lines = cartLines();
    const location = $("#co-location").value;
    const hasPre = lines.some((l) => l.preorder);
    const wanted = hasPre ? $("#co-date").value : null;
    const showErr = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: "nearest" }); };
    if (!location) return showErr(ERR.bad_location());
    if (hasPre && (!wanted || wanted < shop.settings.earliest_preorder)) return showErr(ERR.bad_preorder_date());
    err.hidden = true; btn.disabled = true; btn.textContent = "提交中… Placing order…";
    try {
      const res = await API.placeOrder({
        wechat_id: wechat, location, note: $("#co-note").value.trim(), wanted_date: wanted,
        items: lines.map((l) => ({ id: l.id, qty: l.qty, preorder: !!l.preorder }))
      });
      store.set(tokenKey(), [res.token, ...tokens()].slice(0, 50));
      store.set("shop.location", location);
      cart = {}; saveCart(); $("#co-note").value = "";
      showDone(res, location);
      loadShop();
    } catch (ex) {
      const c = ex.code || "";
      if (c.startsWith("out_of_stock:") || c.startsWith("unavailable:") || c.startsWith("no_preorder:")) {
        await loadShop();
        reconcileCart(false);
        renderCart();
        showErr("有商品刚刚卖完了 · Something in your cart just sold out. Your cart was updated; check it and try again.");
      } else {
        showErr((ERR[c] && ERR[c]()) || "下单失败 · Couldn't place the order. Check your connection and try again.");
      }
    } finally { btn.disabled = false; btn.textContent = "下单 Place order"; }
  });

  function showDone(res, location) {
    $("#cart-lines").innerHTML = "";
    $("#cart-body").querySelectorAll(".totalrow, #checkout").forEach((x) => (x.hidden = true));
    const box = document.createElement("div");
    box.className = "done"; box.id = "done-box";
    box.innerHTML = `<h3>下单成功 · Order placed</h3>
      <div class="code">${esc(res.code)}</div>
      <p>Total <b class="num">${money(res.total)}</b> · ${esc(location)}${res.wanted_date ? `<br>Preorder for <b>${fmtDate(res.wanted_date)}</b>` : ""}</p>
      <p class="hint">我会在微信上联系你约时间 · I'll message you on WeChat to arrange the handover.<br>Please have cash, PayPal or WeChat Pay ready.</p>
      <button class="btn" type="button" id="done-orders">查看订单 See my orders</button>`;
    $("#cart-body").appendChild(box);
    $("#done-orders").onclick = () => { closeSheets(); openOrders(); };
    const reset = () => { box.remove(); $("#cart-body").querySelectorAll(".totalrow, #checkout").forEach((x) => (x.hidden = false)); };
    const obs = new MutationObserver(() => { if ($("#cart-sheet").hidden) { reset(); obs.disconnect(); } });
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
    try { list = await API.getMyOrders(tokens()); }
    catch (e) { body.innerHTML = `<div class="empty">Couldn't load your orders. Check your connection.</div>`; return; }
    if (!list.length) { body.innerHTML = `<div class="empty">还没有订单 · No orders on this phone yet.</div>`; return; }
    body.innerHTML = list.map((o) => `
      <div class="ord">
        <div class="top"><span class="code">${esc(o.code)}</span><span class="status ${o.status}">${STATUS[o.status] || o.status}</span>
          <span class="muted small" style="margin-left:auto">${new Date(o.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>
        <ul>${(o.items || []).map((i) => `<li>${i.qty} × ${esc(i.name_cn || i.name_en)}${i.preorder ? ' <span class="pre-chip">预订</span>' : ""}</li>`).join("")}</ul>
        <div class="small muted">${esc(o.location)}${o.wanted_date ? ` · preorder for <b>${fmtDate(o.wanted_date)}</b>` : ""}</div>
        <div class="top"><b class="num">${money(o.total)}</b>
          ${o.status === "new" ? `<button class="btn small ghost" type="button" data-cancel="${esc(o.token)}" style="margin-left:auto">取消订单 Cancel</button>` : ""}</div>
      </div>`).join("") +
      `<p class="hint">Orders are saved on this phone. Questions? WeChat <b class="num">${esc(shop.settings.wechat_contact || "")}</b></p>`;
  }
  $("#orders-body").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cancel]"); if (!b) return;
    if (b.dataset.confirm !== "1") { b.dataset.confirm = "1"; b.textContent = "确定取消？Tap again to cancel"; return; }
    b.disabled = true;
    try { await API.cancelMyOrder(b.dataset.cancel); toast("订单已取消 Order cancelled"); loadShop(); openOrders(); }
    catch (ex) { toast(ex.code === "cannot_cancel" ? "Already confirmed. Message me on WeChat to change it." : "Couldn't cancel. Try again."); b.disabled = false; }
  });

  // ---------- start ----------
  wireCopy();
  showView();
  loadShop();
  window.addEventListener("focus", () => { if (wechat) loadShop(); });
})();
