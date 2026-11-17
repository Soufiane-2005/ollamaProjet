const messagesEl = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const stopBtn = document.getElementById("stop");
const newBtn = document.getElementById("new");
const modelSel = document.getElementById("model");
const thinkLabel = document.getElementById("thinkLabel");
const thinkBox = document.getElementById("think");

let history = [];
let controller = null;
let busy = false;
let capabilities = {}; // { modelName: ["completion", "thinking", ...] }

// ---------- Models ----------
async function loadModels() {
  try {
    const r = await fetch("/api/models");
    const models = await r.json();
    if (!r.ok) throw new Error(models.error || "Cannot load models");
    modelSel.innerHTML = "";
    for (const m of models) {
      capabilities[m.name] = m.capabilities;
      const opt = document.createElement("option");
      opt.value = opt.textContent = m.name;
      modelSel.appendChild(opt);
    }
    updateThinkToggle();
  } catch (err) {
    addBubble("error", err.message);
  }
}

function supportsThinking() {
  return (capabilities[modelSel.value] || []).includes("thinking");
}

function updateThinkToggle() {
  thinkLabel.hidden = !supportsThinking();
}

modelSel.addEventListener("change", updateThinkToggle);

// ---------- UI helpers ----------
function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text; // textContent, never innerHTML
  messagesEl.appendChild(div);
  scrollDown();
  return div;
}

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Assistant bubble = collapsible reasoning block + answer + stats line
function createAssistantBubble() {
  const bubble = document.createElement("div");
  bubble.className = "msg assistant";

  const details = document.createElement("details");
  details.className = "thinking";
  details.hidden = true;
  const summary = document.createElement("summary");
  summary.textContent = "Reasoning";
  const thinkingEl = document.createElement("div");
  details.append(summary, thinkingEl);

  const answerEl = document.createElement("div");
  const statsEl = document.createElement("div");
  statsEl.className = "stats";

  bubble.append(details, answerEl, statsEl);
  messagesEl.appendChild(bubble);
  scrollDown();
  return { bubble, details, thinkingEl, answerEl, statsEl };
}

function setBusy(value) {
  busy = value;
  input.disabled = value;
  modelSel.disabled = value;
  thinkBox.disabled = value;
  sendBtn.disabled = value;
  stopBtn.disabled = !value;
  if (!value) input.focus();
}

// ---------- NDJSON reader ----------
async function* readNdjson(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop(); // last piece may be incomplete: keep it for next read

    for (const line of lines) {
      if (line.trim()) yield JSON.parse(line);
    }
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}

// ---------- Send ----------
async function send() {
  const text = input.value.trim();
  if (!text || busy) return;
  input.value = "";

  history.push({ role: "user", content: text });
  addBubble("user", text);

  const ui = createAssistantBubble();
  let answer = "";
  let thinking = "";
  let failed = false;

  controller = new AbortController();
  setBusy(true);

  try {
    const body = { messages: history, model: modelSel.value };
    if (supportsThinking()) body.think = thinkBox.checked;

    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      throw new Error(data.error || "Request failed");
    }

    for await (const chunk of readNdjson(r)) {
      if (chunk.error) throw new Error(chunk.error);

      if (chunk.message?.thinking) {
        thinking += chunk.message.thinking;
        ui.details.hidden = false;
        ui.thinkingEl.textContent = thinking;
      }
      if (chunk.message?.content) {
        answer += chunk.message.content;
        ui.answerEl.textContent = answer;
      }
      if (chunk.done && chunk.eval_count && chunk.eval_duration) {
        const tps = chunk.eval_count / (chunk.eval_duration / 1e9);
        ui.statsEl.textContent = `${tps.toFixed(1)} tokens/s`;
      }
      scrollDown();
    }
  } catch (err) {
    if (err.name !== "AbortError") {
      // real failure
      failed = true;
      ui.bubble.className = "msg error";
      ui.details.hidden = true;
      ui.answerEl.textContent = err.message;
    }
    // AbortError = the user clicked Stop: not a failure
  } finally {
    if (failed) {
      history.pop(); // remove the unanswered user message
    } else if (answer) {
      history.push({ role: "assistant", content: answer }); // keeps partial answer too
    } else {
      history.pop(); // stopped before any answer: drop the orphan user message
      ui.answerEl.textContent = "(stopped)";
    }
    controller = null;
    setBusy(false);
  }
}

// ---------- Events ----------
sendBtn.addEventListener("click", send);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
stopBtn.addEventListener("click", () => controller?.abort());
newBtn.addEventListener("click", () => {
  if (busy) controller?.abort();
  history = [];
  messagesEl.innerHTML = "";
});

loadModels();