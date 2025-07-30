import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import browserAutomation from "./handler/browser/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();

// Configure CORS
app.use(
  cors({
    origin: ["http://localhost:5500", "http://127.0.0.1:5500"],
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  }),
);

// Middleware
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Example route
app.get("/", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html")),
);

// Website testing endpoint
app.post("/api/test/website", async (req, res) => {
  try {
    const { testId, url, keepBrowserOpen = true } = req.body;
    
    if (!testId || !url) {
      return res.status(400).json({
        message: "Missing required fields: testId or url",
      });
    }

    const result = await browserAutomation(testId, url, { keepBrowserOpen });

    res.status(200).json({
      success: result.success,
      message: result.message,
      testId,
      url,
      finalUrl: result.finalUrl,
      timeStamp: new Date().toISOString(),
      browserLeft: result.browserLeft,
    });
  } catch (error) {
    console.error("Error in website testing:", error);
    res.status(500).json({
      message: "Failed to perform website testing",
      error: error.message,
      timeStamp: new Date().toISOString(),
    });
  }
});
// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`),
);
