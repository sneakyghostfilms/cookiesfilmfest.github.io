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
`/props` searches the text of local prop rental catalogs. Keyword search runs entirely in the browser. The optional "Paste a scene" box calls a small Cloudflare Worker in `worker/`; see `worker/README.md` for its API, cost guard, tests and deployment.

- **Data** (`src/data/props/`):
  - `vendors.json`: each vendor's contact routes and catalogs, with the PDF's `sha256` and the `expected` counts that `npm test` enforces.
  - `inventory.json`: generated by `npm run props:import`. Vendor facts exactly as printed; never edit it by hand.
  - `tags.json`: AI-suggested search terms, generated by `npm run props:tags` and kept apart from vendor facts. Each item's entry carries a fingerprint of the name, section and era it was made from; `props:tags` regenerates entries whose fingerprint no longer matches, and `npm test` fails until it does.
  - `config.json`: `apiUrl` is the scene-matching Worker's URL; `""` switches the scene box off.
- **Code**: `src/pages/props.astro` (page), `src/scripts/props-search.js` (keyword ranking), `src/scripts/props-scene.js` (Worker client), `scripts/props/` (import and tagging).
- **Prerequisites for updating a catalog**: `python3` with the `pdfplumber` package, and, for tags, a local Ollama with `qwen3.6:35b` (override with `PROPS_TAG_MODEL`).
- **Rules**:
  - The catalog PDF is a local input only. Never commit it or any vendor photo, and never download it from Drive or Linktree in a script.
  - Item numbers, names, eras and pages are shown exactly as the vendor printed them.
  - The page is text only: no photos and no copy of the catalog layout.

#### Updating a catalog
1. Edit `vendors.json` (catalog id, the PDF's `sha256`, `pageCount`, `sourceUrl`). Replace the old catalog's entry rather than adding one: the import drops items of any catalog that is no longer listed.
2. `npm run props:import -- --pdf "/path/to/catalog.pdf" --sheets-dir /tmp/props-sheets`
3. Review the overlay sheets and the report: item numbers, captions, photos, reused or malformed numbers. The import refuses to write when its structural checks fail.
4. Copy the reported counts into the catalog's `expected` in `vendors.json`.
5. `npm run props:tags`, then review the new tags. Record any removal in `scripts/props/tag-exclusions.json`.
6. `npm test`, then commit.
7. Redeploy the Worker (`cd worker && npx wrangler deploy`), because it bundles the inventory.
8. Push.

#### Local demo mode (private, never published)
A local-only version of `/props` for screenshare pitches. It adds photo thumbnails cropped from the vendor's PDF and "Open catalog (local PDF)" links that open a local copy at the item's page, zoomed to its photo. Scene matching goes through the Worker.
- **First run:** `npm run props:demo -- --pdf "/path/to/catalog.pdf"`. This checks the PDF's sha256 against `vendors.json` and builds `.props-demo/` (about 350 WebP thumbnails, a copy of the PDF, and `manifest.json` with each item's page and photo position). It then starts the dev server at http://localhost:4321/props with `PROPS_DEMO=1` and the Worker URL set for that process only.
- **Later runs:** `npm run props:demo`. To rebuild the assets, run `npm run props:demo-assets -- --pdf "…"`.
- **Port 4321 must be free.** The Worker only answers that origin, so the command stops instead of moving to another port.
- **Never commit or publish these files.**
  - `.props-demo/` is gitignored and sits outside `public/` and `src/`, so no build copies it.
  - The scripts refuse to write anywhere git doesn't ignore, or under `public/` or `src/`.
  - `astro build` refuses to run with `PROPS_DEMO=1`.
  - `npm test` fails if a `.pdf`, or any `.webp` other than the site's own two, is tracked.
  - `git add -f` bypasses all of this, and the repository is public, so never force-add anything from `.props-demo/`.
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