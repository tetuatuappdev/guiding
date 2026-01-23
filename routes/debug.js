import fs from "fs/promises";
import path from "path";
import express from "express";

const app = express();

app.get("/__debug/invoice-template", async (req, res) => {
  if (req.query.token !== process.env.DEBUG_TOKEN) {
    return res.status(403).send("nope");
  }

  const templatePath = path.join(process.cwd(), "templates", "invoice.html"); // adapte !
  const html = await fs.readFile(templatePath, "utf8");

  res.type("text/html").send(html);
});
