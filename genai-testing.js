const { GoogleGenerativeAI } = require("@google/generative-ai");

// Initialize the API
const genAI = new GoogleGenerativeAI();

async function testGenAI() {
    try {
        // Get the model
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        // Test prompt
        const prompt = "Tell me a short joke";
        console.log("[TEST] Sending prompt:", prompt);

        // Generate content
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();

        console.log("[TEST] Response received:");
        console.log(text);
    } catch (error) {
        console.error("[ERROR] Test failed:", error);
    }
}

// Run the test
testGenAI();