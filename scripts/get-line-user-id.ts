/**
 * LINE Messaging API の Webhook を一時的に受信し、
 * ボットにメッセージを送ったユーザーの userId を表示するヘルパー
 *
 * 使い方:
 *   1. npx tsx get-line-user-id.ts で起動
 *   2. ngrok 等で https の URL を取得し、LINE Official Account Manager の Webhook URL に設定
 *   3. ボットを友だち追加してから、ボットに1通メッセージを送る
 *   4. このターミナルに表示された LINE_USER_ID を .env の LINE_USER_ID に設定
 *   5. Ctrl+C で終了
 */

import http from "http";

const PORT = Number(process.env.PORT) || 3333;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(
      "LINE Webhook 受付中。ボットにメッセージを送ると userId が表示されます。\n" +
        "LINE Official Account Manager の Webhook URL に https://<あなたのドメイン> を設定してください。"
    );
    return;
  }

  if (req.method === "POST" && (req.url === "/webhook" || req.url === "/")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const data = JSON.parse(body) as { events?: Array<{ source?: { userId?: string }; type?: string }> };
        const events = data.events || [];
        for (const ev of events) {
          const userId = ev.source?.userId;
          if (userId) {
            console.log("\n========================================");
            console.log("LINE_USER_ID を .env に設定してください:");
            console.log("LINE_USER_ID=" + userId);
            console.log("========================================\n");
          }
        }
      } catch {
        // ignore parse error
      }
      res.writeHead(200);
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`Webhook 受付サーバー: http://localhost:${PORT}`);
  console.log(`Webhook URL 例: https://<ngrokのドメイン> を LINE Official Account Manager の Webhook URL に設定`);
  console.log("ボットにメッセージを送ると、このターミナルに userId が表示されます。\n");
});
