# Garching Snack Shop: setup guide

There are two pages:

- **Shop** (`yourdomain.com`): customers enter their WeChat ID, add items to the cart, pick a meeting spot on the Garching campus and order. Stock goes down straight away, and when it reaches 0 nobody else can buy that item. Sold-out items can be **preordered** at least 5 days ahead. They pay when you meet (cash, PayPal or WeChat Pay).
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

- **Products**: set a price for each product (they're hidden until they have one), check stock, press **Save** on each row.
- **Settings**: check the meeting spots (one per line), your WeChat ID (`guest19191231`), the shop name, and the preorder days (5).
- Place a test order yourself on the shop, check it shows up on the owner page and that the notification arrives, then **Cancel** it there. Cancelling puts the items back in stock.

Then send the link to people after they add you on WeChat.

---

## Daily use

| You want to… | Where |
|---|---|
| See new orders | Owner → Orders (badge shows how many are new; the page refreshes every 20 s) |
| Confirm you've seen it | **Confirm**. After that the customer can no longer cancel it themselves |
| After handing it over and getting paid | **Delivered & paid**. It then counts toward Sold and Profit |
| Cancel | **Cancel** (tap twice). In-stock items go back on the shelf automatically |
| Upcoming preorders | Orders → **Preorders**, sorted by date. Red means due in 2 days or less |
| Bought more stock | Products → **Restock** box → number → **Add** (adds to stock and to "Spent") |
| Fix a wrong stock count | Products → change **Stock** → **Save** |
| Change a price | Products → **Price** → **Save** |
| New product | Products → **+ Add product** (take a photo with your phone) |
| Hide a product | Products → untick **In shop** → **Save** |
| Sold something in person | Inventory → **Record a sale made outside the site** |
| Profit, stock value, spending | Inventory (use **Hide numbers** when someone's looking) |
| Closed for a few days | Settings → banner message, e.g. "Back on Monday · 周一回来" |

## How the rules work

- **Stock** is reserved the moment someone orders. Two people can't buy the last item at the same time (tested with 8 simultaneous orders for 1 item: exactly 1 went through).
- **Preorders** are only offered when an item is sold out, and need a pickup date at least 5 days away (changeable in Settings). They don't touch stock.
- **Limits**: max 10 of each product per order, and max 5 open orders per WeChat ID (both changeable in Settings). This stops one person from reserving the whole shelf.
- **Customers can cancel** their own order until you press Confirm.
- **"My orders"** for customers is saved in their phone's browser. If they switch phones, they won't see older orders there (you still see everything).
- **WeChat IDs aren't verified.** Anyone could type someone else's ID. Since you message every buyer on WeChat before meeting, you'll notice fake orders; just cancel them.

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
