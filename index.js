const express = require("express");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();

app.use(bodyParser.json());


const genAI = new GoogleGenerativeAI("AIzaSyDzmPffYdq4w9H4ZoT1zMRCagepCMCIYvg"); 
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); 

const messageBuffer = new Map();
const NOTIFICATION_COOLDOWN = 2000; 

app.post("/webhook", async (req, res) => {
  const data = req.body;
  const sessionId = data.session_id || "default-session";
  const uid = req.query.uid || "unknown";

  console.log("------------------------");
  console.log("[MESSAGE] New webhook request received");
  console.log("[MESSAGE] Session ID:", sessionId);
  console.log("[MESSAGE] UID:", uid);
  console.log("[MESSAGE] Segments:", JSON.stringify(data.segments, null, 2));
  console.log("------------------------");

  if (!messageBuffer.has(sessionId)) {
    messageBuffer.set(sessionId, {
      triggerDetected: false,
      lastNotificationTime: 0,
      collectedQuestion: [],
    });
  }

  const session = messageBuffer.get(sessionId);
  const currentTime = Date.now();
  const segments = data.segments || [];
  let processedResponse = false;

  if (
    session.triggerDetected &&
    currentTime - session.lastNotificationTime < NOTIFICATION_COOLDOWN
  ) {
    console.log("[INFO] Notification cooldown active");
    return res.json({ status: "success", message: "Cooldown active" });
  }

  for (const segment of segments) {
    const text = segment.text?.toLowerCase().trim();

    if (!text) continue;

    console.log(`[INFO] Processing text segment: ${text}`);

    // Check for the trigger phrase
    if (text.includes("hey zoom") || text.includes("hey Zoom")) {
      console.log(`[INFO] Trigger phrase detected in session ${sessionId}`);
      session.triggerDetected = true;
      session.lastNotificationTime = currentTime;
      session.collectedQuestion = [];
      processedResponse = true;

      const questionPart = text.split("hey zoom") || text.split("hey Zoom")[1]?.trim();
      if (questionPart) {
        session.collectedQuestion.push(questionPart);
      }

      break;
    }

    // If a trigger was already detected, collect more question parts
    if (session.triggerDetected) {
      session.collectedQuestion.push(text);
    }
  }

  // If the session has collected enough data, process the question
  if (session.triggerDetected && !processedResponse) {
    const fullQuestion = session.collectedQuestion.join(" ").trim();

    if (fullQuestion) {
      console.log(`[INFO] Full question collected: ${fullQuestion}`);

      try {
        const result = await model.generateContent({
          prompt: `You are Omi, an AI assistant. Respond to this question: ${fullQuestion}`,
        });

        const answer = result.response?.text || "No response available.";
        console.log(`[INFO] Gemini response: ${answer}`);

        // Send the response back
        session.triggerDetected = false;
        session.collectedQuestion = [];
        return res.json({ message: answer });
      } catch (error) {
        console.error(`[ERROR] Gemini processing failed: ${error.message}`);
        return res
          .status(500)
          .json({ message: "Failed to process your request." });
      }
    }
  }

  return res.json({ status: "success" });
});

app.get("/status", (req, res) => {
  res.json({
    activeSessions: messageBuffer.size,
    message: "Server is running",
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[INFO] Server running on port ${PORT}`);
});
