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