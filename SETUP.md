# Garching Snack Shop: setup guide

There are two pages:

- **Shop** (`tsrnoob.com`): customers log in with an account you created for them, pick single items or a meal set (套餐) with their own choices, and order for pickup in Garching Forschungszentrum. Stock goes down straight away, and when it reaches 0 nobody else can buy that item. Sold-out items can be **preordered**; you tell them on WeChat when it's in. They pay when you meet (cash, PayPal or WeChat Pay).
- **Owner page** (`yourdomain.com/owner.html`): only your account can open it. There you see orders with WeChat IDs, confirm, deliver or cancel them, change prices, restock, add products with photos, and see your inventory, profit and spending. The shop doesn't link to it. Bookmark it.

Everything is free: **Supabase** (database + your login), **Cloudflare Pages** (hosting), and your **Porkbun** domain (the only cost).

Plan for about 20 minutes. The database part is already set up.

---

## 1. Supabase: the database (already done, except your login ≈5 min)

Already done for you in your Supabase account:

- Project **garching-snack-shop** (Frankfurt, free plan)
- All tables, the order and stock logic, and the access rules, tested live
- Your 14 products with costs and stock (36 items), with prices left empty
- Storage for product photos you upload from the owner page
- `site/assets/config.js` already contains the project address and its public key

**What's left, which only you can do** (it's your password):

1. Open **supabase.com/dashboard** → project **garching-snack-shop**.
2. **Authentication → Users → Add user → Create new user**: your email plus a strong password. Tick **Auto Confirm User**.
3. Send Claude that email so it can mark it as the owner. Or do it yourself in **SQL Editor**:
   ```sql
   update settings set owner_email = 'your@email.com';
   ```
4. **Authentication → Sign In / Providers → Email**: turn **off** "Allow new users to sign up" → Save. Customers don't need accounts, and this stops strangers from creating any.

## 2. Cloudflare Pages: put the site online (≈5 min)

1. Sign up at **dash.cloudflare.com** (free).
2. **Workers & Pages → Create → Pages → Upload assets** (Direct Upload).
3. Project name: `garching-snacks` (anything). Drag the **`site` folder** (the one containing `index.html`) into the upload box → **Deploy**.
4. You get a test link like `garching-snacks.pages.dev`. Open it and check that the shop loads, then open `/owner.html` and sign in.

To update the site later (new code from Claude): open the project → **Create new deployment** → drag the `site` folder again.

## 3. Porkbun domain → your site (≈10 min, then wait for DNS)

The cleanest way is to let Cloudflare manage the domain's DNS:

1. In Cloudflare: **Add a domain** → type your domain → choose the **Free** plan. Cloudflare shows you **two nameservers** (like `ada.ns.cloudflare.com`).
2. In Porkbun: **Domain Management** → your domain → **Authoritative Nameservers** → **Edit**. Replace Porkbun's nameservers with the two from Cloudflare → Save.
3. Wait until Cloudflare emails you that the domain is active (usually minutes, at most a few hours).
4. Back in your Pages project: **Custom domains → Set up a custom domain** → enter `yourdomain.com` → Activate. Add `www.yourdomain.com` too if you like.

HTTPS is set up automatically.

## 4. Phone notifications for new orders (≈2 min)

1. Install **ntfy** (free, App Store / Play Store).
2. In the app, **Subscribe to topic** and make up a long, random name, e.g. `garching-snacks-k39x7q2m`. Anyone who knows the name could read the notifications, so don't use something guessable.
3. On your owner page → **Settings** → paste the same topic into "Phone notifications: ntfy topic" → **Save settings**.

From then on, every new order, preorder and customer cancellation sends a push to your phone with the WeChat ID, meeting spot, items and total.

## 5. Before you share the link

On the owner page:

- **Products**: set a price for each product (they're hidden until they have one), check stock. Each change saves by itself.
- **Settings**: check the meeting spots (one per line), your WeChat ID (`tsrnoob`) and the shop name.
- Place a test order yourself on the shop, check it shows up on the owner page and that the notification arrives, then **Cancel** it there. Cancelling puts the items back in stock.

Then send the link to people after they add you on WeChat.

---

## Daily use

| You want to… | Where |
|---|---|
| Give someone access | Customers → enter username + their WeChat ID → **Create account** → **Copy for WeChat** and send it to them |
| Someone forgot their username | Customers → **Copy login message** next to their name and send it again |
| Block someone | Customers → **Switch off** (logs them out everywhere; **Switch on** to undo) |
| See new orders | Orders (badge shows how many are new; refreshes every 20 s) |
| Confirm you've seen it | **Confirm**. After that the customer can no longer cancel it themselves |
| Handed it over and got paid | **Delivered & paid**. Counts toward Sold and Profit |
| Cancel | **Cancel** (tap twice). Items go back in stock automatically |
| Open preorders | Orders → **Preorders**, oldest first. Message the customer on WeChat once it's in |
| Choose what a menu offers | Menus → tick or untick products in each choice. Each tick saves straight away and the prices recalculate (see below) |
| Change the menu discount / target profit | Settings → **Menu discount target** (default €1.00) and **Menu target profit** (default €1.50) |
| New drink or water for the menus | Products → **+ Add product** (category **饮料 Drink** or **水 Water**), then tick it in the menu. Untick **Sell alone** if it should only come with menus |
| Track 魔芋爽 single packs (optional) | Products: add packs to **卫龙 魔芋爽 … (单包)** via **Restock**. Not needed for menus to sell: gifts never make a menu sold out |
| In a lecture / busy for a while | Top of the owner page → type a message (e.g. "上课中，14:00 回来 · In a lecture until 14:00") → **Pause selling**. Stock is kept; customers get a pop-up and a pinned banner with your message and can only preorder. **Resume selling** when you're back |
| Leaving campus for the day | Type a message (optional) → **Close for today** (tap twice). All stock goes to 0, customers see "已打烊 Closed" with your message, only preorders can be placed. Open orders stay as they are |
| Tell customers something any time (e.g. "14:00 补货 · Restocking at 14:00") | Type it in the bar at the top → **Show message** (or Enter). Customers get a pop-up and a blue banner while the shop stays open. **Remove** takes it down; **Update message** changes it. Resuming/opening after a pause clears it |
| Starting a new day | Set today's stock on **Products** (customers still see closed meanwhile), then **Open shop** at the top. The message disappears |
| Adjust stock by a few | Products → tap **+** / **−** next to **Stock**. It saves by itself a moment after your last tap |
| Bought more stock | Products → **Restock** → number → **Add** (this also counts it as bought, for the Inventory spending) |
| Change a price | Products → type the new **Price** and press Enter (or just tap elsewhere). It saves by itself, so you can go down the list one after another |
| Sold something in person | Inventory → **Record a sale made outside the site** |
| Profit, stock value, spending | Inventory (menus are listed as their own rows) |

## How the rules work

- **Stock** is reserved the moment someone orders. Two people can't buy the last item at the same time (tested with 8 simultaneous orders for 1 item: exactly 1 went through).
- **Preorders** are only offered when an item is sold out, for single items and for meal sets (a set whose chosen items aren't in stock becomes a preorder). There's no date or minimum number of days: you tell the customer on WeChat when it's in. They don't touch stock, and they still work while the shop is closed.
- **Limits**: max 10 of each product per order, and max 5 open orders per WeChat ID (both changeable in Settings). This stops one person from reserving the whole shelf.
- **Customers can cancel** their own order until you press Confirm.
- **Accounts**: only people you create on the Customers tab can log in, with just their username (no password). Anyone who knows a username can order as that person, so pick usernames that aren't easy to guess (e.g. `mei-4821`, not `mei`), and you still confirm each order on WeChat. If an account is misused, **Switch off** logs it out everywhere.
- **Menu prices**: for every combination of paid items, price = their single prices minus the discount target (€1.00), but not less than costs + target profit (€1.50), with free gifts counted at the most expensive ticked one. Then rounded **down** to the nearest 50 cents, so the real profit can be up to 49 cents below the target (at least €1.01 with the defaults).
- **Menu card**: the shop shows a single 套餐 card ("from €X, save up to €Y"). Tapping **Choose** first shows Menu A and Menu B as two big cards; picking one opens its item picker (with **← Change set** to go back). Every option shows what it saves, and the exact menu price once the other choices are made. A card is sold out only when its paid items (rice/hot pot, drink, guoba) are out of stock.
- **Free gifts** never block a menu. They're taken off stock while there is some (never below 0), otherwise you hand them out from your boxes; cancelling puts back only what was taken. A gift choice with nothing ticked (the water, until you add a water product) shows as "included" and its cost counts as €0.
- **Pickup**: with one area in Settings (Garching Forschungszentrum), customers only see it as a reminder; you agree the exact spot on WeChat.
- **"My orders"** comes from their account, so it works on any phone they log in on.

## Files

```
site/                 ← upload this folder to Cloudflare Pages
  index.html          shop
  owner.html          your owner page
  assets/config.js    your Supabase address + public key (filled in)
  assets/api.js       talks to Supabase
  assets/shop.js      shop logic
  assets/owner.js     owner page logic
  assets/style.css, owner.css
  img/                product photos
supabase/
  schema.sql          tables, rules, order logic (already applied)
  seed.sql            your 14 products (already loaded)
  test/               local tests (not needed for setup)
```

## Ads (optional)

The site has three small, labelled ad spots: under the login box, under the product list, and (only on very wide screens) one in each side margin. Never inside the cart or the meal-set picker. They stay invisible until you fill in both IDs.

1. Sign up at **adsense.google.com** with your Google account and add `tsrnoob.com` as a site.
2. Done: the AdSense code is in the shop page and `tsrnoob.com/ads.txt` is live (publisher `ca-pub-6413233215513891`).
3. In AdSense → **Privacy & messaging**, turn on the **European regulations (GDPR)** consent message. Google requires a consent message for visitors in the EU.
4. Wait for AdSense to approve the site. This can take days to weeks.
5. In AdSense → **Ads → By ad unit → Display ads**, create one unit (any name) and copy its number (`data-ad-slot`).
6. Owner page → **Settings** → the publisher ID is already filled in; add the **display ad unit ID** → Save. Leave **Auto ads** off in AdSense, or Google places ads anywhere on the page by itself. The ads appear on the next page load. Empty both fields to turn ads off again.

