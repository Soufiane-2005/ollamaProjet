const messagesEl = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
const newBtn = document.getElementById("new");

let history = [];

function addBubble(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text; // textContent, not innerHTML
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return div;
}

async function send() {
  const text = input.value.trim();
  if (!text) return;
  input.value = "";

  history.push({ role: "user", content: text });
  addBubble("user", text);

  input.disabled = sendBtn.disabled = true;
  const bubble = addBubble("assistant", "...");

  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Request failed");

    const answer = data.message.content;
    bubble.textContent = answer;
    history.push({ role: "assistant", content: answer });
  } catch (err) {
    bubble.textContent = err.message;
    bubble.className = "msg error";
    history.pop(); // remove the unanswered user message
  } finally {
    input.disabled = sendBtn.disabled = false;
    input.focus();
  }
}

sendBtn.addEventListener("click", send);
input.addEventListener("keydown", (e) => { if (e.key === "Enter") send(); });
newBtn.addEventListener("click", () => {
  history = [];
  messagesEl.innerHTML = "";
});