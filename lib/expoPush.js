const { Expo } = require("expo-server-sdk");

const expo = new Expo();

async function sendExpoPush(tokens, { title, body, data = {} }) {
  const validTokens = (tokens || []).filter((t) => Expo.isExpoPushToken(t));
  if (!validTokens.length) return { ok: true, sent: 0, tickets: [] };

  const messages = validTokens.map((to) => ({
    to,
    sound: "default",
    title,
    body,
    data,
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const tickets = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (e) {
      console.error("Expo push send error:", e);
    }
  }

  return { ok: true, sent: validTokens.length, tickets };
}

module.exports = { sendExpoPush };
