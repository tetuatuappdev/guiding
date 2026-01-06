import { Expo, ExpoPushMessage } from "expo-server-sdk";

const expo = new Expo();

export async function sendExpoPush(
  tokens: string[],
  payload: { title: string; body: string; data?: Record<string, any> }
) {
  const validTokens = tokens.filter((t) => Expo.isExpoPushToken(t));
  if (!validTokens.length) return { ok: true, sent: 0, tickets: [] as any[] };

  const messages: ExpoPushMessage[] = validTokens.map((to) => ({
    to,
    sound: "default",
    title: payload.title,
    body: payload.body,
    data: payload.data ?? {},
  }));

  const chunks = expo.chunkPushNotifications(messages);
  const tickets: any[] = [];

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
