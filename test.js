import browserAutomation from "./handler/browser/index.js";

// Run the test
async function runTest() {
  const testWebsiteUrl = "https://example.com";
  const testId = "test-website-123";

  try {
    console.log("\n🚀 Starting website testing automation");
    const result = await browserAutomation(testId, testWebsiteUrl, {
      keepBrowserOpen: true
    });
    console.log("\n✅ Test completed successfully");
    console.log("Result:", result);
  } catch (error) {
    console.error("\n❌ Test failed:", error);
  }
}

// Run test
runTest();