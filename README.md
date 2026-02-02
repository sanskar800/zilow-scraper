# Zillow Agent Scraper

Web scraper for extracting real estate agent data from Zillow using Playwright.

## Quick Start

```bash
npm install
npx playwright install chromium
npm start
```

Results are saved to `output.json`.

## Configuration

**Target**: Seattle Top Agents  
**Limit**: 100 agents (configurable in `src/scraper.ts`)

## Project Structure

```
src/
├── index.ts       # Entry point - orchestrates scraping
├── scraper.ts     # Main logic: pagination, list page, detail page
├── types.ts       # TypeScript interfaces
└── utils.ts       # Helper functions (scroll, delay, etc.)
```

## How It Works

### 1. List Page Scraping (`scrapeListPage`)
- Loops through pages using `&page=N` parameter
- Finds agent profile links (`a[href*="/profile/"]`)
- Extracts: name, URL, rating, review count
- Stops when reaching 100 agents or no more pages

### 2. Detail Page Scraping (`scrapeDetailPage`)
- Visits each agent's profile URL
- Extracts:
  - **Badge**: Premier Agent, Top Agent, Zillow Pro
  - **Sales**: Last 12 months, total sales
  - **Price**: Average price, price range
  - **Team**: Member count (if team)
- Runs in parallel batches of 5 for performance

### 3. Output
Each agent includes:
```json
{
  "agent_name": "John Doe",
  "profile_url": "https://...",
  "rating_stars": 5.0,
  "review_count": 142,
  "badge_type": "Premier Agent",
  "sales_last_12_months": 28,
  "total_sales": 156,
  "average_price": "$650K",
  "price_range": "$200K - $2M",
  "team_members_count": 5,
  "scrape_time_seconds": 3.2
}
```

## Key Files

| File | Purpose |
|------|---------|
| `scraper.ts` | Pagination loop, list extraction, detail extraction |
| `index.ts` | Runs scraper, saves JSON output |
| `utils.ts` | Scroll page, delay, parse numbers |
| `types.ts` | Data structure definitions |

## Notes

- Uses non-headless mode (Zillow blocks headless browsers)
- 2-second delay between pages
- Handles duplicate agents across pages
- Graceful handling of missing data (returns `null`)
