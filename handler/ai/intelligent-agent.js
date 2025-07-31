import { chromium } from 'playwright';
import OpenAI from 'openai';
import fs from 'fs/promises';
import path from 'path';
import * as cheerio from 'cheerio';

export class IntelligentTestingAgent {
  constructor(options = {}) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
    
    this.browser = null;
    this.page = null;
    this.context = null;
    this.currentUrl = '';
    this.testResults = [];
    
    // Agent's memory and context
    this.memory = {
      visitedPages: new Set(),
      discoveredElements: [],
      testHistory: [],
      currentStrategy: null
    };
  }

  async initialize() {
    console.log("🤖 Initializing HTML-Based Testing Agent...");
    
    this.browser = await chromium.launch({ 
      headless: false,
      slowMo: 1000
    });
    
    this.context = await this.browser.newContext({
      viewport: { width: 1920, height: 1080 }
    });
    
    this.page = await this.context.newPage();
    
    this.page.on('response', response => {
      console.log(`📡 Agent observed: ${response.status()} ${response.url()}`);
    });
    
    console.log("✅ Agent initialized and ready!");
  }

  // Extract and clean HTML for LLM analysis
  async getCleanedHTML() {
    console.log("🧹 Extracting and cleaning HTML...");
    
    // Wait for dynamic content to load
    await this.page.waitForTimeout(3000);
    await this.page.waitForLoadState('networkidle');
    
    const htmlContent = await this.page.content();
    console.log(`📄 Raw HTML length: ${htmlContent.length}`);
    
    const $ = cheerio.load(htmlContent);
    
    // Remove only truly unnecessary elements
    $('script, style, noscript, meta[name], link[rel="stylesheet"]').remove();
    
    // Don't remove structural elements - keep everything initially
    // Just clean attributes on interactive elements
    $('input, select, textarea, button, form, a, label').each((i, el) => {
      const attrs = $(el).attr();
      const keepAttrs = [
        "id", "class", "type", "name", "value", "placeholder", 
        "role", "aria-label", "href", "for", "action", "method", 
        "data-qa", "data-testid", "title", "onclick"
      ];

      if (!attrs) return;

      Object.keys(attrs).forEach((attr) => {
        if (!keepAttrs.includes(attr)) {
          $(el).removeAttr(attr);
        }
      });
    });

    const cleanedHtml = $.html();
    console.log(`🧼 Cleaned HTML length: ${cleanedHtml.length}`);
    
    // Extract interactive elements more comprehensively
    const interactiveElements = [];
    
    // Get all potentially interactive elements
    const selectors = [
      'input', 'select', 'textarea', 'button', 'a[href]',
      '[onclick]', '[role="button"]', '[role="link"]', 
      '.btn', '.button', '.link', '[data-testid]'
    ];
    
    selectors.forEach(selector => {
      $(selector).each((index, el) => {
        const $el = $(el);
        const text = $el.text().trim();
        const element = {
          index: interactiveElements.length,
          tag: el.tagName.toLowerCase(),
          selector: selector,
          text: text || $el.attr('value') || $el.attr('placeholder') || $el.attr('aria-label') || $el.attr('title') || '',
          id: $el.attr('id') || null,
          class: $el.attr('class') || null,
          type: $el.attr('type') || null,
          name: $el.attr('name') || null,
          href: $el.attr('href') || null,
          placeholder: $el.attr('placeholder') || null,
          value: $el.attr('value') || null,
          onclick: $el.attr('onclick') || null,
          role: $el.attr('role') || null
        };
        
        // Include all elements, even if they seem empty (they might have CSS content)
        interactiveElements.push(element);
      });
    });
    
    // Remove duplicates based on element position
    const uniqueElements = interactiveElements.filter((element, index, self) => 
      index === self.findIndex(e => e.text === element.text && e.href === element.href && e.id === element.id)
    );

    console.log(`🔗 Found ${uniqueElements.length} interactive elements`);
    uniqueElements.slice(0, 5).forEach(el => {
      console.log(`  - ${el.tag}: "${el.text}" ${el.href ? `(${el.href})` : ''}`);
    });

    return {
      fullHTML: cleanedHtml,
      interactiveElements: uniqueElements,
      pageTitle: await this.page.title(),
      pageUrl: await this.page.url()
    };
  }

  // LLM analyzes HTML and decides what to do
  async think(prompt, htmlData, context = {}) {
    const systemPrompt = `
    You are an intelligent web testing agent that analyzes HTML structure to navigate websites.
    
    You will receive cleaned HTML content and a list of interactive elements.
    Your job is to decide what to test next based on the actual HTML structure.
    
    CAPABILITIES:
    - Click elements by their text content, href, or element properties
    - Fill forms with appropriate test data
    - Navigate to URLs
    - Analyze page content and structure
    
    STRATEGY:
    - Focus on user flows and common interactions
    - Test navigation, forms, buttons, and links
    - Look for signup, login, contact, checkout flows
    - Verify error handling and validation
    
    Always respond with valid JSON:
    {
      "reasoning": "Your analysis of the page and why you chose this action",
      "action": "click_element|fill_form|navigate|analyze|complete",
      "target_text": "exact text content of element to interact with",
      "target_href": "href if clicking a link",
      "target_element": "element details like id, class, or type",
      "fill_data": {"field_name": "value"} // if filling forms,
      "next_steps": ["what you plan to do after this"],
      "confidence": "high|medium|low" // how confident you are about this action
    }
    
    Current page: ${htmlData.pageTitle} (${htmlData.pageUrl})
    
    Interactive elements available:
    ${JSON.stringify(htmlData.interactiveElements, null, 2)}
    
    Previous actions: ${JSON.stringify(context.previousActions || [], null, 2)}
    `;

    try {
      const response = await this.openai.chat.completions.create({
        model: "gpt-4o-2024-08-06",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt }
        ],
        temperature: 0.1
      });

      const decision = JSON.parse(this.cleanOpenAIResponse(response.choices[0].message.content));
      console.log(`🧠 Agent reasoning: ${decision.reasoning}`);
      console.log(`🎯 Agent decision: ${decision.action} - ${decision.target_text || decision.target_href || 'N/A'}`);
      
      return decision;
    } catch (error) {
      console.error("❌ Agent thinking error:", error);
      return { 
        action: "analyze", 
        reasoning: "I encountered an error and need to re-analyze the page",
        confidence: "low"
      };
    }
  }

  // Execute actions based on LLM decisions
  async act(decision, htmlData) {
    console.log(`🎬 Agent executing: ${decision.action}`);
    
    try {
      switch (decision.action) {
        case 'navigate':
          await this.navigate(decision.target_href || decision.target_text);
          break;
          
        case 'click_element':
          await this.clickElementByDecision(decision, htmlData);
          break;
          
        case 'fill_form':
          await this.fillFormByDecision(decision);
          break;
          
        case 'analyze':
          return await this.analyzeCurrentPage();
          
        case 'complete':
          console.log("✅ Agent completed testing");
          return 'complete';
          
        default:
          console.log(`🤷 Unknown action: ${decision.action}`);
      }
      
      // Record successful action
      this.memory.testHistory.push({
        timestamp: new Date().toISOString(),
        action: decision.action,
        target: decision.target_text || decision.target_href || decision.target_element,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        success: true
      });
      
      // Wait for page to respond
      await this.page.waitForTimeout(2000);
      
    } catch (error) {
      console.error(`❌ Action failed: ${decision.action}`, error.message);
      
      // Record failed action
      this.memory.testHistory.push({
        timestamp: new Date().toISOString(),
        action: decision.action,
        target: decision.target_text || decision.target_href || decision.target_element,
        reasoning: decision.reasoning,
        confidence: decision.confidence,
        success: false,
        error: error.message
      });
      
      return 'error';
    }
  }

  // Smart element clicking based on LLM decision
  async clickElementByDecision(decision, htmlData) {
    const strategies = [];
    
    // Strategy 1: Click by exact text content
    if (decision.target_text) {
      strategies.push(() => this.page.click(`text="${decision.target_text}"`));
      strategies.push(() => this.page.click(`text*="${decision.target_text}"`)); // Partial match
    }
    
    // Strategy 2: Click by href
    if (decision.target_href) {
      strategies.push(() => this.page.click(`a[href="${decision.target_href}"]`));
      // Try relative href
      try {
        const url = new URL(decision.target_href);
        strategies.push(() => this.page.click(`a[href="${url.pathname}"]`));
      } catch (e) {
        // Invalid URL, skip
      }
    }
    
    // Strategy 3: Click by element properties
    if (decision.target_element) {
      const element = htmlData.interactiveElements.find(el => 
        el.text === decision.target_text || 
        el.href === decision.target_href ||
        (decision.target_element.id && el.id === decision.target_element.id)
      );
      
      if (element) {
        if (element.id) {
          strategies.push(() => this.page.click(`#${element.id}`));
        }
        if (element.name) {
          strategies.push(() => this.page.click(`[name="${element.name}"]`));
        }
        if (element.type) {
          strategies.push(() => this.page.click(`${element.tag}[type="${element.type}"]`));
        }
      }
    }
    
    // Try each strategy
    for (const strategy of strategies) {
      try {
        console.log(`🔧 Trying click strategy...`);
        await strategy();
        console.log(`✅ Successfully clicked element`);
        return;
      } catch (error) {
        console.log(`❌ Strategy failed: ${error.message}`);
        continue;
      }
    }
    
    // Final fallback - direct navigation if it's a link
    if (decision.target_href) {
      console.log(`🔄 Fallback: Direct navigation to ${decision.target_href}`);
      await this.navigate(decision.target_href);
      return;
    }
    
    throw new Error(`Could not click element: ${decision.target_text || decision.target_href}`);
  }

  // Fill forms based on LLM decision
  async fillFormByDecision(decision) {
    if (!decision.fill_data) {
      throw new Error("No form data provided");
    }
    
    console.log(`📝 Filling form with data:`, decision.fill_data);
    
    for (const [fieldName, value] of Object.entries(decision.fill_data)) {
      try {
        // Try multiple selector strategies
        const selectors = [
          `[name="${fieldName}"]`,
          `#${fieldName}`,
          `input[placeholder*="${fieldName}"]`,
          `input[aria-label*="${fieldName}"]`
        ];
        
        let filled = false;
        for (const selector of selectors) {
          try {
            await this.page.fill(selector, value);
            console.log(`✅ Filled ${fieldName} with: ${value}`);
            filled = true;
            break;
          } catch (e) {
            continue;
          }
        }
        
        if (!filled) {
          console.log(`⚠️  Could not fill field: ${fieldName}`);
        }
        
      } catch (error) {
        console.log(`❌ Error filling ${fieldName}: ${error.message}`);
      }
    }
  }

  async navigate(url) {
    console.log(`🧭 Navigating to: ${url}`);
    await this.page.goto(url, { waitUntil: 'networkidle' });
    this.currentUrl = url;
    this.memory.visitedPages.add(url);
  }

  async analyzeCurrentPage() {
    console.log("🔍 Agent analyzing current page structure...");
    return await this.getCleanedHTML();
  }

  async takeScreenshot() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot-${timestamp}.png`;
    const filepath = path.join('./screenshots', filename);
    
    await fs.mkdir('./screenshots', { recursive: true });
    await this.page.screenshot({ path: filepath, fullPage: true });
    
    console.log(`📸 Screenshot saved: ${filename}`);
    return filepath;
  }

  // Main testing method
  async testWebsite(startUrl, goal = "comprehensive testing") {
    console.log(`🚀 Agent starting HTML-based test: ${goal}`);
    console.log(`🎯 Target: ${startUrl}`);
    
    try {
      // Navigate to starting URL
      await this.navigate(startUrl);
      
      let steps = 0;
      const maxSteps = 15; // Allow more steps for thorough testing
      
      while (steps < maxSteps) {
        steps++;
        console.log(`\n--- Step ${steps} ---`);
        
        // Get current page HTML structure
        const htmlData = await this.getCleanedHTML();
        
        console.log(`📄 Page: ${htmlData.pageTitle}`);
        console.log(`🔗 Interactive elements found: ${htmlData.interactiveElements.length}`);
        
        // Agent analyzes HTML and decides next action
        const decision = await this.think(`
          Current page: ${htmlData.pageTitle} (${htmlData.pageUrl})
          
          Goal: ${goal}
          
          I can see ${htmlData.interactiveElements.length} interactive elements on this page.
          Elements include: ${htmlData.interactiveElements.map(el => `${el.tag}("${el.text}")`).slice(0, 5).join(', ')}
          
          Based on the HTML structure and my goal, what should I do next?
          
          Previous actions: ${this.memory.testHistory.slice(-3).map(h => `${h.action}(${h.target})`).join(' -> ')}
          
          If I've thoroughly tested the main user flows, respond with action: "complete"
        `, htmlData, {
          previousActions: this.memory.testHistory.slice(-5)
        });

        // Execute the decision
        const result = await this.act(decision, htmlData);
        
        if (result === 'complete') {
          console.log("✅ Agent completed testing");
          break;
        }
        
        // Brief pause between actions
        await this.page.waitForTimeout(1500);
      }
      
      if (steps >= maxSteps) {
        console.log("⏰ Agent reached maximum steps, completing test");
      }
      
      return await this.generateReport();
      
    } catch (error) {
      console.error("❌ Testing failed:", error);
      await this.takeScreenshot(); // Take screenshot on error
      throw error;
    }
  }

  async generateReport() {
    console.log("📊 Generating comprehensive test report...");
    
    const successfulActions = this.memory.testHistory.filter(h => h.success);
    const failedActions = this.memory.testHistory.filter(h => !h.success);
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        pagesVisited: this.memory.visitedPages.size,
        totalActions: this.memory.testHistory.length,
        successfulActions: successfulActions.length,
        failedActions: failedActions.length,
        successRate: `${Math.round((successfulActions.length / this.memory.testHistory.length) * 100)}%`,
        issuesFound: this.testResults.length
      },
      visitedPages: Array.from(this.memory.visitedPages),
      testHistory: this.memory.testHistory,
      failedActions: failedActions,
      findings: this.testResults,
      recommendations: await this.getRecommendations()
    };

    const reportPath = `./test-report-${Date.now()}.json`;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
    
    console.log(`📄 Report saved: ${reportPath}`);
    console.log(`📈 Success rate: ${report.summary.successRate}`);
    
    return report;
  }

  async getRecommendations() {
    const failedActions = this.memory.testHistory.filter(h => !h.success);
    
    if (failedActions.length === 0) {
      return "All tests passed successfully. The website appears to be functioning well.";
    }
    
    const recommendations = await this.think(`
      I completed testing and encountered ${failedActions.length} failures out of ${this.memory.testHistory.length} total actions.
      
      Failed actions: ${JSON.stringify(failedActions, null, 2)}
      
      Successful actions: ${this.memory.testHistory.filter(h => h.success).length}
      
      Based on this analysis, what are the key issues with this website?
      What should developers prioritize fixing?
      What areas need more manual testing?
      
      Provide specific, actionable recommendations.
    `, { interactiveElements: [] }, {
      previousActions: this.memory.testHistory
    });

    return recommendations.reasoning;
  }
  cleanOpenAIResponse(responseText) {
  if (!responseText || typeof responseText !== 'string') return responseText;

  // Remove code block markers like ```json or ```
  return responseText
    .replace(/^```(?:json)?\s*/i, '')  // remove starting ```json or ```
    .replace(/\s*```$/, '')           // remove ending ```
    .trim();
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log("🧹 Agent cleanup completed");
    }
  }
}
