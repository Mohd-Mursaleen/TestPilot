const puppeteer = require("puppeteer-core");
const cheerio = require("cheerio");
const dotenv = require("dotenv");
const fs = require("fs");
dotenv.config();

// Utility function for structured logging
const log = (message, data = {}) => {
  console.log(
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        message,
        ...data,
      },
      null,
      2,
    ),
  );
};

// Launches the browser and sets up the page
async function setupBrowser() {
  const browserExecPath =
    process.env.BROWSER_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await puppeteer.launch({
    headless: false,
    devtools: false,
    executablePath: browserExecPath,
    args: [
      "--no-sandbox",
      "--start-maximized",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
      "--disable-extensions",
      "--no-first-run",
    ],
  });
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
  );
  await page.setViewport({ width: 1920, height: 1080 });

  // Handle pop-ups and cookie consents
  page.on("load", async () => {
    try {
      const selectors = [
        ".cc-dismiss",
        "[id*='cookie'] button",
        "[class*='cookie'] button",
        "[id*='accept']",
        "[class*='accept']",
      ];
      for (const selector of selectors) {
        const button = await page.$(selector);
        if (button) {
          await button.click();
          log("Dismissed cookie consent popup", { selector });
          break;
        }
      }
    } catch (error) {
      log("No cookie consent popup found or error dismissing it", {
        error: error.message,
      });
    }
  });

  return { browser, page };
}

// Clean HTML for processing
async function cleanHtmlForProcessing(page) {
  const content = await page.content();
  const $ = cheerio.load(content);

  // Remove script, style, svg, and other non-essential elements
  $("script, style, svg, iframe, noscript, meta, link, head").remove();

  // Remove all comments
  $("*")
    .contents()
    .each(function () {
      if (this.type === "comment") {
        $(this).remove();
      }
    });

  // Remove data attributes to reduce size
  $("*").each(function () {
    const attrs = $(this).attr();
    if (!attrs) return;

    Object.keys(attrs).forEach((attr) => {
      // Keep only essential attributes and remove data-* attributes except data-qa which is useful
      if (attr.startsWith("data-") && attr !== "data-qa") {
        $(this).removeAttr(attr);
      }
    });
  });

  // Simplify complex structures but keep important text and interactive elements
  $("img").replaceWith("<img />");
  $("video, audio, canvas").remove();

  // Remove excessive whitespace
  let html = $.html();
  html = html.replace(/\s{2,}/g, " ");
  html = html.replace(/>\s+</g, "><");

  // Remove inline styles and onX handlers
  const cleanedHtml = cheerio.load(html);
  cleanedHtml("*").each(function () {
    $(this).removeAttr("style");

    // Remove event handlers
    const attrs = $(this).attr();
    if (!attrs) return;

    Object.keys(attrs).forEach((attr) => {
      if (attr.startsWith("on")) {
        $(this).removeAttr(attr);
      }
    });
  });

  // Keep important attributes for form elements and buttons
  cleanedHtml("input, select, textarea, button, form, a, label").each(
    (i, el) => {
      const attrs = $(el).attr();
      const keepAttrs = [
        "id",
        "class",
        "type",
        "name",
        "value",
        "placeholder",
        "role",
        "aria-label",
        "href",
        "for",
        "action",
        "method",
        "data-qa",
      ];

      if (!attrs) return;

      Object.keys(attrs).forEach((attr) => {
        if (!keepAttrs.includes(attr)) {
          $(el).removeAttr(attr);
        }
      });
    },
  );

  return cleanedHtml.html();
}

// Navigate to website
async function navigateToWebsite(page, url) {
  try {
    log("Navigating to website", { url });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    const finalUrl = await page.url();
    log("Successfully navigated to website", {
      originalUrl: url,
      finalUrl: finalUrl,
    });

    return {
      success: true,
      message: "Successfully navigated to website",
      finalUrl: finalUrl,
    };
  } catch (error) {
    log("Error navigating to website", { error: error.message });
    return {
      success: false,
      message: `Error navigating to website: ${error.message}`,
      finalUrl: url,
    };
  }
}

// Main automation function - simplified for website testing
async function browserAutomation(testId, url, options = {}) {
  const { keepBrowserOpen = true } = options;

  log("Starting browser automation for website testing", {
    testId,
    url,
    keepBrowserOpen,
  });

  const { browser, page } = await setupBrowser();
  let success = false;
  let finalUrl = url;

  try {
    // Navigate to website
    const navigationResult = await navigateToWebsite(page, url);

    if (!navigationResult.success) {
      log("Failed to navigate to website", {
        message: navigationResult.message,
      });
      return {
        success: false,
        message: navigationResult.message,
        finalUrl,
        browserLeft: keepBrowserOpen,
      };
    }

    // Update final URL
    finalUrl = navigationResult.finalUrl;
    success = true;

    // Wait for manual interaction if required
    if (keepBrowserOpen) {
      log(
        "Keeping browser open for website testing. The API will return a response but the browser will remain open.",
      );

      // We don't want to close the browser, but we still need to resolve the Promise
      // We'll create a global reference to prevent garbage collection
      global._activeBrowsers = global._activeBrowsers || [];
      global._activeBrowsers.push({
        browser,
        page,
        testId: testId,
        startTime: new Date(),
      });
    }

    return {
      success,
      message: "Website loaded successfully. Browser left open for testing.",
      finalUrl,
      browserLeft: keepBrowserOpen,
    };
  } catch (error) {
    log("Error during automation", {
      error: error.message,
      stack: error.stack,
    });

    // Only close the browser on error if not keeping open
    if (!keepBrowserOpen) {
      try {
        await browser.close();
      } catch (closeError) {
        log("Error closing browser", { error: closeError.message });
      }
    } else {
      // Keep browser open even on error for debugging
      global._activeBrowsers = global._activeBrowsers || [];
      global._activeBrowsers.push({
        browser,
        page,
        testId: testId,
        startTime: new Date(),
        hasError: true,
        errorMessage: error.message,
      });
    }

    return {
      success: false,
      message: `Error: ${error.message}`,
      finalUrl,
      browserLeft: keepBrowserOpen,
    };
  }
}

module.exports = browserAutomation;