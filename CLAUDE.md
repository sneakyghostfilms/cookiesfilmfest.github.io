# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is the Cookies and Comedy Film Festival website - a static site built with Astro and Tailwind CSS. The site showcases comedy film screenings, awards, and festival information for an annual Pittsburgh-based event.

## Key Commands

### Development
- `npm run dev` - Start local development server at http://localhost:4321
- `npm run build` - Build production site to `./dist/`
- `npm run preview` - Preview production build locally before deploying
- `npm run format` - Format all code with Prettier (includes .astro files and Tailwind classes)
- `npm run clean` - Remove node_modules, dist, and .astro directories

### Festival Data Management
- `npm run geocode` - Fetch coordinates for festivals missing location data (uses OpenStreetMap)
- `npm run export-map` - Generate CSV file for importing into Google My Maps

## Architecture

### Technology Stack
- **Framework**: Astro (v4.6.3) - Static site generator
- **Styling**: Tailwind CSS with fluid typography plugin
- **Icons**: Astro Icon with Iconify (mdi and fa-brands icon sets)
- **Fonts**: Google Fonts (Comic Neue, Fredoka) and Fontsource packages

### Project Structure
- `src/pages/` - Page routes (index.astro is the main landing page)
- `src/components/` - Reusable Astro components (splash, mission, event, awards, etc.)
- `src/layouts/` - Layout templates (section-layout, content-section)
- `src/data/` - Festival data (festival2025.js contains all film/schedule data)
- `src/assets/` - Images and other assets
- `src/styles/` - Global styles and theme configuration

### Key Components Architecture
- **Main Page Flow** (index.astro): Header → Splash → Mission → Event → Awards → Submission → Contact
- **Festival Data**: All 2025 festival data (films, schedules, awards) is centralized in `src/data/festival2025.js`
- **Theming**: CSS variables defined in `src/styles/theme.css` mapped to Tailwind utilities

### Deployment
- **GitHub Pages**: Automated deployment via `.github/workflows/deploy.yml`
- **Build Process**: Pushes to main branch trigger build and deploy to cookiesfilmfest.com
- **Node Version**: 22
- **Static Assets**: Built to `dist/` directory with .nojekyll file for GitHub Pages

## Development Notes

### When Working with Festival Data
The festival schedule, films, and awards are all managed through `src/data/festival2025.js`. This includes:
- Film blocks with host information and images
- Individual film details (title, director, runtime, synopsis, country, awards)
- Award categories and winners
- Venue information

**Note:** `src/data/films.json` is kept as a placeholder for the 2026 festival data. It uses a different structure (with "Project Title", "Directors", etc.) that comes from film submissions and will be transformed into the festival format when the 2026 lineup is finalized.

### Pennsylvania Festivals List
The PA festivals list is managed through `src/data/festivals.js` and displayed on the `/pa-festivals` page:
- **Structure**: Simple array of festival objects, maintained in alphabetical order by festival name
- **Fields**: `name` (string), `city` (string), `month` (string), `website` (string), `genre` (string or null), `isOurFestival` (optional boolean)
- **Adding festivals**: Insert new entries in alphabetical position in the array
- **Display**: The `src/pages/pa-festivals.astro` page automatically renders all festivals with client-side sorting by name or month

#### Geocoding Festival Locations
Festival coordinates are stored separately in `src/data/festival-locations.json` and are used to generate maps for visualization:

- **After adding new festivals**, run `npm run geocode` to fetch coordinates from OpenStreetMap (Nominatim)
  - The script only geocodes festivals missing coordinates (incremental updates)
  - Uses city-level coordinates (not specific venues) since festivals may change locations
  - Respects Nominatim rate limits (1 request/second)

- **To generate a map for Google My Maps**, run `npm run export-map`
  - Creates `pa-festival-map.csv` with all festivals that have coordinates
  - Import this CSV into Google My Maps to create an interactive map
  - Festival name is the key that ties festivals.js to festival-locations.json

- **Location data format**: JSON object keyed by festival name:
  ```json
  {
    "Festival Name": {
      "lat": 40.4406,
      "lng": -79.9959,
      "city": "Pittsburgh"
    }
  }
  ```

- **Note**: Coordinates are city-level approximations. Maps should include a disclaimer that locations are not venue-specific.

### Pittsburgh Prop Search (/props)
`/props` searches the text of local prop rental catalogs and vendor websites. Keyword search runs entirely in the browser. The optional "Paste a scene" box calls a small Cloudflare Worker in `worker/`. The Worker sends the AI only the 100 items whose words best match the scene, ranked by the page's own keyword search. See `worker/README.md` for its API, cost guard, tests and deployment.

- **Data** (`src/data/props/`):
  - `vendors.json`: hand-edited. It lists each vendor and its catalogs (see Vendor records below), with each catalog's `type` (`pdf`, `wordpress-pages` or `shopify-export`) and the `expected` counts that `npm test` enforces.
  - `inventory.json`: generated by `npm run props:import` (PDF catalogs) and `npm run props:import-site` (vendor websites). Vendor facts exactly as printed or published; never edit it by hand. Website items have a `url` instead of item numbers and pages, and no description.
  - `tags.json`: AI-suggested search terms, generated by `npm run props:tags` and kept apart from vendor facts. Each item's entry carries a fingerprint of the name, section and era it was made from; `props:tags` regenerates entries whose fingerprint no longer matches, and `npm test` fails until it does.
  - `config.json`: `apiUrl` is the scene-matching Worker's URL; `""` switches the scene box off.
- **Code**: `src/pages/props.astro` (page markup), `src/styles/props.css` (page styles; every selector stays under `.props-page`, so nothing leaks to other pages and `tests/styles-compatibility.test.mjs` keeps passing), `src/scripts/props-page.ts` (page script: keyword search and the scene box), `src/scripts/props-cards.js` (card and vendor-box text), `src/scripts/props-search.js` (keyword ranking, shared with the Worker), `src/scripts/props-scene.js` (Worker client), `scripts/props/` (imports, tagging and the local demo).
- **Prerequisites for updating a catalog**: `python3` with the `pdfplumber` package, and, for tags, a local Ollama with `qwen3.6:35b` (override with `PROPS_TAG_MODEL`).
- **Rules**:
  - The catalog PDF is a local input only. Never commit it or any vendor photo, and never download it from Drive or Linktree in a script.
  - Item numbers, names, eras and pages are shown exactly as the vendor printed or published them.
  - The page is text only: no photos and no copy of the catalog layout. Prices captured from a vendor are never shown.

#### Vendor records (`vendors.json`)
Each vendor records only what the vendor itself publishes, and every fact names its `source`: one or more URLs or short notes such as "catalog page 3", separated by "; ". A fact the vendor doesn't publish is `null`; nothing is filled in by inference. Use the vendor's visible text: a fact found only in hidden structured data (such as a JSON-LD street address) is not used. A fact read from a page our scripts don't fetch, such as a Facebook Page, says so in its source, for example "Route 30 Retro Facebook Page (About), as read on 2026-10-17; not fetched by our scripts". No person is named anywhere in the file: owners and staff stay out, and so do personal e-mail addresses (`npm test` checks for the names found on vendor pages so far). Fields:
- `id`, `name`, `keyPrefix` (needed only with catalogs), `siteUrl`, `lastVerified` (the date the facts were last checked)
- `sourceType`: `{ value, source }`, where value is one of `prop-house`, `vintage-rental`, `event-rental`, `antique-reuse`, `theater-stock` or `specialty`
- `address` and `mailingAddress`: `{ label, street, city, state, zip, source }` as published. A PO box goes in `mailingAddress`. Label an address that isn't where the stock is, for example "organization's address; costume storage location not stated". A vendor whose state isn't PA or Pennsylvania gets a "Regional" badge.
- `hours`: `{ text, source }`, as published, for example their appointment wording
- `modes`: `{ values, source }`, from `rent`, `sale` and `inquire`
- `terms`: `{ text, source }`: deposits, minimums, delivery, pickup or pricing, as published
- `contact`: `{ formUrl, email, phone, pageUrl, source }`
- `social`: `{ instagram, facebook, linktree, source }`
- `inquiryHint`: `{ text, source }`: what their form or page asks renters to cite
- `specialties`: `{ values, source }`: the vendor's own words for what it stocks, verbatim, such as its gallery or category names. The box quotes them as "In their words".
- `notice`: `{ text, source }`: a status notice the vendor publishes, such as a merger or a clearance sale, quoted on the box
- `catalogs`: may be empty for a supplier whose inventory isn't indexed. Its box then says "Inventory not indexed; contact the vendor."

The page lists every vendor under "Prop sources", vendors with searchable items first, with badges for the source type and modes. A keyword search also shows, above the items, the vendors without searchable items whose name or `specialties` match the query. The source-type label is our classification, not the vendor's words, so it is never matched.

Anything about our relationship with a vendor goes in the gitignored `.props-private/vendors.json`, keyed by vendor id: listing and photo permissions (`not-asked`, `asked`, `granted` or `declined`, with `asOf`), notes, and facts that came from Scott's conversations rather than the vendor's own pages. `npm test` fails if `vendors.json` holds `permissions` or `notes`, or if anything under `.props-private/` is tracked. The page shows the private file only in the local demo, and only with `PROPS_SHOW_PRIVATE=1` (see below).

#### Vendor websites
Each site has its own parser in `scripts/props/sites/`, behind one command: `npm run props:import-site -- --vendor <id>`. Fetching follows these rules (`scripts/props/site-fetch.mjs`):
- an honest User-Agent naming the project and a contact URL
- at least 2 s plus jitter between requests, one at a time, with a 60 s timeout
- no redirects followed, and no retries: a 429, 403, redirect, refused host or any other error stops the run
- each URL fetched once per snapshot into the gitignored `.props-cache/<vendor>/<catalog id>/`, so re-runs are offline and byte-identical
- only the hosts allowed for that run; `retroon8th.com` and any `*.myshopify.com` host are always refused

**Dezzign Central** (`wordpress-pages`): one WordPress REST request returns the seven prop pages. If the answer fills a whole page of results, the import stops, since there may be more. Each distinct photo title (alt text) on a page is one item, named as written less any " - era 1950" ending, with the page as its category and source link, and no description. A photo without a usable title becomes "<category> item N (no title given)". An era comes only from that " - era 1950" wording. The report flags untitled photos, titles that only repeat their category, and titles that may be another view of an item. To refresh, replace the catalog's id in `vendors.json` with a new dated one (for example `dz-2026-11-30`): a new id fetches the pages afresh, while the same id re-reads the cache. Then run the import, review the report, update `expected`, tag, test, commit, and redeploy the Worker.

**Retro on 8th** (`shopify-export`): their storefront is not crawled. Its agent policy asks automated clients for Web Bot Auth, and it rate-limits unidentified clients. Its items come only from a Shopify product export that the vendor shares (Admin → Products → Export → all products, plain CSV). Keep the file outside the repository, for example in `../props-sources/` beside the catalog PDF; an export inside the repository is refused unless git ignores it. Then:
1. Add the vendor entry and a catalog with `type: "shopify-export"`, the file's `sha256`, `capturedAt` (the export date), `siteUrl: "https://retroon8th.com/products/"` and `itemLinkLabel: "Open product page"`.
2. `npm run props:import-site -- --vendor retro-on-8th --export "/path/to/products_export.csv"`. Either Shopify header set works, current or legacy.
3. Review the report. It shows exclusions per reason (not active, not published, marked sold, sold out, gift card), each item's era and categories (from Type and Tags), and how many first images are not on `cdn.shopify.com`.
4. Copy the counts into `expected`, then tag, test and commit, and redeploy the Worker.

The import reads only the columns it needs: handle, title, type, tags, status, published, price, image URL and position, gift card and the stock columns. Descriptions, costs, barcodes, SKUs and SEO fields are never read. Status, published and stock values only decide which products are left out, and are never stored. Each item keeps the first variant's price as `listedPrice`, which the page never shows.

#### Updating a PDF catalog
1. Edit `vendors.json` (catalog id, the PDF's `sha256`, `pageCount`, `sourceUrl`). Replace the old catalog's entry rather than adding one: the import drops items of any catalog that is no longer listed.
2. `npm run props:import -- --pdf "/path/to/catalog.pdf" --sheets-dir /tmp/props-sheets`
3. Review the overlay sheets and the report: item numbers, captions, photos, reused or malformed numbers. The import refuses to write when its structural checks fail.
4. Copy the reported counts into the catalog's `expected` in `vendors.json`.
5. `npm run props:tags`, then review the new tags, against the photos where you have them. Record any removal in `scripts/props/tag-exclusions.json`.
6. `npm test`, then commit.
7. Redeploy the Worker (`cd worker && npx wrangler deploy`), because it bundles the inventory and the tags. Redeploy it after any change to `tags.json` too, since its shortlist ranks with the tags.
8. Push.

#### Local demo mode (private, never published)
A local-only version of `/props` for screenshare pitches. It adds photo thumbnails cropped from the vendor's PDF and "Open catalog (local PDF)" links that open a local copy at the item's page, zoomed to its photo. Scene matching goes through the Worker.
- **First run:** `npm run props:demo -- --pdf "/path/to/catalog.pdf"`. This checks the PDF's sha256 against `vendors.json` and builds `.props-demo/` (about 350 WebP thumbnails, a copy of the PDF, and `manifest.json` with each item's page and photo position). It then starts the dev server at http://localhost:4321/props with `PROPS_DEMO=1` and the Worker URL set for that process only.
- **Later runs:** `npm run props:demo`. To rebuild the assets, run `npm run props:demo-assets -- --pdf "…"`.
- **Website vendors' photos:** `npm run props:demo-assets -- --vendor dezzign-central` reads the vendor's pages from the import's cache (run `props:import-site` first), downloads each item's first photo once into `.props-demo/originals/`, following the same fetching rules, and writes 320 px WebP thumbnails. For Retro on 8th, add `--export "…"`: its photos come only from the export's image URLs on `cdn.shopify.com`. A photo on any other host is refused and stops the run, like any refused request; the import report counts such photos beforehand. Without photos, `npm run props:demo` warns and the cards show without them.
- **Private vendor notes:** they appear only if you start the demo with `PROPS_SHOW_PRIVATE=1`. `npm run props:demo` never sets it, warns when it is set, and the page then shows "Private vendor notes visible: do not screenshare". Never screenshare with it on.
- **Port 4321 must be free.** The Worker only answers that origin, so the command stops instead of moving to another port.
- **Stopping:** press Ctrl-C. When Astro runs detached, for example when started from a script or an agent instead of a terminal, run `npx astro dev stop`.
- **Never commit or publish these files.**
  - `.props-demo/`, `.props-cache/` and `.props-private/` are gitignored and sit outside `public/` and `src/`, so no build copies them.
  - The scripts refuse to write anywhere git doesn't ignore, or under `public/` or `src/`.
  - `astro build` refuses to run with `PROPS_DEMO=1`.
  - `npm test` fails if a `.pdf`, any `.webp` other than the site's own two, any `.html`, or any `.csv` other than the known four, is tracked.
  - `git add -f` bypasses all of this, and the repository is public, so never force-add anything from `.props-demo/`, `.props-cache/` or `.props-private/`.
- **Without `PROPS_DEMO=1`, `/props` is byte-for-byte unchanged.** The assets are served only by the dev server, under `/props-demo/`. The Vite dev server also serves project files, but only on localhost.
- **Browser support for the PDF links:** Chrome's built-in viewer opens the item's page and photo with `#page=N&zoom=150,left,top`. Firefox and Safari are untested.

### Styling Approach
- Uses Tailwind CSS utility classes throughout
- Theme colors are CSS variables (--color-primary, --color-secondary, etc.)
- Responsive design with mobile-first approach
- Dark mode support built-in

### Image Handling
- Comedian/host images imported directly in festival2025.js
- Public assets served from `/public` directory
- Open Graph image for social sharing configured in index.astro

### Code Style Guidelines
- NEVER add short-lived explanatory comments in code (like "Adjusted for better positioning" or "Fixed to show face better")
- Use chat responses to explain changes instead of code comments
- Keep code comments minimal and only for long-term documentation needs