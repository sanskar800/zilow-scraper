/**
 * Type definitions for Zillow agent scraper
 */

/**
 * Data extracted from list page (agent card)
 */
export interface AgentListItem {
    agent_name: string;
    profile_url: string;
    rating_stars: number;
    review_count: number;
}

/**
 * Data extracted from detail page (agent profile)
 */
export interface AgentDetails {
    badge_type: string | null;
    sales_last_12_months: number | null;
    total_sales: number | null;
    average_price: string | null;
    price_range: string | null;
    team_members_count: number | null;
}

/**
 * Complete agent data (list + detail combined)
 */
export interface AgentData extends AgentListItem, AgentDetails {
    scrape_time_seconds?: number;  // Time taken to scrape this agent's detail page
}

/**
 * Metadata about the scraping session
 */
export interface ScraperMetadata {
    total_agents: number;
    total_time_seconds: number;
    average_time_per_agent: number;
    timestamp: string;
}
