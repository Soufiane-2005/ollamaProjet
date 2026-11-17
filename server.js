import express from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const app = express();
const PORT = process.env.PORT || 3000;
const OLLAMA = "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.MODEL || "gemma4:e4b";

app.use(express.json());
app.use(express.static("public"));

app.post("/api/chat", async (req, res) => {
  const { messages, model, stream = true, think } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages is required" });
  }

  // Cancellation: abort the Ollama request when the browser goes away
  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const body = { model: model || DEFAULT_MODEL, messages, stream: stream !== false };
  if (think !== undefined) body.think = think; // pass through unchanged

  try {
    const r = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: data.error || "Ollama error" });
    }

    if (body.stream) {
      res.setHeader("Content-Type", "application/x-ndjson");
      await pipeline(Readable.fromWeb(r.body), res);
    } else {
      res.json(await r.json());
    }
  } catch (err) {
    if (controller.signal.aborted) return;          // client left: not an error
    if (res.headersSent) return res.end();          // too late for a JSON error
    res.status(502).json({ error: "Cannot reach Ollama" });
  }
});

app.get("/api/models", async (req, res) => {
  try {
    const r = await fetch(`${OLLAMA}/api/tags`);
    const { models } = await r.json();

    const result = await Promise.all(
      models.map(async (m) => {
        const s = await fetch(`${OLLAMA}/api/show`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: m.name }),
        });
        const info = await s.json();
        return { name: m.name, capabilities: info.capabilities || [] };
      })
    );
    res.json(result);
  } catch {
    res.status(502).json({ error: "Cannot reach Ollama" });
  }
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));