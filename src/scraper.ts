import { chromium, Browser, Page } from 'playwright';
import { AgentListItem, AgentDetails, AgentData } from './types';
import { delay, scrollPageToBottom, parseNumber, waitForPageLoad } from './utils';

export class ZillowScraper {
    private browser: Browser | null = null;
    private readonly listUrl = 'https://www.zillow.com/professionals/real-estate-agent-reviews/seattle-wa/?isTopAgent=true';
    private agentLimit = 1000;

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
     * Scrape list page with pagination support - JSON extraction approach
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
                await page.goto(pageUrl, {
                    waitUntil: 'domcontentloaded', // Faster than 'load'
                    timeout: 60000
                });

                console.log('Waiting for data...');
                try {
                    await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 15000 });
                } catch (e) {
                    console.log('Wait for JSON timed out. Checking for bot protection...');

                    // Check for common bot protection texts
                    const isBotProtection = await page.evaluate(() => {
                        return document.body.innerText.includes('Press and Hold') ||
                            document.body.innerText.includes('challenge') ||
                            document.title.includes('Robot') ||
                            document.title.includes('Captcha');
                    });

                    if (isBotProtection) {
                        console.log('\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
                        console.log('BOT PROTECTION DETECTED!');
                        console.log('Please switch to the browser window and solve the CAPTCHA manually.');
                        console.log('The scraper is paused and waiting for you to solve it...');
                        console.log('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n');

                        // Wait indefinitely for the user to solve it and the data to appear
                        try {
                            await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 300000 }); // Wait 5 mins
                            console.log('Captcha solved! Resuming...');
                            await delay(2000); // Give it a moment to settle
                        } catch (timeoutErr) {
                            console.log('Timed out waiting for manual solve. Skipping page...');
                            continue;
                        }
                    } else {
                        console.log('No obvious bot protection found, attempting extraction anyway...');
                    }
                }

                console.log('Extracting agent data from __NEXT_DATA__ JSON...\n');

                // Extract agents from __NEXT_DATA__ JSON
                const extractedAgents = await page.evaluate(() => {
                    try {
                        // Find the __NEXT_DATA__ script tag
                        const scriptTag = document.querySelector('#__NEXT_DATA__');
                        if (!scriptTag || !scriptTag.textContent) {
                            console.log('No __NEXT_DATA__ found');
                            return [];
                        }

                        const data = JSON.parse(scriptTag.textContent);

                        // Navigate to the results cards
                        const resultsCards = data?.props?.pageProps?.displayData
                            ?.agentDirectoryFinderDisplay?.searchResults?.results?.resultsCards;

                        if (!resultsCards || !Array.isArray(resultsCards)) {
                            console.log('No results cards found in JSON');
                            return [];
                        }

                        const agents: Array<{
                            name: string;
                            url: string;
                            rating: number;
                            reviews: number;
                        }> = [];

                        for (const card of resultsCards) {
                            // Skip non-profile cards (like PLC ads)
                            if (card.__typename !== 'AgentDirectoryFinderProfileResultsCard') {
                                continue;
                            }

                            const name = card.cardTitle;
                            const url = card.cardActionLink;
                            const rating = card.reviewInformation?.reviewAverage || 0;

                            // Parse review count from text like "(2390)"
                            const reviewText = card.reviewInformation?.reviewCountText || '(0)';
                            const reviewMatch = reviewText.match(/\((\d+)\)/);
                            const reviews = reviewMatch ? parseInt(reviewMatch[1], 10) : 0;

                            if (name && url && rating > 0) {
                                agents.push({
                                    name,
                                    url,
                                    rating,
                                    reviews
                                });
                            }
                        }

                        console.log(`Found ${agents.length} agents on this page`);
                        return agents;

                    } catch (err) {
                        console.error('Error parsing JSON:', err);
                        return [];
                    }
                });

                // Add newly extracted agents (avoid duplicates)
                let newAgentsOnPage = 0;
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
                    newAgentsOnPage++;

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

                // Break if no NEW agents were added (handling Zillow's infinite repeat of last page)
                if (newAgentsOnPage === 0) {
                    console.log('No new agents found on this page (likely reached end of results). Stopping pagination.\n');
                    break;
                }

                if (agents.length >= this.agentLimit) {
                    console.log(`Reached agent limit of ${this.agentLimit}. Stopping pagination.\n`);
                    break;
                }

                // Move to next page
                currentPage++;
                const pauseTime = Math.floor(Math.random() * 3000) + 2000; // Random delay 2-5s
                await delay(pauseTime);
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
     * Scrape detail page for an individual agent - JSON extraction approach
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
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

            // Wait for __NEXT_DATA__ to be present instead of hard wait
            // Wait for __NEXT_DATA__ to be present instead of hard wait
            try {
                await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 15000 });
            } catch (e) {
                console.log('    Wait for JSON timed out. Checking for bot protection...');

                // Check for common bot protection texts
                const isBotProtection = await page.evaluate(() => {
                    return document.body.innerText.includes('Press and Hold') ||
                        document.body.innerText.includes('challenge') ||
                        document.title.includes('Robot') ||
                        document.title.includes('Captcha');
                });

                if (isBotProtection) {
                    console.log('\n    !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
                    console.log('    BOT PROTECTION DETECTED ON DETAIL PAGE!');
                    console.log('    Please switch to the browser window and solve the CAPTCHA manually.');
                    console.log('    The scraper is paused and waiting for you to solve it...');
                    console.log('    !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n');

                    // Wait indefinitely for the user to solve it and the data to appear
                    try {
                        await page.waitForSelector('#__NEXT_DATA__', { state: 'attached', timeout: 300000 }); // Wait 5 mins
                        console.log('    Captcha solved! Resuming...');
                        await delay(2000); // Give it a moment to settle
                    } catch (timeoutErr) {
                        console.log('    Timed out waiting for manual solve. Skipping page...');
                    }
                } else {
                    console.log('    No obvious bot protection found, attempting extraction anyway...');
                }
            }

            // Extract from __NEXT_DATA__ JSON
            const extracted = await page.evaluate(() => {
                try {
                    // Find __NEXT_DATA__ script tag
                    const scriptTag = document.querySelector('#__NEXT_DATA__');
                    if (!scriptTag || !scriptTag.textContent) {
                        return null;
                    }

                    const data = JSON.parse(scriptTag.textContent);
                    const pageProps = data?.props?.pageProps;

                    if (!pageProps) {
                        return null;
                    }

                    const result = {
                        badge: null as string | null,
                        salesLast12Months: null as number | null,
                        totalSales: null as number | null,
                        averagePrice: null as string | null,
                        priceRange: null as string | null,
                        teamMembers: null as number | null
                    };

                    // Extract sales stats
                    const salesStats = pageProps.agentSalesStats;
                    if (salesStats) {
                        result.salesLast12Months = salesStats.countLastYear || null;
                        result.totalSales = salesStats.countAllTime || null;

                        // Format average price
                        if (salesStats.averageValueThreeYear) {
                            const avgPrice = salesStats.averageValueThreeYear;
                            if (avgPrice >= 1000000) {
                                result.averagePrice = `$${(avgPrice / 1000000).toFixed(1)}M`;
                            } else if (avgPrice >= 1000) {
                                result.averagePrice = `$${(avgPrice / 1000).toFixed(0)}K`;
                            } else {
                                result.averagePrice = `$${avgPrice}`;
                            }
                        }

                        // Format price range
                        const minPrice = salesStats.priceRangeThreeYearMin;
                        const maxPrice = salesStats.priceRangeThreeYearMax;
                        if (minPrice && maxPrice) {
                            const formatPrice = (price: number) => {
                                if (price >= 1000000) {
                                    return `$${(price / 1000000).toFixed(1)}M`;
                                } else if (price >= 1000) {
                                    return `$${(price / 1000).toFixed(0)}K`;
                                } else {
                                    return `$${price}`;
                                }
                            };
                            result.priceRange = `${formatPrice(minPrice)} - ${formatPrice(maxPrice)}`;
                        }
                    }

                    // Extract badge from graphQLData
                    const graphQLData = pageProps.graphQLData;
                    if (graphQLData) {
                        if (graphQLData.isPremium === true) {
                            result.badge = 'Zillow Pro';
                        } else if (graphQLData.premierAgentSection) {
                            result.badge = 'Premier Agent';
                        }
                    }

                    // Extract team members count
                    const teamInfo = pageProps.teamDisplayInformation;
                    if (teamInfo?.teamLeadInfo?.children) {
                        result.teamMembers = teamInfo.teamLeadInfo.children.length;
                    }

                    return result;

                } catch (err) {
                    console.error('Error parsing profile JSON:', err);
                    return null;
                }
            });

            if (extracted) {
                details.badge_type = extracted.badge;
                details.sales_last_12_months = extracted.salesLast12Months;
                details.total_sales = extracted.totalSales;
                details.average_price = extracted.averagePrice;
                details.price_range = extracted.priceRange;
                details.team_members_count = extracted.teamMembers;
            }

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

            const CONCURRENCY_LIMIT = 5; // Process 5 agents at a time (Balanced)
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
                        ...details
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
