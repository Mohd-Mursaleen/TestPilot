#!/usr/bin/env node

import { analyzeWebsite } from './handler/browser/website-analyzer.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { IntelligentTestingAgent } from './handler/ai/intelligent-agent.js';
// const __dirname = path.dirname(fileURLToPath(import.meta.url));

// const url = process.argv[2];
// const outputDir = process.argv[3] || path.join(__dirname, 'analysis_output');
// const maxPages = parseInt(process.argv[4]) || 5;

// if (!url) {
//   console.log(`
// Usage: analyze-website <url> [outputDir] [maxPages]
//   url       - The website URL to analyze
//   outputDir - (Optional) Directory to save analysis results
//   maxPages  - (Optional) Maximum number of pages to analyze (default: 5)
  
// Example: analyze-website https://example.com ./reports 10
// `);
//   process.exit(1);
// }

console.log(`
Starting website analysis:

`);

// analyzeWebsite(url, {
//   outputDir,
//   maxPages,
//   delay: 2000
// }).then(report => {
//   console.log("\n✅ Analysis complete!");
//   console.log("Report files:", report.files);
// }).catch(error => {
//   console.error("\n❌ Analysis failed:", error.message);
//   process.exit(1);
// });
const agent = new IntelligentTestingAgent();
await agent.initialize();
await agent.testWebsite('https://geekymd.vercel.app', 'test this  website visit all the website main sections and subsections dont test forms just go through the website and check for errors and ui , for each page you vist press all the buttons there and check its functionality and report any errors or issues you find',);
