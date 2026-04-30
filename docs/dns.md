# DNS Configuration Guide
## Namecheap → Cloudflare → ahphyay.com

---

## Step 1 — Buy the domain on Namecheap

Recommended domain options (check availability):

| Domain | Approx. cost/yr | Notes |
|---|---|---|
| ahphyay.com | ~USD 10–12 | Best, clean |
| ahphyay.org | ~USD 10 | Good for non-profits |
| ahphyay.net | ~USD 12 | Fallback |
| ahphyay.co | ~USD 25 | More expensive |

> Buy at **namecheap.com** — search, add to cart, checkout.
> Use **WhoisGuard** (free on Namecheap) to protect registrant privacy.

---

## Step 2 — Add site to Cloudflare (free plan)

1. Go to **dash.cloudflare.com** → Add a site
2. Enter `ahphyay.com` → Select **Free plan**
3. Cloudflare will scan existing DNS records
4. Continue — Cloudflare gives you **2 nameservers**, e.g.:
   - `nina.ns.cloudflare.com`
   - `rod.ns.cloudflare.com`

---

## Step 3 — Point Namecheap to Cloudflare nameservers

1. Log into Namecheap → **Domain List** → Manage `ahphyay.com`
2. Go to **Nameservers** → Select **Custom DNS**
3. Enter Cloudflare's nameservers (from Step 2)
4. Save — propagation takes **5 minutes to 24 hours**

---

## Step 4 — Add DNS records in Cloudflare

Go to **Cloudflare Dashboard → ahphyay.com → DNS → Records**

Add these records:

### Frontend (Cloudflare Pages)

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| CNAME | `@` (root) | `ahphyay-system.pages.dev` | ✅ Proxied | Auto |
| CNAME | `www` | `ahphyay-system.pages.dev` | ✅ Proxied | Auto |

> After deploying to Cloudflare Pages, add `ahphyay.com` and `www.ahphyay.com` as custom domains in Pages settings.

### Worker API (Cloudflare Workers)

| Type | Name | Content | Proxy | TTL |
|---|---|---|---|---|
| CNAME | `api` | `ahphyay-worker.YOUR_SUBDOMAIN.workers.dev` | ✅ Proxied | Auto |

> Replace `YOUR_SUBDOMAIN` with your Cloudflare workers subdomain (found in Workers dashboard).

### Email (optional — if Ma Bome wants @ahphyay.com email)

| Type | Name | Content | Priority | TTL |
|---|---|---|---|---|
| MX | `@` | `route1.mx.cloudflare.net` | 20 | Auto |
| MX | `@` | `route2.mx.cloudflare.net` | 31 | Auto |
| MX | `@` | `route3.mx.cloudflare.net` | 50 | Auto |

> Enable **Cloudflare Email Routing** (free) to forward `hello@ahphyay.com` to Ma Bome's Gmail.

---

## Step 5 — SSL / HTTPS (automatic)

Cloudflare handles SSL automatically on the free plan.

In Cloudflare → **SSL/TLS** → Set to **Full (strict)**

---

## Step 6 — Deploy frontend to Cloudflare Pages

```bash
# In your GitHub repo settings:
# 1. Go to Cloudflare Pages → Create project
# 2. Connect GitHub → select ahphyay-system repo
# 3. Build settings:
#    Build command: (leave empty — static HTML)
#    Build output directory: frontend
# 4. Deploy → Cloudflare gives you ahphyay-system.pages.dev
# 5. Add custom domain: ahphyay.com
```

---

## Step 7 — Deploy Worker

```bash
cd worker
npx wrangler login
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put SPREADSHEET_ID
npx wrangler deploy
```

---

## Summary — what goes where

| URL | What it serves |
|---|---|
| `ahphyay.com` | Frontend dashboard (Cloudflare Pages) |
| `www.ahphyay.com` | Redirects to root |
| `api.ahphyay.com` | Cloudflare Worker API |
| `hello@ahphyay.com` | Email → forwarded to Ma Bome's Gmail |

---

## Total cost

| Item | Cost |
|---|---|
| Domain (Namecheap) | ~USD 10–12 / year |
| Cloudflare (free plan) | USD 0 |
| Cloudflare Pages | USD 0 |
| Cloudflare Workers | USD 0 (free tier: 100k req/day) |
| Google Sheets | USD 0 |
| **Total** | **~USD 10–12 / year** |
