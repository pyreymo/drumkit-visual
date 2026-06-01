const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");

const lastPart = document.getElementById("lastPart");
const lastZone = document.getElementById("lastZone");

const velocityText = document.getElementById("velocityText");
const noteText = document.getElementById("noteText");
const rawText = document.getElementById("rawText");
const velocityBar = document.getElementById("velocityBar");

const hihatText = document.getElementById("hihatText");
const hihatBar = document.getElementById("hihatBar");

const eventLog = document.getElementById("eventLog");

let ws = null;
let reconnectTimer = null;

const partDisplayName = {
  kick: "KICK",
  snare: "SNARE",
  tom1: "TOM 1",
  tom2: "TOM 2",
  tom3: "FLOOR TOM",
  hihat: "HI-HAT",
  crash1: "CRASH 1",
  crash2: "CRASH 2",
  ride: "RIDE",
  aux: "AUX",
  unknown: "UNKNOWN",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(ts) {
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function setConnectionUi(connected, text) {
  statusText.textContent = text;
  statusText.className = connected ? "status online" : "status offline";
  statusDot.className = connected ? "status-dot online" : "status-dot offline";
}

function addLogLine(text) {
  const line = document.createElement("div");
  line.className = "log-line";
  line.textContent = text;

  eventLog.prepend(line);

  while (eventLog.children.length > 8) {
    eventLog.removeChild(eventLog.lastChild);
  }
}

function triggerPad(part, velocity, zone) {
  const pad = document.querySelector(`.pad[data-part="${part}"]`);
  const label = document.getElementById(`pad-${part}`);

  if (!pad) return;

  const strength = clamp(velocity / 127, 0.1, 1);
  pad.style.setProperty("--hit-scale", String(1 + strength * 0.18));
  pad.style.setProperty("--hit-alpha", String(0.35 + strength * 0.65));

  pad.classList.remove("hit");
  void pad.offsetWidth;
  pad.classList.add("hit");

  if (label) {
    label.textContent = zone || "hit";
  }

  window.setTimeout(() => {
    pad.classList.remove("hit");
    if (label) label.textContent = "idle";
  }, 260);
}

function pulseHero() {
  const hero = document.querySelector(".hero");
  hero.classList.remove("pulse");
  void hero.offsetWidth;
  hero.classList.add("pulse");

  window.setTimeout(() => {
    hero.classList.remove("pulse");
  }, 220);
}

function handleConnection(data) {
  if (data.error) {
    setConnectionUi(false, "MIDI 异常");
    return;
  }

  if (data.connected) {
    setConnectionUi(true, "ONLINE");
  } else {
    setConnectionUi(false, "OFFLINE");
  }
}

function handleHit(data) {
  const part = data.part || "unknown";
  const zone = data.zone || "unknown";
  const velocity = data.velocity ?? 0;
  const note = data.note ?? "-";

  const displayPart = partDisplayName[part] || part.toUpperCase();
  const width = clamp((velocity / 127) * 100, 0, 100);

  lastPart.textContent = displayPart;
  lastZone.textContent = `${zone.toUpperCase()} · ${data.label || ""}`;

  velocityText.textContent = velocity;
  noteText.textContent = note;
  rawText.textContent = `raw ${data.raw || "-"}`;
  velocityBar.style.width = `${width}%`;

  triggerPad(part, velocity, zone);
  pulseHero();

  addLogLine(
    `${formatTime(data.timestamp)}  ${displayPart}  ${zone}  vel=${velocity}  note=${note}`,
  );
}

function handleHihatPedal(data) {
  const value = data.value ?? 0;
  const width = clamp((value / 127) * 100, 0, 100);

  hihatText.textContent = `${data.openness} · ${value}`;
  hihatBar.style.width = `${width}%`;

  addLogLine(
    `${formatTime(data.timestamp)}  HI-HAT PEDAL  ${data.openness}  value=${value}`,
  );
}

function handleChoke(data) {
  const part = data.part || "unknown";
  const displayPart = partDisplayName[part] || part.toUpperCase();

  lastPart.textContent = displayPart;
  lastZone.textContent = data.pressed ? "CHOKE PRESSED" : "CHOKE RELEASED";

  velocityText.textContent = data.value ?? "-";
  noteText.textContent = data.note ?? "-";
  rawText.textContent = `raw ${data.raw || "-"}`;

  triggerPad(part, data.pressed ? 127 : 40, "choke");
  pulseHero();

  addLogLine(
    `${formatTime(data.timestamp)}  ${displayPart}  choke=${data.pressed}`,
  );
}

function handleEvent(data) {
  if (data.type === "connection") {
    handleConnection(data);
    return;
  }

  if (data.type === "hit") {
    handleHit(data);
    return;
  }

  if (data.type === "hihat_pedal") {
    handleHihatPedal(data);
    return;
  }

  if (data.type === "choke") {
    handleChoke(data);
  }
}

function connectWebSocket() {
  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${wsProtocol}//${window.location.host}/ws`;
  ws = new WebSocket(url);

  ws.onopen = () => {
    setConnectionUi(false, "CHECKING");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleEvent(data);
    } catch (err) {
      console.error("Invalid message", err, event.data);
    }
  };

  ws.onclose = () => {
    setConnectionUi(false, "BACKEND LOST");

    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWebSocket();
      }, 1000);
    }
  };

  ws.onerror = () => {
    setConnectionUi(false, "WS ERROR");
  };
}

connectWebSocket();
