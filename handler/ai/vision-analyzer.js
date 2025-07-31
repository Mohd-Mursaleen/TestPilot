import OpenAI from 'openai';
import fs from 'fs/promises';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

export class VisionAnalyzer {
  static async analyzeScreenshot(screenshotPath, pageInfo) {
    try {
      // Read the screenshot file
      const imageBuffer = await fs.readFile(screenshotPath);
      const base64Image = imageBuffer.toString('base64');

      // Create the API request
      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Analyze this website screenshot for UI/UX issues. Focus on:
                1. Layout problems
                2. Color contrast and accessibility
                3. Visual hierarchy
                4. Mobile responsiveness indicators
                5. Navigation clarity
                6. Content readability
                7. Button and interactive element usability
                8. Consistency in design
                9. White space usage
                10. Visual clutter

                Provide specific issues found and their severity (high/medium/low).`
              },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/png;base64,${base64Image}`
                }
              }
            ]
          }
        ],
        max_tokens: 1000
      });

      // Parse the AI response into structured issues
      return VisionAnalyzer.parseAIResponse(response.choices[0].message.content);
    } catch (error) {
      console.error("Error in AI vision analysis:", error);
      return [{
        type: "error",
        severity: "high",
        message: "Failed to perform AI analysis: " + error.message,
        location: "AI Vision Analysis"
      }];
    }
  }

  static parseAIResponse(aiResponse) {
    const issues = [];
    
    // Split the response into lines and look for patterns indicating issues
    const lines = aiResponse.split('\\n');
    
    let currentType = '';
    let currentSeverity = 'medium';
    
    for (const line of lines) {
      // Look for severity indicators
      if (line.toLowerCase().includes('high severity') || line.toLowerCase().includes('critical')) {
        currentSeverity = 'high';
      } else if (line.toLowerCase().includes('low severity') || line.toLowerCase().includes('minor')) {
        currentSeverity = 'low';
      }

      // Categorize issues based on keywords
      if (line.toLowerCase().includes('contrast')) {
        currentType = 'accessibility';
      } else if (line.toLowerCase().includes('layout') || line.toLowerCase().includes('spacing')) {
        currentType = 'layout';
      } else if (line.toLowerCase().includes('responsive') || line.toLowerCase().includes('mobile')) {
        currentType = 'responsive';
      } else if (line.toLowerCase().includes('navigation') || line.toLowerCase().includes('menu')) {
        currentType = 'navigation';
      } else if (line.toLowerCase().includes('readability') || line.toLowerCase().includes('typography')) {
        currentType = 'typography';
      }

      // If we have a meaningful line that seems to describe an issue
      if (line.length > 20 && (line.includes(':') || line.includes('-'))) {
        issues.push({
          type: currentType || 'general',
          severity: currentSeverity,
          message: line.replace(/^[:-]\s*/, '').trim(),
          location: 'Detected in screenshot analysis'
        });
      }
    }

    return issues;
  }
}
