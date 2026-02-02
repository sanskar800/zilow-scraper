import { Page } from 'playwright';

/**
 * Delay execution for specified milliseconds
 */
export async function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Scroll page incrementally to trigger lazy loading
 */
export async function scrollPageToBottom(page: Page): Promise<void> {
    const scrollDelay = 500;
    const scrollStep = 500;

    let previousHeight = 0;
    let currentHeight = await page.evaluate(() => document.body.scrollHeight);

    while (previousHeight < currentHeight) {
        previousHeight = currentHeight;

        await page.evaluate((step) => {
            window.scrollBy(0, step);
        }, scrollStep);

        await delay(scrollDelay);
        currentHeight = await page.evaluate(() => document.body.scrollHeight);
    }

    // Scroll back to top
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(300);
}

/**
 * Extract number from text like "42 sales" or "42"
 */
export function parseNumber(text: string | null): number | null {
    if (!text) return null;

    const match = text.replace(/,/g, '').match(/\d+/);
    return match ? parseInt(match[0], 10) : null;
}

/**
 * Extract text content from element by label proximity
 * Finds label, then looks for nearby value
 */
export async function extractTextByLabel(
    page: Page,
    labelText: string
): Promise<string | null> {
    try {
        // Find element containing the label
        const element = await page.locator(`text=${labelText}`).first();

        if (!(await element.isVisible({ timeout: 2000 }))) {
            return null;
        }

        // Get parent element and extract following sibling or nearby text
        const value = await element.evaluate((el) => {
            // Try next sibling
            let sibling = el.nextElementSibling;
            if (sibling?.textContent?.trim()) {
                return sibling.textContent.trim();
            }

            // Try parent's next sibling
            const parent = el.parentElement;
            if (parent?.nextElementSibling?.textContent?.trim()) {
                return parent.nextElementSibling.textContent.trim();
            }

            // Try looking within same parent for a nearby value element
            if (parent) {
                const valueEl = parent.querySelector('[class*="value"], [class*="count"], [class*="number"]');
                if (valueEl?.textContent?.trim()) {
                    return valueEl.textContent.trim();
                }
            }

            return null;
        });

        return value;
    } catch {
        return null;
    }
}

/**
 * Wait for page to be fully loaded and stable
 */
export async function waitForPageLoad(page: Page): Promise<void> {
    await page.waitForLoadState('domcontentloaded');
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {
        // Continue if networkidle times out
    });
    await delay(1000);
}
