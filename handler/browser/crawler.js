import { webkit, chromium } from "playwright";
import * as cheerio from "cheerio";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WebsiteCrawler {
  constructor(options = {}) {
    this.maxPages = options.maxPages || 10;
    this.delay = options.delay || 2000;
    this.viewport = options.viewport || { width: 1920, height: 1080 };
    this.outputDir = options.outputDir || './analysis_output';
    this.visitedUrls = new Set();
    this.foundUrls = new Set();
    this.results = [];
    this.visionAnalyzer = options.visionAnalyzer;
  }

  async setupBrowser() {
    const browserType = process.env.BROWSER_TYPE || 'webkit';
    const bravePath = process.env.BROWSER_PATH || '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
    
    let browser;
    if (browserType === 'brave') {
        browser = await chromium.launch({
        headless: false,
        args: ['--start-fullscreen'],
        executablePath: bravePath
      });
      
    } else if (browserType === 'webkit') {
      browser = await webkit.launch({ headless: false });
    } 

    const context = await browser.newContext({
      viewport: this.viewport,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    });

    return { browser, context };
  }

  async createOutputDirectory() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.sessionDir = path.join(this.outputDir, `analysis_${timestamp}`);
    await fs.mkdir(this.sessionDir, { recursive: true });
    await fs.mkdir(path.join(this.sessionDir, 'screenshots'), { recursive: true });
    return this.sessionDir;
  }

  async extractLinks(page, baseUrl) {
    return await page.evaluate((baseUrl) => {
      const links = Array.from(document.querySelectorAll('a[href]'));
      return links
        .map(link => {
          try {
            const url = new URL(link.href, baseUrl);
            // Only return links from the same domain
            if (url.hostname === new URL(baseUrl).hostname) {
              return url.href;
            }
          } catch (e) {
            return null;
          }
          return null;
        })
        .filter(Boolean);
    }, baseUrl);
  }

  async analyzePageContent(page) {
    return await page.evaluate(() => {
      const images = Array.from(document.querySelectorAll('img'));
      const hasLargeImages = images.some(img => {
        return img.naturalWidth > 2000 || img.naturalHeight > 2000;
      });

      const hasMissingAltText = images.some(img => !img.alt || img.alt.trim() === '');

      // Simple contrast check
      const textElements = Array.from(document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, div'));
      const hasLowContrast = textElements.some(el => {
        const style = window.getComputedStyle(el);
        const color = style.color;
        const bgColor = style.backgroundColor;
        return color === 'rgb(128, 128, 128)' || color.includes('gray');
      });

      // Check for potential responsive issues
      const hasFixedWidths = Array.from(document.querySelectorAll('*')).some(el => {
        const style = window.getComputedStyle(el);
        return style.width && style.width.includes('px') && parseInt(style.width) > 1200;
      });

      return {
        title: document.title,
        hasLargeImages,
        hasMissingAltText,
        hasLowContrast,
        hasResponsiveIssues: hasFixedWidths,
        imageCount: images.length,
        linkCount: document.querySelectorAll('a').length,
        headingStructure: Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6')).map(h => ({
          tag: h.tagName,
          text: h.textContent.trim().substring(0, 100)
        }))
      };
    });
  }

  async analyzePage(page, url) {
    try {
      console.log("Analyzing page:", url);
      
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(this.delay);

      // Take screenshot
      const screenshotName = `${this.sanitizeFilename(url)}.png`;
      const screenshotPath = path.join(this.sessionDir, 'screenshots', screenshotName);
      await page.screenshot({ 
        path: screenshotPath, 
        fullPage: true,
        type: 'png'
      });

      // Analyze page content
      const pageInfo = await this.analyzePageContent(page);
      
      // Get page performance metrics
      const performanceMetrics = await this.getPerformanceMetrics(page);

      // AI Vision Analysis
      let aiIssues = [];
      if (this.visionAnalyzer) {
        aiIssues = await this.visionAnalyzer.analyzeScreenshot(screenshotPath, pageInfo);
      }

      // Extract links for crawling
      const links = await this.extractLinks(page, url);
      links.forEach(link => {
        if (!this.visitedUrls.has(link) && this.foundUrls.size < this.maxPages) {
          this.foundUrls.add(link);
        }
      });

      const result = {
        url,
        timestamp: new Date().toISOString(),
        screenshot: screenshotPath,
        pageInfo,
        performanceMetrics,
        issues: aiIssues,
        linksFound: links.length
      };

      this.results.push(result);
      console.log("Page analysis completed:", url);
      
      return result;

    } catch (error) {
      console.error("Error analyzing page:", url, error);
      return {
        url,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async getPerformanceMetrics(page) {
    return await page.evaluate(() => {
      const navigation = performance.getEntriesByType('navigation')[0];
      return {
        loadTime: navigation ? navigation.loadEventEnd - navigation.loadEventStart : 0,
        domContentLoaded: navigation ? navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart : 0,
        resourceCount: performance.getEntriesByType('resource').length,
        // Add more metrics as needed
      };
    });
  }

  sanitizeFilename(url) {
    return url
      .replace(/https?:\/\//, '')
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()
      .substring(0, 100);
  }

  async crawlWebsite(startUrl) {
    console.log("Starting website crawl:", startUrl);
    
    await this.createOutputDirectory();
    const { browser, context } = await this.setupBrowser();
    
    try {
      const page = await context.newPage();
      
      // Add the starting URL
      this.foundUrls.add(startUrl);
      
      while (this.foundUrls.size > 0 && this.visitedUrls.size < this.maxPages) {
        const currentUrl = this.foundUrls.values().next().value;
        this.foundUrls.delete(currentUrl);
        
        if (!this.visitedUrls.has(currentUrl)) {
          this.visitedUrls.add(currentUrl);
          await this.analyzePage(page, currentUrl);
          await page.waitForTimeout(this.delay);
        }
      }
      
      // Generate report
      const report = await this.generateReport();
      
      await browser.close();
      
      console.log("Website crawl completed:", {
        pagesAnalyzed: this.visitedUrls.size,
        totalIssues: this.results.reduce((sum, r) => sum + (r.issues?.length || 0), 0)
      });
      
      return report;
      
    } catch (error) {
      console.error("Error during crawl:", error);
      await browser.close();
      throw error;
    }
  }

  async generateReport() {
    const reportData = {
      summary: {
        analyzedAt: new Date().toISOString(),
        totalPages: this.results.length,
        totalIssues: this.results.reduce((sum, r) => sum + (r.issues?.length || 0), 0),
      },
      pages: this.results
    };

    // Save JSON report
    const reportPath = path.join(this.sessionDir, 'analysis_report.json');
    await fs.writeFile(reportPath, JSON.stringify(reportData, null, 2));

    // Generate HTML report
    const htmlReport = this.generateHTMLReport(reportData);
    const htmlReportPath = path.join(this.sessionDir, 'analysis_report.html');
    await fs.writeFile(htmlReportPath, htmlReport);

    return {
      reportData,
      files: {
        json: reportPath,
        html: htmlReportPath,
        screenshots: path.join(this.sessionDir, 'screenshots')
      }
    };
  }

  generateHTMLReport(reportData) {
    return `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Website Analysis Report</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; }
          .container { max-width: 1200px; margin: 0 auto; }
          .page-result { border: 1px solid #ddd; margin: 20px 0; padding: 20px; }
          .screenshot { max-width: 100%; height: auto; margin: 20px 0; }
          .issues { margin: 20px 0; }
          .issue { padding: 10px; margin: 5px 0; background: #f5f5f5; }
          .high { border-left: 4px solid #dc3545; }
          .medium { border-left: 4px solid #ffc107; }
          .low { border-left: 4px solid #28a745; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Website Analysis Report</h1>
          <p><strong>Generated:</strong> ${reportData.summary.analyzedAt}</p>
          <p><strong>Pages Analyzed:</strong> ${reportData.summary.totalPages}</p>
          <p><strong>Total Issues Found:</strong> ${reportData.summary.totalIssues}</p>

          <h2>Page Analysis Results</h2>
          ${reportData.pages.map(page => `
            <div class="page-result">
              <h3>${page.pageInfo?.title || 'Untitled Page'}</h3>
              <p><strong>URL:</strong> <a href="${page.url}" target="_blank">${page.url}</a></p>
              <img src="screenshots/${this.sanitizeFilename(page.url)}.png" alt="Screenshot" class="screenshot">
              
              ${page.issues && page.issues.length > 0 ? `
                <div class="issues">
                  <h4>Issues Found (${page.issues.length})</h4>
                  ${page.issues.map(issue => `
                    <div class="issue ${issue.severity}">
                      <strong>${issue.type} - ${issue.severity.toUpperCase()}</strong><br>
                      ${issue.message}
                      ${issue.location ? `<br><em>Location: ${issue.location}</em>` : ''}
                    </div>
                  `).join('')}
                </div>
              ` : '<p>No issues detected on this page.</p>'}
            </div>
          `).join('')}
        </div>
      </body>
      </html>
    `;
  }
}
