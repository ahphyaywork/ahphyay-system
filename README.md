# AhPhyay Staff Performance System

A lightweight, bilingual (English + Burmese) staff performance monitoring system built for AhPhyay — a community initiative supporting women producers to connect with digital marketplaces.

## Stack

| Layer | Technology | Cost |
|---|---|---|
| Frontend | HTML + CSS + Vanilla JS | Free |
| Backend | Cloudflare Workers | Free tier |
| Database | Google Sheets API | Free |
| Hosting | Cloudflare Pages | Free |
| Domain | Namecheap → Cloudflare DNS | ~SGD 15/yr |

## Features

- **Work logging** — log work by project, task, and staff member
- **Time views** — yearly / monthly / weekly breakdowns
- **Task-based view** — track progress per task
- **Project-based view** — multi-project ready (SN@IL, VSDP, + future)
- **Management dashboard** — visual performance summary per staff
- **Bilingual** — English + Burmese labels throughout

## Repo Structure

```
ahphyay-system/
├── frontend/          # Web app (HTML/CSS/JS)
│   └── index.html
├── worker/            # Cloudflare Worker (API)
│   ├── src/
│   │   └── index.js
│   └── wrangler.toml
├── sheets/            # Google Sheets schema & seed data
│   └── schema.md
├── docs/              # Setup guides
│   ├── setup.md
│   ├── dns.md
│   └── sheets.md
├── .github/
│   └── workflows/
│       └── deploy.yml
├── .gitignore
└── README.md
```

## Quick Start

See [`docs/setup.md`](docs/setup.md) for full setup instructions.

## Developer

Built by Gamaliel Hla Tun — [gamalieltun.com](https://gamalieltun.com)
