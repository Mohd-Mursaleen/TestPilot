import { webkit, chromium } from "playwright";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from 'url';
import { VisionAnalyzer } from '../ai/vision-analyzer.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { WebsiteCrawler } from './crawler.js';

// Main execution function
export async function analyzeWebsite(url, options = {}) {
  const crawler = new WebsiteCrawler({
    maxPages: options.maxPages || 5,
    delay: options.delay || 2000,
    outputDir: options.outputDir || './analysis_output',
    visionAnalyzer: VisionAnalyzer // Pass the AI analyzer
  });

  try {
    const report = await crawler.crawlWebsite(url);
    return report;
  } catch (error) {
    console.error("Failed to analyze website", { error: error.message });
    throw error;
  }
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2];
  if (!url) {
    console.log("Usage: node website-analyzer.js <website-url>");
    process.exit(1);
  }

  analyzeWebsite(url, {
    maxPages: 10,
    delay: 2000
  }).then(report => {
    console.log("Analysis complete!");
    console.log("Report files:", report.files);
  }).catch(error => {
    console.error("Analysis failed:", error.message);
    process.exit(1);
  });
}
