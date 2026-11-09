This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Retrying blocked sites from your own machine (optional)

Amazon and some other stores block requests from Vercel's datacenter IPs. As a last resort the app can
fetch the page from **your own machine** instead (your home IP, your real browser): when the server
reports a block, the browser fetches the page locally and sends the HTML back to be parsed and saved.
Browsers can't fetch these sites directly (CORS), so one of these helpers is needed. Both are optional;
without either, a blocked scrape just shows the error.

### Option 1: browser extension (recommended, no server to run)

Click **Browser helper** in the app's header and follow the steps. In short:

1. Download the zip from the dialog (it's pre-configured for the site you're on, so don't edit it).
2. Unzip it somewhere permanent.
3. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the folder.
4. Return to the app. The dialog detects the extension and shows "Installed and working".

Works in Chrome, Edge, Brave and other Chromium browsers. It requests access to all sites (it can't know
which store you'll add next), but it only responds to the one site it was downloaded from, only when you
scrape or refresh, and it refuses local/private addresses. Its source is in [extension/](extension/).
Re-download it if the app moves to a new URL. For blocked sites it can load the page in a short-lived
background tab, so a tab may flash briefly.

### Option 2: local helper process

```bash
npm run local-fetcher                                              # local development
ALLOWED_ORIGINS=https://your-app.vercel.app npm run local-fetcher  # for the deployed app
```

Keep it running while you use the app (it's used only if the extension isn't installed).

- It listens on `127.0.0.1:4545` only, answers only the origins in `ALLOWED_ORIGINS`, and refuses
  private/internal addresses, so other websites can't use it to reach your network.
- Chrome may ask once to allow the site to "access devices on your local network". Allow it.
  Safari blocks HTTPS pages from calling `http://127.0.0.1`, so use Chrome, Edge or Firefox for this.
- Use `PORT=...` to change the port (and set `NEXT_PUBLIC_LOCAL_FETCHER_URL` to match).

The daily cron refresh runs on Vercel and can't use either helper; products it can't reach are refreshed
the next time you press "Refresh" in the app.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
