# AhPhyay System — Full Setup Guide

## Prerequisites
- GitHub account (your existing one)
- Cloudflare account (free)
- Google account (for Sheets + Service Account)
- Namecheap account

## Order of setup

1. **Google Sheets** — create the spreadsheet & service account → see `sheets/schema.md`
2. **GitHub** — push this repo → `github.com/YOUR_USERNAME/ahphyay-system`
3. **Cloudflare Workers** — deploy the API worker → see below
4. **Cloudflare Pages** — connect GitHub repo, deploy frontend
5. **DNS** — configure Namecheap + Cloudflare → see `docs/dns.md`

---

## Google Service Account setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project → `ahphyay-system`
3. Enable **Google Sheets API**
4. Create **Service Account** → download JSON key
5. From the JSON, copy:
   - `client_email` → this is your `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` → this is your `GOOGLE_PRIVATE_KEY`
6. Open your Google Spreadsheet → Share with the service account email (Editor access)
7. Copy the Spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`

---

## Worker secrets (run these one by one)

```bash
cd worker
npx wrangler secret put ADMIN_PASSWORD        # Ma Bome's login password
npx wrangler secret put JWT_SECRET            # Random long string
npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
npx wrangler secret put GOOGLE_PRIVATE_KEY
npx wrangler secret put SPREADSHEET_ID
```

---

## GitHub Actions auto-deploy (optional)

The `.github/workflows/deploy.yml` will auto-deploy the worker on every push to `main`.

Add these secrets in GitHub → Settings → Secrets:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
