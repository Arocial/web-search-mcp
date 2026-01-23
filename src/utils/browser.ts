import { chromium, devices, Browser, BrowserContext, BrowserContextOptions, Page } from "playwright";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { logger } from "./logger.js";

export const DEFAULT_BROWSER_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-site-isolation-trials",
  "--disable-web-security",
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--disable-gpu",
  "--hide-scrollbars",
  "--mute-audio",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-breakpad",
  "--disable-component-extensions-with-background-pages",
  "--disable-extensions",
  "--disable-features=TranslateUI",
  "--disable-ipc-flooding-protection",
  "--disable-renderer-backgrounding",
  "--enable-features=NetworkService,NetworkServiceInProcess",
  "--force-color-profile=srgb",
  "--metrics-recording-only",
];

export const IGNORE_DEFAULT_ARGS = ["--enable-automation"];

export interface FingerprintConfig {
  deviceName: string;
  locale: string;
  timezoneId: string;
  colorScheme: "dark" | "light";
  reducedMotion: "reduce" | "no-preference";
  forcedColors: "active" | "none";
}

export interface SavedState {
  fingerprint?: FingerprintConfig;
  googleDomain?: string;
}

/**
 * Get the host machine's actual configuration
 */
export function getHostMachineConfig(userLocale?: string): FingerprintConfig {
  return {
    deviceName: "Desktop Chrome",
    locale: userLocale || process.env.LANG || "en-US",
    timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
    colorScheme: new Date().getHours() >= 19 || new Date().getHours() < 7 ? "dark" : "light",
    reducedMotion: "no-preference",
    forcedColors: "none",
  };
}

/**
 * Launch a browser with anti-detection arguments
 */
export async function launchBrowser(headless: boolean, timeout: number): Promise<Browser> {
  return await chromium.launch({
    headless,
    timeout: timeout * 2,
    args: DEFAULT_BROWSER_ARGS,
    ignoreDefaultArgs: IGNORE_DEFAULT_ARGS,
  });
}

/**
 * Setup a browser context with anti-detection scripts
 */
export async function setupContext(
  browser: Browser,
  stateFile: string,
): Promise<[BrowserContext, SavedState]> {

  const { storageState, savedState } = loadSavedState(stateFile);
  const options = resolveContextOptions(savedState);

  const context = await browser.newContext(
    storageState ? { ...options, storageState } : options
  );

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "plugins", { get: () => [1, 2, 3, 4, 5] });
    Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"] });

    // @ts-ignore
    window.chrome = {
      runtime: {},
      loadTimes: function () {},
      csi: function () {},
      app: {},
    };

    if (typeof WebGLRenderingContext !== "undefined") {
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (parameter: number) {
        if (parameter === 37445) return "Intel Inc.";
        if (parameter === 37446) return "Intel Iris OpenGL Engine";
        return getParameter.call(this, parameter);
      };
    }
  });

  return [context, savedState];
}

/**
 * Resolve browser context options based on saved state or host machine
 */
export function resolveContextOptions(
  savedState: SavedState,
): BrowserContextOptions {
  const machineConfig = getHostMachineConfig();
  const selectedDevice = savedState.fingerprint?.deviceName ||  machineConfig.deviceName;

  const contextOptions: BrowserContextOptions = {
    ...devices[selectedDevice],
    ...machineConfig,
    ...savedState.fingerprint,
    permissions: ["geolocation", "notifications"],
    acceptDownloads: true,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
  };

  if (!savedState.fingerprint) {
    savedState.fingerprint = {
      deviceName: selectedDevice,
      locale: contextOptions.locale!,
      timezoneId: contextOptions.timezoneId!,
      colorScheme: contextOptions.colorScheme as any,
      reducedMotion: contextOptions.reducedMotion as any,
      forcedColors: contextOptions.forcedColors as any,
    };
  }

  return contextOptions;
}

/**
 * Load saved state and fingerprint from files
 */
export function loadSavedState(stateFile: string): { storageState?: string; savedState: SavedState } {
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");
  let storageState: string | undefined = fs.existsSync(stateFile) ? stateFile : undefined;
  let savedState: SavedState = {};

  if (storageState && fs.existsSync(fingerprintFile)) {
    try {
      savedState = JSON.parse(fs.readFileSync(fingerprintFile, "utf8"));
    } catch (e) {
      logger.warn("[Browser] Cannot load fingerprint file");
    }
  }

  return { storageState, savedState };
}

/**
 * Save state and fingerprint to files
 */
export async function saveBrowserState(
  context: BrowserContext,
  stateFile: string,
  savedState: SavedState
): Promise<void> {
  const fingerprintFile = stateFile.replace(".json", "-fingerprint.json");
  const stateDir = path.dirname(stateFile);

  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  await context.storageState({ path: stateFile });
  fs.writeFileSync(fingerprintFile, JSON.stringify(savedState, null, 2));
}

/**
 * Setup a page with anti-detection scripts
 */
export async function setupPage(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(window.screen, "width", { get: () => 1920 });
    Object.defineProperty(window.screen, "height", { get: () => 1080 });
    Object.defineProperty(window.screen, "colorDepth", { get: () => 24 });
    Object.defineProperty(window.screen, "pixelDepth", { get: () => 24 });
  });
  return page;
}
