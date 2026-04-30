require('dotenv').config();
const { Mistral } = require('@mistralai/mistralai');

async function testMistral() {
  try {
    console.log(process.env.MISTRAL_API_KEY)
    const client = new Mistral({
      apiKey: process.env.MISTRAL_API_KEY,
    });

    const response = await client.chat.complete({
      model: 'mistral-small-latest',
      messages: [
        { role: 'user', content: 'Say hello' }
      ],
    });

    console.log("✅ Mistral Connected!");
    console.log("Response:", response.choices[0].message.content);

  } catch (error) {
    console.error("❌ Mistral Error:");
    console.error(error.message);
  }
}

testMistral();