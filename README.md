# HannahBuilds

My personal site — *"HannahBuilds, because that's the verb."* A marketer who learned to build, in one page.

**Live:** https://hannah435.github.io/hannahbuilds/

It's a single self-contained page with **three modes** — Marketer · Builder · Traveler — that re-theme the whole site as you switch.

---

## What's in it

### The site
- **Three modes** via a sliding toggle, each with its own accent (coral / blue / ocean-teal)
- **Hero** with a live build-log terminal and a Manila time-aware status
- Sections: **About · Journey · Work · Workflow · Content · Approach · Beyond · Work-with-me · Guestbook**
- **Work** — case studies with browser-framed screenshots (Spotlight, BitAngels, Tokenize Conference)
- **Workflow** — an interactive "if I were an n8n workflow" diagram
- **⌘K command palette** to jump anywhere
- Fully responsive, OG share image + favicons

### Travel blog
- Backed by **Airtable** — I post through a form, publish, and it bakes into the page
- Preview cards → full post pages with auto-scrolling photo galleries and Markdown
- An **interactive map** (dark land / teal sea) with blinking pins for everywhere I've been; city names on hover

### Ask Hannah (AI chat)
- A floating chat widget that answers in my voice
- **Supabase Edge Function → Claude** (the API key lives only as an encrypted Supabase secret — never in the page or repo)
- Casual, short, cost-effective, and every chat is logged so I can keep improving it

### Fun touches
- A rotating **Mandarin word-of-the-day**
- **Live clocks** for the cities I've visited
- A **time-of-day tint** that shifts with each visitor's local clock

---

## Tech

- Plain **HTML / CSS / JS**, one file, no build framework
- **Leaflet** for the map · **Supabase** (auth + Edge Functions) · **Airtable** (travel CMS) · **Claude** (chat)
- Hosted on **GitHub Pages**

## Publishing

The source of truth is `~/Downloads/hannahbuilds.html`. To publish:

```bash
~/hannahbuilds-site/deploy.sh
```

It copies the file in, bakes the published Airtable travel posts (downloading + optimizing photos), and pushes to GitHub Pages.

The Ask Hannah backend lives in `supabase/functions/ask-hannah/` and is deployed separately with the Supabase CLI.

## Secrets — kept out of the repo

- **Airtable** read token → only in `deploy.sh` (git-ignored); posts are injected at build time
- **Anthropic** API key → only a Supabase secret, set via the CLI
- Only the Supabase **publishable** key (safe for the browser) ever appears in the page

---

🤖 Built with [Claude Code](https://claude.com/claude-code)
