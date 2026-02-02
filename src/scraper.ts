import { chromium, Browser, Page } from 'playwright';
import { AgentListItem, AgentDetails, AgentData } from './types';
import { delay, scrollPageToBottom, parseNumber, waitForPageLoad } from './utils';

export class ZillowScraper {
    private browser: Browser | null = null;
    private readonly listUrl = 'https://www.zillow.com/professionals/real-estate-agent-reviews/seattle-wa/?isTopAgent=true';
    private readonly agentLimit = 100;

    /**
     * Launch browser instance
     */
    private async launchBrowser(): Promise<void> {
        this.browser = await chromium.launch({
            headless: false,  // Changed to headful - Zillow blocks headless
            slowMo: 500,       // Slow down to appear more human
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox'
            ]
        });
    }

    /**
     * Close browser instance
     */
    private async closeBrowser(): Promise<void> {
        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
    }

    /**
     * Scrape list page with pagination support
     */
    private async scrapeListPage(): Promise<AgentListItem[]> {
        if (!this.browser) throw new Error('Browser not initialized');

        const context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 1920, height: 1080 },
            deviceScaleFactor: 1
        });
        const page = await context.newPage();
        const agents: AgentListItem[] = [];
        let currentPage = 1;

        try {
            // Loop through pages until we have enough agents
            while (agents.length < this.agentLimit) {
                const pageUrl = currentPage === 1
                    ? this.listUrl
                    : `${this.listUrl}&page=${currentPage}`;

                console.log(`\nNavigating to page ${currentPage}...`);
                await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

                console.log('Waiting for content to load...');
                await page.waitForTimeout(8000);

                // Try to wait for profile links
                console.log('Waiting for agent profile links...');
                try {
                    await page.waitForSelector('a[href*="/profile/"]', { timeout: 15000 });
                    console.log('Profile links found!');
                } catch {
                    console.log('WARNING: Timeout waiting for profile links - no more pages');
                    break; // No more pages available
                }

                console.log('Scrolling to load all agent cards...');
                await scrollPageToBottom(page);
                await page.waitForTimeout(3000);

                console.log('Extracting agent data from DOM...\n');

                // Extract agent links from current page
                const extractedAgents = await page.evaluate((limit) => {
                    const results: Array<{
                        name: string;
                        url: string;
                        rating: number;
                        reviews: number;
                    }> = [];

                    // Find all links that point to agent profiles
                    const allLinks = Array.from(document.querySelectorAll('a[href*="/profile/"]'));

                    console.log(`Found ${allLinks.length} profile links`);

                    for (const link of allLinks) {
                        if (results.length >= limit) break;

                        try {
                            const href = link.getAttribute('href');
                            if (!href) continue;

                            // Build full URL
                            const fullUrl = href.startsWith('http')
                                ? href
                                : `https://www.zillow.com${href}`;

                            // Get the link's text and nearby context
                            const linkText = link.textContent || '';

                            // Parse the text format: "TEAM5.0 (2390)The Every Door TeamEvery Door Real E"
                            // OR: "5.0 (142)John DoeReal Broker LLC"

                            let rating: number | null = null;
                            let reviews: number | null = null;
                            let agentName: string | null = null;

                            // Look for rating pattern (X.X)
                            const ratingMatch = linkText.match(/(\d+\.\d+)/);
                            if (ratingMatch) {
                                rating = parseFloat(ratingMatch[1]);
                            }

                            // Look for review count in parentheses
                            const reviewMatch = linkText.match(/\((\d+)\)/);
                            if (reviewMatch) {
                                reviews = parseInt(reviewMatch[1], 10);
                            }

                            // If we found both rating and reviews, extract the name
                            if (rating && reviews && rating >= 1 && rating <= 5) {
                                // Remove rating, review count, and extra text to get name
                                let cleanText = linkText;

                                // Remove "TEAM" prefix if present
                                cleanText = cleanText.replace(/^TEAM/, '');

                                // Remove rating
                                cleanText = cleanText.replace(/\d+\.\d+/, '');

                                // Remove review count in parens
                                cleanText = cleanText.replace(/\(\d+\)/, '');

                                // Split on common separators and take first meaningful part
                                const parts = cleanText.split(/[•\-$]/);
                                agentName = parts[0].trim();

                                // If name is still empty or too short, use the whole cleaned text
                                if (!agentName || agentName.length < 3) {
                                    agentName = cleanText.trim().substring(0, 100);
                                }

                                // Final cleanup - take first line if multi-line
                                agentName = agentName.split('\n')[0].trim();

                                if (agentName && agentName.length >= 3) {
                                    // Check for duplicates
                                    if (!results.some(r => r.url === fullUrl)) {
                                        results.push({
                                            name: agentName,
                                            url: fullUrl,
                                            rating: rating,
                                            reviews: reviews
                                        });
                                    }
                                }
                            }
                        } catch (err) {
                            continue;
                        }
                    }

                    return results;
                }, this.agentLimit);

                // Add newly extracted agents (avoid duplicates)
                for (const agent of extractedAgents) {
                    // Check for duplicates
                    if (agents.find(a => a.profile_url === agent.url)) continue;
                    if (agents.length >= this.agentLimit) break;

                    agents.push({
                        agent_name: agent.name,
                        profile_url: agent.url,
                        rating_stars: agent.rating,
                        review_count: agent.reviews
                    });

                    console.log(`  [${agents.length}] ${agent.name}`);
                    console.log(`      ${agent.rating}★ • ${agent.reviews} reviews`);
                    console.log(`      ${agent.url}\n`);
                }

                console.log(`Extracted ${extractedAgents.length} agents from page ${currentPage} (Total: ${agents.length})\n`);

                // Check if we should continue to next page
                if (extractedAgents.length === 0) {
                    console.log('No more agents found. Stopping pagination.\n');
                    break;
                }

                if (agents.length >= this.agentLimit) {
                    console.log(`Reached agent limit of ${this.agentLimit}. Stopping pagination.\n`);
                    break;
                }

                // Move to next page
                currentPage++;
                await delay(2000); // Polite delay between pages
            }

            if (agents.length > 0) {
                console.log(`Extracted total of ${agents.length} agents from ${currentPage} page(s)\n`);
            } else {
                console.log(`WARNING: No agents extracted. Page may be blocked or structure changed.\n`);
            }

        } catch (err) {
            console.error('ERROR: Error during list page scraping:', err);
        } finally {
            await page.close();
            await context.close();
        }

        return agents.slice(0, this.agentLimit);
    }

    /**
     * Scrape detail page for an individual agent
     */
    private async scrapeDetailPage(url: string): Promise<AgentDetails> {
        if (!this.browser) throw new Error('Browser not initialized');

        const context = await this.browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        const page = await context.newPage();

        const details: AgentDetails = {
            badge_type: null,
            sales_last_12_months: null,
            total_sales: null,
            average_price: null,
            price_range: null,
            team_members_count: null
        };

        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForTimeout(3000);
            await scrollPageToBottom(page);

            // Extract all detail data
            const extracted = await page.evaluate(() => {
                const result = {
                    badge: null as string | null,
                    salesLast12Months: null as number | null,
                    totalSales: null as number | null,
                    averagePrice: null as string | null,
                    priceRange: null as string | null,
                    teamMembers: null as number | null
                };

                const bodyText = document.body.textContent || '';

                // Extract badge - use multiple strategies for robustness
                let badgeFound = false;

                // Strategy 1: Look for specific badge-related elements/classes
                const badgeElements = document.querySelectorAll('[class*="badge" i], [class*="agent-type" i], [class*="designation" i]');
                for (const el of Array.from(badgeElements)) {
                    const text = el.textContent?.trim() || '';
                    if (text.match(/premier\s+agent/i)) {
                        result.badge = 'Premier Agent';
                        badgeFound = true;
                        break;
                    } else if (text.match(/top\s+agent/i)) {
                        result.badge = 'Top Agent';
                        badgeFound = true;
                        break;
                    } else if (text.match(/zillow\s+pro/i)) {
                        result.badge = 'Zillow Pro';
                        badgeFound = true;
                        break;
                    }
                }

                // Strategy 2: Search in profile header area (first ~2000 chars of visible text)
                if (!badgeFound) {
                    // Get the first portion of the page text where profile info usually is
                    const headerArea = bodyText.substring(0, 2000);

                    if (headerArea.match(/zillow\s+pro/i)) {
                        result.badge = 'Zillow Pro';
                        badgeFound = true;
                    } else if (headerArea.match(/top\s+agent/i)) {
                        result.badge = 'Top Agent';
                        badgeFound = true;
                    } else if (headerArea.match(/premier\s+agent/i)) {
                        result.badge = 'Premier Agent';
                        badgeFound = true;
                    }
                }

                // Strategy 3: Look near the agent's name element
                if (!badgeFound) {
                    const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
                    for (const heading of headings) {
                        const headingText = heading.textContent || '';
                        // Find the heading that likely contains the agent name (contains the agent name we're looking for)
                        if (headingText.length > 5 && headingText.length < 100) {
                            // Check the next few siblings for badge info
                            let nextEl = heading.nextElementSibling;
                            for (let i = 0; i < 3 && nextEl; i++) {
                                const siblingText = nextEl.textContent || '';
                                if (siblingText.match(/zillow\s+pro/i)) {
                                    result.badge = 'Zillow Pro';
                                    badgeFound = true;
                                    break;
                                } else if (siblingText.match(/top\s+agent/i)) {
                                    result.badge = 'Top Agent';
                                    badgeFound = true;
                                    break;
                                } else if (siblingText.match(/premier\s+agent/i)) {
                                    result.badge = 'Premier Agent';
                                    badgeFound = true;
                                    break;
                                }
                                nextEl = nextEl.nextElementSibling;
                            }
                            if (badgeFound) break;
                        }
                    }
                }

                // Robust helper to find value associated with a label
                const findValueForLabel = (targetLabel: string): string | null => {
                    const allElements = Array.from(document.querySelectorAll('div, span, p, dt, dd, strong, b'));

                    for (const el of allElements) {
                        const text = el.textContent?.trim();

                        // 1. Strict containment check
                        if (text && text.includes(targetLabel)) {
                            // Skip massive containers to avoid grabbing entire rows
                            if (text.length > 200) continue;

                            let candidate: string | null = null;

                            // Strategy A: concatenated "ValueLabel" in the element or parent
                            // e.g., "6,666Total sales" or "$710KAverage price"
                            if (text.endsWith(targetLabel)) {
                                candidate = text.replace(targetLabel, '').trim();
                            }

                            // Strategy B: Siblings
                            // Only use if we matched the Label strictly (or very closely)
                            // This avoids matching "Average Price" inside a sibling block of "Price Range"
                            if (!candidate && text === targetLabel) {
                                const prev = el.previousElementSibling;
                                if (prev) {
                                    candidate = prev.textContent?.trim() || null;
                                }
                            }

                            // VALIDATION: Strict filter for valid stats
                            // Must be short (< 30 chars), non-empty
                            // Must NOT contain other labels (e.g. dont return "Average Price" as a value)
                            // Must NOT contain team disclaimer text
                            if (
                                candidate &&
                                candidate.length > 0 &&
                                candidate.length < 30 &&
                                !candidate.toLowerCase().includes('price range') &&
                                !candidate.toLowerCase().includes('average price') &&
                                !candidate.toLowerCase().includes('total sales') &&
                                !candidate.toLowerCase().includes('sales last') &&
                                !candidate.toLowerCase().includes('sales numbers represent') &&
                                !candidate.toLowerCase().includes('team') &&
                                !candidate.includes('{') &&
                                !candidate.includes('function')
                            ) {
                                return candidate;
                            }
                        }
                    }

                    return null;
                };

                // Extract stats
                const salesLast12Str = findValueForLabel('Sales last 12 months');
                if (salesLast12Str) {
                    const cleanStr = salesLast12Str.replace(/,/g, '');
                    const match = cleanStr.match(/(\d+)/);
                    if (match) result.salesLast12Months = parseInt(match[1], 10);
                }

                const totalSalesStr = findValueForLabel('Total sales');
                if (totalSalesStr) {
                    const cleanStr = totalSalesStr.replace(/,/g, '');
                    const match = cleanStr.match(/(\d+)/);
                    if (match) result.totalSales = parseInt(match[1], 10);
                }

                result.averagePrice = findValueForLabel('Average price');
                result.priceRange = findValueForLabel('Price range') || findValueForLabel('Price Range');

                // Team members detection - multiple strategies
                let teamCountStr = findValueForLabel('Team members');

                // Strategy 1: Look for discrete "X members" text
                if (!teamCountStr) {
                    const allElements = Array.from(document.querySelectorAll('div, span, p, h4, h5, h6'));
                    for (const el of allElements) {
                        const txt = el.textContent?.trim();
                        if (txt && /^\d+\s+members?$/i.test(txt)) {
                            teamCountStr = txt;
                            break;
                        }
                    }
                }

                // Strategy 2: Parse from text
                if (teamCountStr) {
                    const match = teamCountStr.replace(/,/g, '').match(/(\d+)/);
                    if (match) result.teamMembers = parseInt(match[1], 10);
                } else {
                    // Strategy 3: Count individual team member profile cards
                    // Works for small teams that show cards instead of a count
                    if (bodyText.match(/Meet [Tt]he.{0,50}(Team|Group)/)) {
                        const allDivs = Array.from(document.querySelectorAll('div'));

                        // Find cards matching team member profile pattern
                        const profileCards = allDivs.filter(div => {
                            const text = div.textContent || '';
                            const textLen = text.length;

                            // Card size filter
                            if (textLen < 80 || textLen > 600) return false;

                            // Must have rating, sales, price range, and image
                            const hasRating = /\d\.\d\s*★/.test(text) || /\d\.\d\s*\(\d+\)/.test(text);
                            const hasSales = /\d+\s*sales?\s+last\s+12\s+months/i.test(text);
                            const hasPriceRange = /\$[\d.]+[KM]?\s*-\s*\$[\d.]+[KM]?\s*price\s+range/i.test(text);
                            const hasImage = div.querySelector('img') !== null;

                            return hasRating && hasSales && hasPriceRange && hasImage;
                        });

                        const cardCount = profileCards.length;
                        if (cardCount >= 2 && cardCount <= 20) {
                            result.teamMembers = cardCount;
                        }
                    }
                }

                return result;
            });

            details.badge_type = extracted.badge;
            details.sales_last_12_months = extracted.salesLast12Months;
            details.total_sales = extracted.totalSales;
            details.average_price = extracted.averagePrice;
            details.price_range = extracted.priceRange;
            details.team_members_count = extracted.teamMembers;

        } catch (err) {
            console.error(`  WARNING: Error scraping detail page: ${err}`);
        } finally {
            await page.close();
            await context.close();
        }

        return details;
    }

    /**
     * Main scraper execution
     */
    async run(): Promise<AgentData[]> {
        const startTime = Date.now();
        const results: AgentData[] = [];

        try {
            await this.launchBrowser();

            // Step 1: Scrape list page
            const listItems = await this.scrapeListPage();

            if (listItems.length === 0) {
                console.log('WARNING: No agents found on list page');
                console.log('This might be due to Zillow blocking or page structure changes');
                return results;
            }

            // Step 2: Scrape detail pages in parallel (with concurrency limit)
            console.log('Scraping detail pages in parallel...\n');

            const CONCURRENCY_LIMIT = 5; // Process 5 agents at a time
            const batches: AgentListItem[][] = [];

            // Split agents into batches
            for (let i = 0; i < listItems.length; i += CONCURRENCY_LIMIT) {
                batches.push(listItems.slice(i, i + CONCURRENCY_LIMIT));
            }

            let processedCount = 0;

            // Process each batch in parallel
            for (const batch of batches) {
                const batchPromises = batch.map(async (agent, batchIndex) => {
                    const globalIndex = processedCount + batchIndex;
                    console.log(`[${globalIndex + 1}/${listItems.length}] Starting: ${agent.agent_name}`);

                    const agentStartTime = Date.now();
                    const details = await this.scrapeDetailPage(agent.profile_url);
                    const agentEndTime = Date.now();
                    const agentScrapeTime = (agentEndTime - agentStartTime) / 1000;

                    const result: AgentData = {
                        ...agent,
                        ...details,
                        scrape_time_seconds: parseFloat(agentScrapeTime.toFixed(2))
                    };

                    console.log(`[${globalIndex + 1}/${listItems.length}] DONE: ${agent.agent_name}`);
                    console.log(`  Badge: ${details.badge_type || 'None'} | Sales (12mo): ${details.sales_last_12_months ?? 'N/A'} | Total: ${details.total_sales ?? 'N/A'} | Team: ${details.team_members_count ?? 'N/A'} | Time: ${agentScrapeTime.toFixed(2)}s\n`);

                    return result;
                });

                // Wait for batch to complete
                const batchResults = await Promise.all(batchPromises);
                results.push(...batchResults);
                processedCount += batch.length;

                // Small delay between batches (not between individual requests)
                if (processedCount < listItems.length) {
                    console.log(`Batch complete (${processedCount}/${listItems.length}). Brief pause...\n`);
                    await delay(1000);
                }
            }

            const endTime = Date.now();
            const totalTime = (endTime - startTime) / 1000; // Convert to seconds
            const avgTimePerAgent = results.length > 0 ? totalTime / results.length : 0;

            console.log(`\nScraping complete! Extracted ${results.length} agents.`);
            console.log(`Total time: ${totalTime.toFixed(2)}s`);
            console.log(`Average time per agent: ${avgTimePerAgent.toFixed(2)}s\n`);

        } finally {
            await this.closeBrowser();
        }

        return results;
    }
}
