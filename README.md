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

## How It Works

This scraper uses **Playwright** to automate a real web browser (Chromium). It uses a robust **JSON extraction** strategy:

1.  **Navigates** to the Zillow agent list page.
2.  **Extracts** agent data directly from the `__NEXT_DATA__` JSON script tag embedded in the page (bypassing complex DOM selectors).
3.  **Paginate** through the list pages to collect all agent profiles.
4.  **Visits** each agent's profile page in parallel (concurrency limit: 5).
5.  **Extracts** detailed stats (badges, sales volume, team members) from the profile page's `__NEXT_DATA__` JSON.
6.  **Saves** the combined data to `output.json`.

This approach is significantly faster and more reliable than traditional DOM scraping as it reads the raw data used by Zillow's frontend framework (Next.js).

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
