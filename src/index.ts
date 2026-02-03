import { writeFileSync } from 'fs';
import { join } from 'path';
import { ZillowScraper } from './scraper';

/**
 * Main entry point for Zillow scraper
 */
async function main() {
    console.log('Zillow Agent Scraper\n');
    console.log('='.repeat(50));
    console.log('Target: Seattle Top Agents');
    console.log('Limit: 1000 agents');
    console.log('='.repeat(50) + '\n');

    try {
        const scraper = new ZillowScraper();
        const results = await scraper.run();

        // Save to output.json
        const outputPath = join(process.cwd(), 'output.json');
        writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');

        console.log(`Results saved to: ${outputPath}`);
        console.log(`Total agents: ${results.length}`);

        // Print summary
        const withBadge = results.filter(r => r.badge_type).length;
        const withSales = results.filter(r => r.sales_last_12_months !== null).length;
        const teams = results.filter(r => r.team_members_count !== null).length;

        console.log('\nSummary:');
        console.log(`  Agents with badges: ${withBadge}/${results.length}`);
        console.log(`  Agents with sales data: ${withSales}/${results.length}`);
        console.log(`  Teams: ${teams}/${results.length}`);

        process.exit(0);

    } catch (error) {
        console.error('\nScraper failed:');
        console.error(error);
        process.exit(1);
    }
}

main();
