const express = require("express");
const bodyParser = require("body-parser");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const Redis = require('ioredis');

const app = express();
app.use(bodyParser.json());

// Redis client setup with ioredis
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
  maxRetriesPerRequest: 3
});


redis.on('error', (err) => console.error('Redis Client Error', err));
redis.on('connect', () => console.log('Connected to Redis'));

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const SESSION_TTL = 30; // 30 seconds
const MEMORY_CACHE = new Map(); // In-memory cache
const MEMORY_CACHE_TTL = 5000; // 5 seconds

app.post("/", async (req, res) => {
  try {
    const sessionId = req.body.deviceId || 'default';
    const now = Date.now();
    
    // Try memory cache first
    let session = MEMORY_CACHE.get(sessionId);
    if (session && (now - session.timestamp) < MEMORY_CACHE_TTL) {
      session = session.data;
    } else {
      // Fallback to Redis
      session = await redis.get(`session:${sessionId}`);
      session = session ? JSON.parse(session) : {
        textBuffer: [],
        isWaitingForCompletion: false
      };
      
      // Update memory cache
      MEMORY_CACHE.set(sessionId, {
        timestamp: now,
        data: session
      });
    }

    const data = req.body;
    const segments = data.segments || [];

    for (const segment of segments) {
      const text = segment.text?.toLowerCase().trim();
      if (!text) continue;

      console.log(`[INFO] Processing text: "${text}" for session ${sessionId}`);
      session.textBuffer.push(text);
    }

    const fullText = session.textBuffer.join(' ');
    const cleanText = fullText.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "");

    console.log(`[INFO] Full text: "${fullText}"`);
    console.log(`[INFO] Session state:`, session);

    if (session.isWaitingForCompletion || cleanText.includes("zoom") || cleanText.includes("hey zoom")) {
      if (cleanText.includes("zoom") || cleanText.includes("hey zoom")) {
        session.isWaitingForCompletion = true;
        // Save session state
        await redis.setex(
          `session:${sessionId}`, 
          SESSION_TTL, 
          JSON.stringify(session)
        );
        
        // Update memory cache
        MEMORY_CACHE.set(sessionId, {
          timestamp: now,
          data: session
        });
        
        // If it's just the trigger word, wait for more
        if (cleanText.endsWith("zoom")) {
          return res.json({ status: "waiting for question" });
        }
      }

      let questionPart = cleanText
        .replace(/hey\s*zoom/g, '')
        .replace(/zoom/g, '')
        .trim();

      if (!questionPart) {
        // Save session state
        await redis.setex(
          `session:${sessionId}`, 
          SESSION_TTL, 
          JSON.stringify(session)
        );
        
        // Update memory cache
        MEMORY_CACHE.set(sessionId, {
          timestamp: now,
          data: session
        });
        
        return res.json({ status: "waiting for question" });
      }

      console.log("[DEBUG] Question:", questionPart);

      const result = await model.generateContent([
        { text: `You are Omi, an AI assistant. Respond to this: ${questionPart}` }
      ]);

      const answer = await result.response.text();
      console.log("[INFO] Omi's response:", answer);

      // Clear session
      await redis.del(`session:${sessionId}`);
      MEMORY_CACHE.delete(sessionId);
      
      return res.json({ message: answer });
    }

    // Save session state if waiting for trigger
    if (session.isWaitingForCompletion) {
      await redis.setex(
        `session:${sessionId}`, 
        SESSION_TTL, 
        JSON.stringify(session)
      );
      
      // Update memory cache
      MEMORY_CACHE.set(sessionId, {
        timestamp: now,
        data: session
      });
    }
    
    return res.json({ status: "waiting for trigger" });

  } catch (error) {
    console.error("[ERROR] Failed to process request:", error);
    return res.status(500).json({ message: "Failed to process request" });
  }
});

// Clean memory cache periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of MEMORY_CACHE.entries()) {
    if (now - value.timestamp > MEMORY_CACHE_TTL) {
      MEMORY_CACHE.delete(key);
    }
  }
}, 5000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[INFO] Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await redis.quit();
  process.exit(0);
});
