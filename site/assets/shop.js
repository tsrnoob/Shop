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
  // shop tabs; "all" also shows the meal sets
  const SECTIONS = [["all", "全部", "All"], ["rice", "饭", "Rice"], ["hotpot", "火锅", "Hot pot"], ["breakfast", "早餐", "Breakfast"], ["snack", "零食", "Snacks"], ["drink", "饮料", "Drinks"]];
  const secOf = (p) => p.section || ({ main: "rice", drink: "drink", water: "drink" }[p.category] || "snack");
  let section = "all";
  const optsOf = (slot) => { const P = byId(); return (slot.options || []).map((id) => P[id]).filter(Boolean); };
  const paidSlots = (b) => b.slots.filter((s) => !s.is_gift);
  const giftSlots = (b) => b.slots.filter((s) => s.is_gift);
  // a gift with nothing ticked (e.g. water before there's a water product) is just included, nothing to pick
  const fixedGift = (s) => s.is_gift && !optsOf(s).length;
  const need = (s) => (fixedGift(s) ? 0 : s.qty);
  // only paid choices use up stock that decides availability; gifts are handed out from what's there
  function paidPicksOf(l) { const b = shop.bundles.find((x) => x.id === l.bundle); return b ? paidSlots(b).map((s) => l.picks[s.id] || {}) : []; }
  // combination price for the chosen paid items (null if that combination isn't offered)
  function comboFor(b, picks) {
    const ids = paidSlots(b).map((s) => Object.keys(picks[s.id] || {}).find((pid) => picks[s.id][pid] > 0));
    if (ids.some((x) => !x)) return null;
    return (b.combos || []).find((c) => c.p.every((pid, i) => pid === ids[i])) || null;
  }
  // menus split into one card per price; combinations with the same price share a card
  function tiersOf(b) {
    const m = new Map();
    for (const c of b.combos || []) { const k = Number(c.price).toFixed(2); if (!m.has(k)) m.set(k, []); m.get(k).push(c); }
    return [...m.entries()].sort((x, y) => Number(x[0]) - Number(y[0])).map(([price, combos]) => ({ price: Number(price), combos }));
  }

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
    $("#menu-btn").hidden = !inn;
    closeDrops();
    $("#who-id").textContent = inn ? session.username : "";
    renderCartBar();
    fillAds();
    setHeaderOffset();
  }
  function endSession(msg) {
    session = null; store.set("shop.session", null);
    closeSheets(); showView();
    if (msg) { const e = $("#login-err"); e.textContent = msg; e.hidden = false; }
  }
  const LOGIN_ERR = {
    bad_login: "找不到这个用户名 · Username not found. Check it, or message me on WeChat.",
    locked: "尝试次数过多，请15分钟后再试 · Too many tries. Wait 15 minutes, or message me on WeChat.",
    account_disabled: "账号已停用 · This account is switched off. Message me on WeChat."
  };
  $("#login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = $("#login-user").value.trim();
    const err = $("#login-err"), btn = $("#login-btn");
    if (!u) { err.textContent = "请输入用户名 · Enter your username."; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true;
    try {
      const r = await API.login(u);
      session = { token: r.token, username: r.username, wechat_id: r.wechat_id };
      store.set("shop.session", session);
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
    $("#area-name").textContent = (s.locations || [])[0] || "Garching";
    $("#notice").hidden = !s.notice; $("#notice").textContent = s.notice || "";
    renderStatus(s);
    setupAds(s);
    reconcileCart(true);
    renderAll();
  }

  // ---------- stock bookkeeping across the whole cart ----------
  function needs(exceptKey) {
    const n = {};
    for (const [k, l] of Object.entries(cart)) {
      if (k === exceptKey) continue;
      if (l.bundle) {
        if (l.preorder) continue;
        for (const picks of paidPicksOf(l)) for (const [pid, c] of Object.entries(picks)) n[pid] = (n[pid] || 0) + c * l.qty;
      } else if (!l.preorder) n[l.id] = (n[l.id] || 0) + l.qty;
    }
    return n;
  }
  const freeStock = (pid, exceptKey) => (byId()[pid]?.stock || 0) - (needs(exceptKey)[pid] || 0);

  // Can this price group be filled right now? Only the paid items' stock counts.
  const comboInStock = (b, c) => paidSlots(b).every((s, i) => freeStock(c.p[i]) >= s.qty);
  const tierAvailable = (b, tier) => tier.combos.some((c) => comboInStock(b, c));
  // a combination can be preordered when all its paid items allow preorders
  const comboPre = (b, c) => { const P = byId(); return paidSlots(b).every((s, i) => P[c.p[i]]?.preorder_ok); };
  const comboAvail = (b, c) => comboInStock(b, c) || comboPre(b, c);
  const setAny = (b) => (b.combos || []).some((c) => comboAvail(b, c));

  // ---------- cart ----------
  const singleKey = (id, pre) => "p:" + id + (pre ? ":pre" : "");
  const setKey = (bid, picks, pre) => "b:" + bid + (pre ? ":pre" : "") + ":" + JSON.stringify(Object.keys(picks).sort().map((s) => [s, Object.entries(picks[s]).filter(([, c]) => c > 0).sort()]));
  function saveCart() { store.set("shop.cart2", cart); renderCartBar(); }

  function reconcileCart(quiet) {
    const P = byId(), B = Object.fromEntries(shop.bundles.map((b) => [b.id, b])), max = shop.settings.max_qty || 10;
    const notes = [];
    for (const [k, l] of Object.entries(cart)) {
      if (l.bundle) {
        const b = B[l.bundle];
        const ok = b && b.slots.every((s) => {
          const picks = l.picks[s.id] || {};
          const total = Object.values(picks).reduce((a, c) => a + c, 0);
          return total === need(s) && Object.keys(picks).every((pid) => P[pid] && (s.options || []).includes(pid));
        }) && comboFor(b, l.picks);
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
      if (!l.bundle || l.preorder) continue;
      const orig = l.qty;
      while (l.qty > 0 && paidPicksOf(l).some((picks) => Object.keys(picks).some((pid) => freeStock(pid, k) < picks[pid] * l.qty))) l.qty--;
      if (l.qty === orig) continue;
      const b = B[l.bundle], c = b && comboFor(b, l.picks);
      if (c && comboPre(b, c)) {
        const pk = setKey(l.bundle, l.picks, true);
        cart[pk] = { bundle: l.bundle, picks: l.picks, preorder: true, qty: Math.min(max, (cart[pk]?.qty || 0) + orig - l.qty) };
        notes.push(`${name(b)} sold out, moved to preorder`);
      } else notes.push("a meal set sold out");
      if (l.qty === 0) delete cart[k];
    }
    saveCart();
    if (notes.length && !quiet) toast("购物车已更新 Cart updated: " + notes.join(", "));
  }

  function lineMaxSingle(p, pre, key) { const m = shop.settings.max_qty || 10; return pre ? m : Math.min(m, freeStock(p.id, key)); }
  function lineMaxSet(l, key) {
    let m = shop.settings.max_qty || 10;
    if (l.preorder) return m;
    for (const picks of paidPicksOf(l)) for (const [pid, c] of Object.entries(picks)) if (c > 0) m = Math.min(m, Math.floor(freeStock(pid, key) / c));
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
    if (l.bundle) { const b = shop.bundles.find((x) => x.id === l.bundle); const c = b && comboFor(b, l.picks); return c ? l.qty * c.price : 0; }
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
  // The shop shows a single meal-set card; everything is chosen in the picker:
  // first which set, then its items, with the saving shown on every option.
  const allTier = (b) => ({ combos: b.combos || [] });
  const saving = (c) => Number(c.retail) - Number(c.price);
  const saveRange = (cs) => { const s = cs.map(saving); return { lo: Math.min(...s), hi: Math.max(...s) }; };
  const fmtSave = ({ lo, hi }) => (hi <= 0.005 ? "" : Math.abs(hi - lo) < 0.005 ? `省 save ${money(hi)}` : `省 save ${money(lo)}–${money(hi)}`);
  function memberImgs(b) {
    const P = byId(), cs = b.combos || [];
    const first = cs.find((c) => comboInStock(b, c)) || cs[0];
    return [...(first ? first.p.map((id) => P[id]) : []), ...giftSlots(b).map((s) => optsOf(s).find((p) => p.stock > 0) || optsOf(s)[0])].filter(Boolean);
  }
  const setOk = (b) => tierAvailable(b, allTier(b));
  function renderSets() {
    const bs = shop.bundles.filter((b) => (b.combos || []).length);
    $("#sets-section").hidden = !bs.length || section !== "all";
    if (!bs.length) { $("#sets").innerHTML = ""; return; }
    const ok = bs.some(setOk), pre = !ok && bs.some(setAny);
    const live = bs.filter(setOk), pool = live.length ? live : bs.filter(setAny).length ? bs.filter(setAny) : bs;
    const all = pool.flatMap((b) => b.combos.filter((c) => (live.length ? comboInStock(b, c) : comboAvail(b, c))));
    const from = Math.min(...all.map((c) => Number(c.price))), best = Math.max(...all.map(saving));
    // pictures: one from each set in turn, no repeats, at most 3
    const lists = pool.map(memberImgs), imgs = [];
    for (let k = 0; imgs.length < 3 && lists.some((l) => l[k]); k++) for (const l of lists) if (l[k] && !imgs.includes(l[k]) && imgs.length < 3) imgs.push(l[k]);
    $("#sets").innerHTML = `<article class="set setall ${ok ? "" : pre ? "pre" : "soldout"}">
        <div class="set-imgs">${imgs.map((p) => `<img src="${esc(p.image_url)}" alt="" loading="lazy">`).join("")}</div>
        <div class="info">
          <div class="n-cn">套餐 <span class="n-en">Meal sets</span></div>
          <ul class="slots">${bs.map((b) => `<li class="${setOk(b) ? "" : setAny(b) ? "" : "muted"}">${esc(b.name_cn)}${setOk(b) ? "" : setAny(b) ? ' <span class="pre-chip">· 可预订 preorder</span>' : " · 售罄 sold out"}</li>`).join("")}</ul>
          ${pre ? `<div class="prenote"><span>今天没货，可以预订<br>Out right now · preorder, I'll tell you on WeChat when it's in</span></div>` : ""}
          <div class="row"><span class="price-wrap"><span class="tag">${money(from)} 起</span>${best > 0.005 ? `<span class="save">最多省 ${money(best)} · save up to ${money(best)}</span>` : ""}</span>
            ${ok ? `<button class="btn primary" type="button" data-setall>选择套餐 Choose</button>` : pre ? `<button class="btn prebtn" type="button" data-setall>预订套餐 Preorder</button>` : `<button class="btn" disabled>售罄 Sold out</button>`}</div>
        </div>
      </article>`;
  }

  // configurator: pick a set (when there are several), then its items
  let picking = null; // {members, mi, b, tier, picks: {slotId: {pid: n}}}
  function openSet() {
    const members = shop.bundles.filter((b) => (b.combos || []).length);
    if (!members.length) return;
    picking = { members };
    // step 1: pick the set (skipped when there is only one); step 2: pick its items
    if (members.length > 1) { picking.step = "set"; renderPicker(); }
    else setMember(0);
    openSheet("#set-sheet");
  }
  function setMember(mi) {
    const b = picking.members[mi];
    Object.assign(picking, { step: "items", mi, b, tier: allTier(b), picks: {} });
    for (const s of b.slots) picking.picks[s.id] = {};
    autoPick();
    renderPicker();
    $("#set-sheet .sheet").scrollTop = 0;
  }
  // step 1: one big card per set with what's in it
  function renderSetStep() {
    const { members } = picking;
    $("#set-title").textContent = "选择套餐 · Choose a meal set";
    $("#set-slots").innerHTML = `<div class="setpick-list">${members.map((m, i) => {
      const ok = setOk(m), pre = !ok && setAny(m), can = ok || pre;
      const cs = m.combos.filter((c) => (ok ? comboInStock(m, c) : comboAvail(m, c)));
      const imgs = memberImgs(m).slice(0, 3);
      const sv = can ? fmtSave(saveRange(cs)) : "";
      const lines = m.slots.map((s) => {
        if (s.is_gift) {
          const o = optsOf(s);
          const what = o.length === 1 ? (o[0].name_cn || o[0].name_en) : s.label_cn;
          return `<li>${s.qty > 1 ? s.qty + " × " : ""}${esc(what)}${o.length > 1 ? " <span class=\"muted\">(口味任选 any flavour)</span>" : ""} <span class="gift">送 free</span></li>`;
        }
        const n = new Set(m.combos.map((c) => c.p[paidSlots(m).indexOf(s)])).size;
        return `<li>${esc(s.label_cn)} <span class="muted">${esc(s.label_en)}</span> · ${n} 种 choice${n === 1 ? "" : "s"}</li>`;
      }).join("");
      return `<button type="button" class="setpick ${ok ? "" : pre ? "pre" : "out"}" ${can ? `data-member="${i}"` : "disabled"}>
        <span class="setpick-imgs">${imgs.map((p) => `<img src="${esc(p.image_url)}" alt="">`).join("")}</span>
        <span class="setpick-body">
          <span class="n-cn">${esc(m.name_cn)}</span>
          <span class="n-en">${esc(m.name_en)}</span>
          <ul class="slots">${lines}</ul>
          ${pre ? `<span class="prenote"><span>今天没货，可以预订 · Out right now, preorder it</span></span>` : ""}
          <span class="setpick-foot">${can ? `<span class="tag">${money(Math.min(...cs.map((c) => Number(c.price))))} 起</span>${sv ? `<span class="save">${sv}</span>` : ""}<span class="go">${ok ? "选这个 Choose →" : "预订 Preorder →"}</span>` : `<span class="muted">售罄 Sold out</span>`}</span>
        </span>
      </button>`;
    }).join("")}</div>`;
    $("#set-add").hidden = true;
    $("#set-err").hidden = true;
  }
  // combinations still possible if this product is taken in paid choice i, given the other picks
  function combosWith(i, pid) {
    const { b, tier, picks } = picking;
    const ps = paidSlots(b);
    const chosen = ps.map((s) => Object.keys(picks[s.id]).find((x) => picks[s.id][x] > 0));
    return tier.combos.filter((c) => c.p[i] === pid && comboAvail(b, c) && ps.every((_, j) => j === i || !chosen[j] || chosen[j] === c.p[j]));
  }
  // paid options still possible in this price group, given what's already picked in the other paid choices
  function paidOptions(i) {
    const { b, tier, picks } = picking;
    const ps = paidSlots(b);
    const chosen = ps.map((s) => Object.keys(picks[s.id]).find((pid) => picks[s.id][pid] > 0));
    const ok = new Set();
    for (const c of tier.combos) {
      if (!comboAvail(b, c)) continue;
      if (ps.every((_, j) => j === i || !chosen[j] || chosen[j] === c.p[j])) ok.add(c.p[i]);
    }
    return ok;
  }
  function allPaidOptions(i) { return [...new Set(picking.tier.combos.map((c) => c.p[i]))]; }
  // preselect any choice that has only one possibility
  function autoPick() {
    const { b, picks } = picking;
    paidSlots(b).forEach((s, i) => {
      if (Object.keys(picks[s.id]).length) return;
      const ok = [...paidOptions(i)];
      if (ok.length === 1) picks[s.id] = { [ok[0]]: s.qty };
    });
    for (const s of giftSlots(b)) {
      if (Object.keys(picks[s.id]).length) continue;
      const opts = optsOf(s);
      if (opts.length === 1) picks[s.id] = { [opts[0].id]: s.qty };
    }
  }
  function slotCount(sid) { return Object.values(picking.picks[sid]).reduce((a, c) => a + c, 0); }
  function renderPicker() {
    if (picking.step === "set") return renderSetStep();
    const { b, members } = picking;
    const P = byId();
    let pi = -1;
    $("#set-title").textContent = name(b);
    $("#set-add").hidden = false;
    const chooser = members.length < 2 ? "" : `<button type="button" class="backbar" data-back>← 换套餐 <span class="muted">Change set</span></button>`;
    $("#set-slots").innerHTML = chooser + b.slots.map((s) => {
      const isPaid = !s.is_gift; if (isPaid) pi++;
      const opts = isPaid ? allPaidOptions(pi).map((id) => P[id]).filter(Boolean) : optsOf(s);
      const possible = isPaid ? paidOptions(pi) : null;
      const have = slotCount(s.id);
      const single = isPaid || s.qty === 1;
      if (fixedGift(s)) return `<div class="slot"><div class="slot-head"><b>${s.qty > 1 ? s.qty + " × " : ""}${esc(s.label_cn)}</b> <span class="muted">${esc(s.label_en)}</span>
        <span class="gift">送 free</span><span class="count done">已包含 included</span></div></div>`;
      const head = `<div class="slot-head"><b>${esc(s.label_cn)}</b> <span class="muted">${esc(s.label_en)}</span>
        ${s.is_gift ? '<span class="gift">送 free</span>' : ""}<span class="count ${have === s.qty ? "done" : ""}">${have}/${s.qty}</span></div>`;
      if (!opts.length) return `<div class="slot">${head}<div class="hint">暂时没有 · Nothing available right now</div></div>`;
      if (!isPaid && opts.length === 1) {
        const p = opts[0];
        return `<div class="slot">${head}<div class="opts"><div class="opt on fixed">
          <img src="${esc(p.image_url)}" alt="">
          <span class="t"><span class="n-cn">${s.qty > 1 ? s.qty + " × " : ""}${esc(p.name_cn)}</span><span class="sub">${esc(p.meta || p.name_en)}</span><span class="save">送 free · 已包含 included</span></span>
          <span class="tickmark" aria-hidden="true">✓</span></div></div></div>`;
      }
      return `<div class="slot">${head}<div class="opts">${opts.map((p) => {
        const n = picking.picks[s.id][p.id] || 0;
        const free = isPaid ? freeStock(p.id) - otherSlotUse(s.id, p.id) : Infinity; // gifts are never sold out
        const out = !n && isPaid && !possible.has(p.id);
        const why = !out ? esc(p.meta || p.name_en) : (free <= 0 ? "售罄 sold out" : "不能和已选的搭配 · not with your other pick");
        const preOpt = isPaid && !out && free <= 0; // not in stock, but can be preordered
        // what taking this option saves (exact once the other choices are made, otherwise a range)
        let sv = "";
        if (isPaid && !out) {
          const cs = combosWith(pi, p.id);
          if (cs.length) {
            const r = saveRange(cs), prices = [...new Set(cs.map((c) => Number(c.price).toFixed(2)))];
            sv = fmtSave(r) + (prices.length === 1 && cs.length === 1 ? ` · 套餐 ${money(prices[0])}` : "");
          }
        }
        const ctrl = single
          ? `<span class="radio ${n ? "on" : ""}" aria-hidden="true"></span>`
          : `<span class="stepper"><button type="button" data-dec="${s.id}|${esc(p.id)}" ${n ? "" : "disabled"} aria-label="One less">−</button><span>${n}</span><button type="button" data-inc="${s.id}|${esc(p.id)}" ${have >= s.qty || free <= 0 ? "disabled" : ""} aria-label="One more">+</button></span>`;
        return `<${single ? "button type=\"button\"" : "div"} class="opt ${n ? "on" : ""} ${out ? "out" : ""}" ${single && !out ? `data-pick="${s.id}|${esc(p.id)}|${s.qty}"` : ""} ${single && out ? "disabled" : ""}>
          <img src="${esc(p.image_url)}" alt="">
          <span class="t"><span class="n-cn">${esc(p.name_cn)}</span><span class="sub">${why}</span>${preOpt ? `<span class="pre-chip">今天没货 · 可预订 preorder</span>` : ""}${sv ? `<span class="save">${sv}</span>` : ""}</span>
          ${ctrl}
        </${single ? "button" : "div"}>`;
      }).join("")}</div></div>`;
    }).join("");
    const combo = b.slots.every((s) => slotCount(s.id) === need(s)) && comboFor(b, picking.picks);
    const btn = $("#set-add");
    const pre = !!combo && !comboInStock(b, combo);
    picking.pre = pre;
    btn.disabled = !combo;
    btn.classList.toggle("primary", !pre); btn.classList.toggle("prebtn", pre);
    btn.textContent = !combo ? "请选择 Choose everything above"
      : `${pre ? "预订 Preorder" : "加入购物车 Add to cart"} · ${money(combo.price)}${saving(combo) > 0.005 ? ` (省 ${money(saving(combo))})` : ""}`;
    $("#set-err").hidden = true;
  }
  // same product picked in another choice of this set
  function otherSlotUse(sid, pid) {
    let n = 0; for (const [s, picks] of Object.entries(picking.picks)) if (s !== String(sid)) n += picks[pid] || 0; return n;
  }
  $("#set-slots").addEventListener("click", (e) => {
    if (e.target.closest("[data-back]")) { picking.step = "set"; renderPicker(); $("#set-sheet .sheet").scrollTop = 0; return; }
    const mem = e.target.closest("[data-member]");
    if (mem) { const i = Number(mem.dataset.member); if (i !== picking.mi) setMember(i); return; }
    const pick = e.target.closest("[data-pick]"), inc = e.target.closest("[data-inc]"), dec = e.target.closest("[data-dec]");
    const el = pick || inc || dec; if (!el) return;
    const [sid, pid, q] = (el.dataset.pick || el.dataset.inc || el.dataset.dec).split("|");
    const slot = picking.picks[sid];
    if (pick) picking.picks[sid] = slot[pid] ? {} : { [pid]: Number(q) || 1 };
    else if (inc) slot[pid] = (slot[pid] || 0) + 1;
    else if (dec) { slot[pid] = Math.max(0, (slot[pid] || 0) - 1); if (!slot[pid]) delete slot[pid]; }
    autoPick();
    renderPicker();
  });
  $("#set-add").onclick = () => {
    const { b, picks } = picking;
    const clean = {};
    for (const s of b.slots) clean[s.id] = Object.fromEntries(Object.entries(picks[s.id]).filter(([, c]) => c > 0));
    const pre = !!picking.pre;
    const k = setKey(b.id, clean, pre);
    const line = cart[k] || { bundle: b.id, qty: 0, picks: clean, preorder: pre };
    if (lineMaxSet(line, k) < line.qty + 1) { const err = $("#set-err"); err.textContent = pre ? `每样最多 ${shop.settings.max_qty} · Max ${shop.settings.max_qty} of each.` : "库存不够 · Not enough stock for this combination."; err.hidden = false; return; }
    line.qty += 1; cart[k] = line;
    saveCart(); closeSheets(); renderAll();
    toast(pre ? "已加入预订 Added as preorder" : "已加入 Added to cart");
  };

  // ---------- single items ----------
  function stepper(key, qty, max) {
    return `<div class="stepper" role="group" aria-label="Quantity">
      <button type="button" data-bump="${esc(key)}" data-d="-1" aria-label="One less">−</button>
      <span>${qty}</span>
      <button type="button" data-bump="${esc(key)}" data-d="1" aria-label="One more" ${qty >= max ? "disabled" : ""}>+</button>
    </div>`;
  }
  function renderSections() {
    const all = shelfProducts(), n = {};
    for (const p of all) n[secOf(p)] = (n[secOf(p)] || 0) + 1;
    if (section !== "all" && !n[section]) section = "all"; // tab emptied meanwhile
    const tabs = SECTIONS.filter(([k]) => k === "all" || n[k]);
    $("#sections").hidden = tabs.length < 3; // not worth tabs with one kind of product
    const house = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 3.2 2.6 11a1 1 0 0 0 1.3 1.5L5 11.6V20a1 1 0 0 0 1 1h4.5v-5.5h3V21H18a1 1 0 0 0 1-1v-8.4l1.1.9a1 1 0 1 0 1.3-1.5z"/></svg>`;
    $("#sections").innerHTML = tabs.map(([k, cn, en]) => k === "all"
      ? `<button type="button" role="tab" class="home" data-sec="all" aria-selected="${section === "all"}" aria-label="全部 All" title="全部 All">${house}</button>`
      : `<button type="button" role="tab" data-sec="${k}" aria-selected="${k === section}"><span class="cn">${cn}</span> ${en} <span class="n">${n[k]}</span></button>`).join("");
  }
  function renderShelf() {
    const el = $("#shelf"), list = shelfProducts().filter((p) => section === "all" || secOf(p) === section);
    const cur = SECTIONS.find(([k]) => k === section);
    $("#shelf-title").innerHTML = section === "all" ? '<span class="cn">单品</span> Single items' : `<span class="cn">${cur[1]}</span> ${cur[2]}`;
    $("#shelf-title").hidden = !list.length && shop.bundles.length > 0;
    if (!list.length) { el.innerHTML = shop.bundles.length ? "" : `<div class="empty">Nothing on the shelf right now. Check back soon.</div>`; return; }
    el.innerHTML = list.map((p) => {
      const out = p.stock <= 0;
      const pre = out && p.preorder_ok;
      const k = singleKey(p.id, pre);
      const inCart = cart[k]?.qty || 0;
      const cal = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path fill="currentColor" d="M4 0h1.5v2h5V0H12v2h2a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h2zM2.5 6v8.5h11V6z"/></svg>`;
      const badge = pre ? `<span class="stock prebadge">${cal} 可预订 Preorder</span>`
        : out ? `<span class="stock out">售罄 Sold out</span>`
        : `<span class="stock ${p.stock <= 3 ? "low" : ""}">${p.stock <= 3 ? `仅剩 ${p.stock} left` : `${p.stock} in stock`}</span>`;
      let action;
      if (out && !p.preorder_ok) action = `<button class="btn small" disabled>售罄 Sold out</button>`;
      else if (inCart) action = stepper(k, inCart, lineMaxSingle(p, pre, k));
      else action = `<button class="btn small ${pre ? "prebtn" : "primary"}" type="button" data-add="${esc(p.id)}" data-pre="${pre ? 1 : 0}">${pre ? "预订 Preorder" : "加入 Add"}</button>`;
      return `<article class="prod ${pre ? "pre" : out ? "soldout" : ""}">
        <div class="ph"><img src="${esc(p.image_url)}" alt="${esc(p.name_en)}" loading="lazy">${badge}</div>
        <div class="info">
          <div class="n-cn">${esc(p.name_cn)}</div>
          <div class="n-en">${esc(p.name_en)}</div>
          ${p.meta ? `<div class="meta">${esc(p.meta)}</div>` : ""}
          ${pre ? `<div class="prenote">${cal}<span>今天没货，可以预订<br>Out right now · preorder, I'll tell you on WeChat when it's in</span></div>` : ""}
          <div class="row"><span class="tag">${money(p.price)}</span>${action}</div>
        </div>
      </article>`;
    }).join("");
  }
  function renderAll() { if (!session) return; renderSections(); renderSets(); renderShelf(); renderCartBar(); }
  $("#sections").addEventListener("click", (e) => {
    const b = e.target.closest("[data-sec]"); if (!b || b.dataset.sec === section) return;
    section = b.dataset.sec;
    renderAll();
    const nav = $("#sections"); if (nav.getBoundingClientRect().top < 0) nav.scrollIntoView({ block: "start" });
  });

  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-add]");
    if (a) { const p = byId()[a.dataset.add]; if (p) addSingle(p, a.dataset.pre === "1"); return; }
    const b = e.target.closest("[data-bump]");
    if (b) { bump(b.dataset.bump, Number(b.dataset.d)); return; }
    if (e.target.closest("[data-setall]")) openSet();
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
        const parts = b.slots.flatMap((s) => fixedGift(s) ? [`<li>${s.qty > 1 ? s.qty + " × " : ""}${esc(s.label_cn || s.label_en)} <span class="gift">送</span></li>`] : Object.entries(l.picks[s.id] || {}).map(([pid, c]) =>
          `<li>${c > 1 ? c + " × " : ""}${esc(P[pid] ? name(P[pid]) : pid)}${s.is_gift ? ' <span class="gift">送</span>' : ""}</li>`));
        const firstImg = P[Object.keys(l.picks[b.slots[0].id] || {})[0]];
        return `<div class="line">
          <img src="${esc(firstImg?.image_url || "")}" alt="">
          <div class="t"><div class="n-cn">${esc(name(b))}</div>${l.preorder ? '<div class="sub"><span class="pre-chip">预订 Preorder</span></div>' : ""}<ul class="sub parts">${parts.join("")}</ul></div>
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
    $("#co-pre-hint").hidden = !hasPre;
    $("#co-err").hidden = true;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    return new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  }

  const ERR = {
    bad_preorder_date: () => "预订日期不对 · That preorder date doesn't work.",
    bad_location: () => "请选择地点 · Choose a pickup spot.",
    too_many_open_orders: () => "你还有未完成的订单 · You already have several open orders. Message me on WeChat or wait until they're delivered.",
    bad_qty: () => `每样最多 ${shop.settings.max_qty} 件 · Max ${shop.settings.max_qty} of each.`,
    empty_cart: () => "购物车是空的 · Your cart is empty.",
    shop_closed: () => "现在不接单 · I'm not taking orders right now. Only preorders can be placed.",
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
    const showErr = (m) => { err.textContent = m; err.hidden = false; err.scrollIntoView({ block: "nearest" }); };
    if (!location) return showErr(ERR.bad_location());
    err.hidden = true; btn.disabled = true; btn.textContent = "提交中… Placing order…";
    try {
      const res = await API.placeOrder({
        session: session.token, location, note: $("#co-note").value.trim(), wanted_date: null,
        items: lines.map((l) => l.bundle ? { bundle: l.bundle, qty: l.qty, picks: l.picks, preorder: !!l.preorder } : { id: l.id, qty: l.qty, preorder: !!l.preorder })
      });
      if (locs.length > 1) store.set("shop.location", location);
      cart = {}; saveCart(); $("#co-note").value = "";
      showDone({ ...res, preorder: hasPre });
      loadShop();
    } catch (ex) {
      const c = ex.code || "";
      if (c === "login_required") return endSession("请重新登录 · Please log in again.");
      if (/^(out_of_stock|unavailable|no_preorder|bad_picks):/.test(c)) {
        await loadShop(); reconcileCart(false); renderCart();
        showErr("有商品刚刚卖完或有变动 · Something in your cart just sold out or changed. Your cart was updated; check it and try again.");
      } else if (c === "shop_closed") {
        await loadShop(); reconcileCart(false); renderCart(); showErr(ERR.shop_closed());
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
      <p>Total <b class="num">${money(res.total)}</b> · ${esc(res.location)}${res.preorder ? "<br>预订：到货后我会微信通知你 · Preorder: I'll tell you on WeChat when it's in." : ""}</p>
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
  $("#open-orders").onclick = () => { closeDrops(); openOrders(); };
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
      const sets = (o.bundles || []).map((b) => `<li><b>${b.qty > 1 ? b.qty + " × " : ""}${esc(b.name_cn || b.name_en)}</b>${items.some((i) => i.order_bundle_id === b.id && i.preorder) ? ' <span class="pre-chip">预订</span>' : ""}<ul>${items.filter((i) => i.order_bundle_id === b.id)
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
  // ---------- header drop-downs (info, account menu) ----------
  function closeDrops() {
    for (const [b, p] of [["#info-btn", "#info-panel"], ["#menu-btn", "#menu-panel"]]) { $(p).hidden = true; $(b).setAttribute("aria-expanded", "false"); }
  }
  function toggleDrop(btn, panel) {
    const open = $(panel).hidden;
    closeDrops();
    if (open) { $(panel).hidden = false; $(btn).setAttribute("aria-expanded", "true"); }
  }
  $("#info-btn").onclick = (e) => { e.stopPropagation(); toggleDrop("#info-btn", "#info-panel"); };
  $("#menu-btn").onclick = (e) => { e.stopPropagation(); toggleDrop("#menu-btn", "#menu-panel"); };
  document.addEventListener("click", (e) => { if (!e.target.closest(".dropdown")) closeDrops(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrops(); });

  // the status bar sits right under the header when the header is pinned (wide screens), else at the very top
  function setHeaderOffset() {
    const h = $("header.sign");
    document.documentElement.style.setProperty("--hdr", getComputedStyle(h).position === "sticky" ? h.offsetHeight + "px" : "0px");
  }
  window.addEventListener("resize", setHeaderOffset);

  // ---------- paused / closed: banner + pop-up with the owner's message ----------
  function renderStatus(s) {
    const mode = s.shop_open !== false ? "open" : s.shop_paused ? "paused" : "closed";
    const msg = String(s.status_message || "").trim();
    const bar = $("#statusbar");
    bar.hidden = mode === "open" && !msg;
    if (bar.hidden) return;
    setHeaderOffset();
    const T = {
      open: { ico: "📢", title: "店主通知 · Note from the shop", sub: "" },
      paused: { ico: "⏸", title: "暂停接单 · Paused for now", sub: "稍后恢复，可以先预订 · Back soon. You can still preorder." },
      closed: { ico: "🌙", title: "已打烊 · Closed right now", sub: "今天不能直接下单，可以预订 · You can't order for today, but you can preorder." }
    }[mode];
    bar.className = "statusbar " + mode;
    $("#sb-ico").textContent = T.ico; $("#sb-title").textContent = T.title; $("#sb-sub").textContent = T.sub; $("#sb-sub").hidden = !T.sub;
    $("#sb-msg").hidden = !msg; $("#sb-msg").textContent = msg;
    // pop-up once per state + message in this browser tab
    const key = mode + "|" + msg;
    let seen = ""; try { seen = sessionStorage.getItem("shop.popSeen") || ""; } catch (e) {}
    if (seen === key) return;
    try { sessionStorage.setItem("shop.popSeen", key); } catch (e) {}
    $("#pop-ico").textContent = T.ico; $("#pop-title").textContent = T.title; $("#pop-sub").textContent = T.sub; $("#pop-sub").hidden = !T.sub;
    $("#pop-msg").hidden = !msg; $("#pop-msg").textContent = msg;
    $("#status-pop").className = "overlay popup " + mode;
    $("#status-pop").hidden = false;
  }

  // ---------- ads (Google AdSense) ----------
  // Nothing happens until a publisher ID and ad unit ID are set on the owner page (Settings).
  // Slots are only filled once they're on screen, so hidden views never request ads.
  let adCfg = null;
  function setupAds(s) {
    const client = String(s.ad_client || "").trim(), slot = String(s.ad_slot || "").trim();
    if (adCfg || !/^ca-pub-\d{10,20}$/.test(client) || !/^\d{6,20}$/.test(slot)) return;
    adCfg = { client, slot };
    if (!document.querySelector('script[src*="pagead2.googlesyndication.com"]')) {
      const sc = document.createElement("script");
      sc.async = true; sc.crossOrigin = "anonymous";
      sc.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(client);
      document.head.appendChild(sc);
    }
    fillAds();
  }
  function fillAds() {
    if (!adCfg) return;
    const wide = matchMedia("(min-width: 1460px)").matches;
    document.querySelectorAll("[data-ad]").forEach((box) => {
      if (box.dataset.filled) return;
      const rail = box.dataset.ad === "rail";
      if (rail && !wide) return;
      if (box.closest("main")?.hidden) return; // fill when its page is showing
      const room = box.parentElement.clientWidth; // banner size that fits the space it sits in
      const [w, h] = rail ? [160, 600] : room >= 760 ? [728, 90] : [320, 100];
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.cssText = `display:inline-block;width:${w}px;height:${h}px`;
      ins.dataset.adClient = adCfg.client; ins.dataset.adSlot = adCfg.slot;
      box.appendChild(ins); box.hidden = false; box.dataset.filled = "1";
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    });
  }

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
