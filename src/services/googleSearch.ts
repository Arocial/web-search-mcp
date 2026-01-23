import { chromium, devices, BrowserContextOptions, Browser } from "playwright";
import { SearchResponse, SearchResult, SearchOptions } from "../types/index.js";
import { logger } from "../utils/logger.js";
import * as fs from "fs";
import * as path from "path";
import { 
  getHostMachineConfig, 
  launchBrowser, 
  setupContext, 
  setupPage,
  loadSavedState,
  saveBrowserState,
  resolveContextOptions,
  SavedState,
  FingerprintConfig
} from "../utils/browser.js";

/**
 * Perform Google search and return results
 * @param query Search keyword
 * @param options Search options
 * @returns Search results
 */
export async function googleSearch(
  query: string,
  options: SearchOptions = {},
  existingBrowser?: Browser
): Promise<SearchResponse> {
  const {
    limit = 10,
    timeout = 60000,
    stateFile = "./browser-state.json",
    noSaveState = false,
    locale = "en-US",
  } = options;

  let useHeadless = !options.debug;
  const { storageState, savedState } = loadSavedState(stateFile);

  const deviceList = ["Desktop Chrome", "Desktop Edge", "Desktop Firefox", "Desktop Safari"];
  const googleDomains = [
    "https://www.google.com",
    "https://www.google.co.uk",
    "https://www.google.ca",
    "https://www.google.com.au",
  ];

  const getDeviceName = (): string => {
    if (savedState.fingerprint?.deviceName && devices[savedState.fingerprint.deviceName]) {
      return savedState.fingerprint.deviceName;
    }
    return deviceList[Math.floor(Math.random() * deviceList.length)];
  };

  const getRandomDelay = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

  async function performSearch(headless: boolean, forceNewBrowser: boolean = false): Promise<SearchResponse> {
    let browser: Browser;
    let browserWasProvided = !!existingBrowser && !forceNewBrowser;

    if (browserWasProvided && existingBrowser) {
      browser = existingBrowser;
      logger.info("[GoogleSearch] Using existing browser instance");
    } else {
      logger.info(`[GoogleSearch] Launching browser (headless=${headless})`);
      browser = await launchBrowser(headless, timeout);
    }

    const deviceName = getDeviceName();
    const contextOptions = resolveContextOptions(savedState, locale, deviceName);
    const context = await setupContext(browser, contextOptions, storageState);
    const page = await setupPage(context);

    try {
      let selectedDomain = savedState.googleDomain || googleDomains[Math.floor(Math.random() * googleDomains.length)];
      savedState.googleDomain = selectedDomain;

      logger.info(`[GoogleSearch] Visiting ${selectedDomain}`);
      const response = await page.goto(selectedDomain, { timeout, waitUntil: "networkidle" });

      const captchaPatterns = ["google.com/sorry/index", "google.com/sorry", "recaptcha", "captcha", "unusual traffic"];
      const isBlocked = () => captchaPatterns.some(p => page.url().includes(p) || (response && response.url().includes(p)));

      if (isBlocked()) {
        if (headless) {
          logger.warn("[GoogleSearch] CAPTCHA detected, restarting in non-headless mode...");
          await page.close();
          await context.close();
          if (!browserWasProvided) await browser.close();
          return performSearch(false, browserWasProvided);
        } else {
          logger.warn("[GoogleSearch] CAPTCHA detected, please solve it in the browser...");
          await page.waitForNavigation({
            timeout: timeout * 2,
            url: (url) => captchaPatterns.every(p => !url.toString().includes(p)),
          });
        }
      }

      logger.info(`[GoogleSearch] Searching for: ${query}`);
      const searchInputSelectors = ["textarea[name='q']", "input[name='q']", "textarea[title='Search']", "textarea"];
      let searchInput = null;
      for (const selector of searchInputSelectors) {
        searchInput = await page.$(selector);
        if (searchInput) break;
      }

      if (!searchInput) throw new Error("Could not find search box");

      await searchInput.click();
      await page.keyboard.type(query, { delay: getRandomDelay(10, 30) });
      await page.waitForTimeout(getRandomDelay(100, 300));
      await page.keyboard.press("Enter");

      await page.waitForLoadState("networkidle", { timeout });

      if (isBlocked()) {
        if (headless) {
          await page.close();
          await context.close();
          if (!browserWasProvided) await browser.close();
          return performSearch(false, browserWasProvided);
        }
        await page.waitForNavigation({ timeout: timeout * 2, url: (url) => captchaPatterns.every(p => !url.toString().includes(p)) });
        await page.waitForLoadState("networkidle", { timeout });
      }

      const searchResultSelectors = ["#search", "#rso", ".g", "div[role='main']"];
      let resultsFound = false;
      for (const selector of searchResultSelectors) {
        try {
          await page.waitForSelector(selector, { timeout: timeout / 2 });
          resultsFound = true;
          break;
        } catch (e) {}
      }

      const resultSelectors = [
        { container: "#search .g", title: "h3", snippet: ".VwiC3b" },
        { container: ".g", title: "h3", snippet: ".VwiC3b" },
      ];

      let results: SearchResult[] = [];
      for (const selector of resultSelectors) {
        results = await page.$$eval(selector.container, (elements, params) => {
          return elements.slice(0, params.maxResults).map(el => {
            const titleEl = el.querySelector(params.titleSelector);
            const linkEl = el.querySelector("a");
            const snippetEl = el.querySelector(params.snippetSelector);
            return {
              title: titleEl?.textContent || "",
              link: (linkEl as HTMLAnchorElement)?.href || "",
              snippet: snippetEl?.textContent || "",
            };
          }).filter(item => item.title && item.link);
        }, { maxResults: limit, titleSelector: selector.title, snippetSelector: selector.snippet });
        if (results.length > 0) break;
      }

      if (results.length === 0) {
        results = await page.$$eval("a[href^='http']", (elements, maxResults) => {
          return elements.filter(el => {
            const href = el.getAttribute("href") || "";
            return href.startsWith("http") && !href.includes("google.com/");
          }).slice(0, maxResults).map(el => ({
            title: el.textContent || "",
            link: (el as HTMLAnchorElement).href,
            snippet: el.parentElement?.textContent?.slice(0, 200) || "",
          })).filter(item => item.title && item.link);
        }, limit);
      }

      if (!noSaveState) {
        await saveBrowserState(context, stateFile, savedState);
      }

      if (!browserWasProvided && !options.debug) await browser.close();

      return { query, results };
    } catch (error) {
      logger.error(`[GoogleSearch] Error: ${error}`);
      if (!browserWasProvided && !options.debug) await browser.close();
      return { query, results: [{ title: "Search failed", link: "", snippet: String(error) }] };
    }
  }

  return performSearch(useHeadless);
}

/**
 * Perform multiple Google searches in parallel
 */
export async function multiGoogleSearch(
  queries: string[],
  options: SearchOptions = {}
): Promise<SearchResponse[]> {
  if (!queries?.length) throw new Error("At least one search query is required");

  logger.info(`[MultiSearch] Starting ${queries.length} searches...`);
  const browser = await launchBrowser(!options.debug, (options.timeout || 60000));

  try {
    const searches = await Promise.all(
      queries.map((query, index) => {
        const searchOptions = {
          ...options,
          stateFile: options.stateFile ? `${options.stateFile}-${index}` : `./browser-state-${index}.json`,
        };
        return googleSearch(query, searchOptions, browser);
      })
    );
    return searches;
  } finally {
    if (!options.debug) await browser.close();
  }
}
