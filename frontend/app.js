const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const stage = document.getElementById("stage");
const panelToggleButton = document.getElementById("panelToggleButton");
const panelCloseButton = document.getElementById("panelCloseButton");
const calibrateButton = document.getElementById("calibrateButton");
const overlayButton = document.getElementById("overlayButton");
const resetLayoutButton = document.getElementById("resetLayoutButton");
const padScaleInput = document.getElementById("padScaleInput");

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
let calibrationMode = false;
let activeDrag = null;
let controlsOpen = true;

const layoutStorageKey = "td17-overlay-layout-v1";

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

const defaultLayout = {
  crash1: { x: 16, y: 14, w: 178, h: 72, r: -16 },
  hihat: { x: 18, y: 42, w: 154, h: 68, r: -18 },
  ride: { x: 76, y: 19, w: 188, h: 78, r: 15 },
  crash2: { x: 72, y: 44, w: 166, h: 70, r: 14 },
  tom1: { x: 40, y: 24, w: 138, h: 78, r: -8 },
  tom2: { x: 56, y: 28, w: 146, h: 80, r: 9 },
  tom3: { x: 64, y: 61, w: 158, h: 88, r: 12 },
  snare: { x: 42, y: 56, w: 164, h: 92, r: -10 },
  kick: { x: 50, y: 79, w: 132, h: 92, r: 0 },
  scale: 100,
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

function normalizePadLayout(part, saved) {
  const fallback = defaultLayout[part];

  return {
    x: Number.isFinite(Number(saved?.x)) ? Number(saved.x) : fallback.x,
    y: Number.isFinite(Number(saved?.y)) ? Number(saved.y) : fallback.y,
    w: Number.isFinite(Number(saved?.w)) ? Number(saved.w) : fallback.w,
    h: Number.isFinite(Number(saved?.h)) ? Number(saved.h) : fallback.h,
    r: Number.isFinite(Number(saved?.r)) ? Number(saved.r) : fallback.r,
  };
}

function readLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutStorageKey));
    const layout = { scale: saved?.scale || defaultLayout.scale };

    Object.keys(defaultLayout).forEach((part) => {
      if (part === "scale") return;
      layout[part] = normalizePadLayout(part, saved?.[part]);
    });

    return layout;
  } catch {
    return { ...defaultLayout };
  }
}

function writeLayout(layout) {
  localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
}

function getLayout() {
  const layout = { scale: Number(padScaleInput.value) || defaultLayout.scale };

  document.querySelectorAll(".stage-pad").forEach((pad) => {
    const part = pad.dataset.part;
    layout[part] = {
      x: Number.parseFloat(pad.style.getPropertyValue("--x")) || 50,
      y: Number.parseFloat(pad.style.getPropertyValue("--y")) || 50,
      w: Number.parseFloat(pad.style.getPropertyValue("--w")) || defaultLayout[part].w,
      h: Number.parseFloat(pad.style.getPropertyValue("--h")) || defaultLayout[part].h,
      r: Number.parseFloat(pad.style.getPropertyValue("--r")) || 0,
    };
  });

  return layout;
}

function applyLayout(layout) {
  document.querySelectorAll(".stage-pad").forEach((pad) => {
    const part = pad.dataset.part;
    const pos = normalizePadLayout(part, layout[part]);
    pad.style.setProperty("--x", `${pos.x}`);
    pad.style.setProperty("--y", `${pos.y}`);
    pad.style.setProperty("--w", `${pos.w}`);
    pad.style.setProperty("--h", `${pos.h}`);
    pad.style.setProperty("--r", `${pos.r}deg`);
    pad.dataset.rotation = String(pos.r);
  });

  const scale = clamp(Number(layout.scale) || defaultLayout.scale, 70, 145);
  padScaleInput.value = String(scale);
  document.documentElement.style.setProperty("--pad-scale", String(scale / 100));
}

function saveCurrentLayout() {
  writeLayout(getLayout());
}

function setSelectedPad(pad) {
  document.querySelectorAll(".stage-pad.selected").forEach((item) => {
    item.classList.remove("selected");
  });

  if (pad) {
    pad.classList.add("selected");
  }
}

function setCalibrationMode(enabled) {
  calibrationMode = enabled;
  document.body.classList.toggle("calibrating", enabled);
  calibrateButton.classList.toggle("active", enabled);
  calibrateButton.setAttribute("aria-pressed", String(enabled));

  if (enabled) {
    setControlsOpen(true);
  }
}

function setControlsOpen(open) {
  controlsOpen = open;
  document.body.classList.toggle("controls-open", open);
  panelToggleButton.setAttribute("aria-expanded", String(open));
  panelToggleButton.title = open ? "Hide controls" : "Show controls";
}

function setOverlayMode(enabled) {
  document.body.classList.toggle("obs-mode", enabled);
  overlayButton.classList.toggle("active", enabled);
  overlayButton.setAttribute("aria-pressed", String(enabled));

  if (enabled && !calibrationMode) {
    setControlsOpen(false);
  } else {
    setControlsOpen(true);
  }
}

function triggerStagePad(part, velocity, zone) {
  const pad = document.querySelector(`.stage-pad[data-part="${part}"]`);
  const label = document.getElementById(`stage-${part}`);

  if (!pad) return;

  const strength = clamp(velocity / 127, 0.1, 1);
  pad.style.setProperty("--hit-alpha", String(0.25 + strength * 0.75));
  pad.style.setProperty("--hit-ring", String(12 + strength * 34));

  const pulse = document.createElement("i");
  pulse.className = "hit-pulse";
  pulse.style.setProperty("--pulse-alpha", String(0.28 + strength * 0.72));
  pulse.style.setProperty("--pulse-ring", String(12 + strength * 34));
  pad.appendChild(pulse);

  pad.classList.add("hit");

  if (label) label.textContent = zone || "hit";

  const activePulses = pad.querySelectorAll(".hit-pulse");
  if (activePulses.length > 5) {
    activePulses[0].remove();
  }

  window.setTimeout(() => {
    pulse.remove();
  }, 460);

  window.setTimeout(() => {
    if (pad.querySelector(".hit-pulse")) return;
    pad.classList.remove("hit");
    if (label) label.textContent = "idle";
  }, 500);
}

function triggerPad(part, velocity, zone) {
  const pad = document.querySelector(`.pad[data-part="${part}"]`);
  const label = document.getElementById(`pad-${part}`);

  triggerStagePad(part, velocity, zone);

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

function getPadMetrics(pad) {
  return {
    x: Number.parseFloat(pad.style.getPropertyValue("--x")) || 50,
    y: Number.parseFloat(pad.style.getPropertyValue("--y")) || 50,
    w: Number.parseFloat(pad.style.getPropertyValue("--w")) || 120,
    h: Number.parseFloat(pad.style.getPropertyValue("--h")) || 80,
    r: Number.parseFloat(pad.dataset.rotation) || 0,
  };
}

function getLocalPointer(clientX, clientY, centerX, centerY, rotation) {
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  const rad = (-rotation * Math.PI) / 180;

  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad),
    y: dx * Math.sin(rad) + dy * Math.cos(rad),
    dx,
    dy,
  };
}

function getCurrentPadScale() {
  return clamp(Number(padScaleInput.value) || defaultLayout.scale, 70, 145) / 100;
}

function startDrag(event) {
  if (!calibrationMode) return;

  event.preventDefault();

  const pad = event.currentTarget;
  const handle = event.target.closest(".edit-handle");
  const rect = stage.getBoundingClientRect();
  const metrics = getPadMetrics(pad);
  const centerX = rect.left + (metrics.x / 100) * rect.width;
  const centerY = rect.top + (metrics.y / 100) * rect.height;

  activeDrag = {
    pad,
    rect,
    pointerId: event.pointerId,
    mode: handle?.dataset.handle || "move",
    centerX,
    centerY,
    pointerOffsetX: event.clientX - centerX,
    pointerOffsetY: event.clientY - centerY,
    start: metrics,
  };

  setSelectedPad(pad);

  if (window.matchMedia("(max-width: 720px)").matches) {
    setControlsOpen(false);
  }

  document.body.classList.add("dragging-pad");
  pad.setPointerCapture(event.pointerId);
  moveDrag(event);
}

function moveDrag(event) {
  if (!activeDrag) return;
  if (event.pointerId !== activeDrag.pointerId) return;

  event.preventDefault();

  if (activeDrag.mode === "move") {
    const centerX = event.clientX - activeDrag.pointerOffsetX;
    const centerY = event.clientY - activeDrag.pointerOffsetY;
    const x = clamp(((centerX - activeDrag.rect.left) / activeDrag.rect.width) * 100, 4, 96);
    const y = clamp(((centerY - activeDrag.rect.top) / activeDrag.rect.height) * 100, 5, 95);

    activeDrag.pad.style.setProperty("--x", x.toFixed(2));
    activeDrag.pad.style.setProperty("--y", y.toFixed(2));
    return;
  }

  if (activeDrag.mode === "rotate") {
    const angle = Math.atan2(
      event.clientY - activeDrag.centerY,
      event.clientX - activeDrag.centerX,
    );
    const rotation = angle * (180 / Math.PI) + 90;

    activeDrag.pad.style.setProperty("--r", `${rotation.toFixed(1)}deg`);
    activeDrag.pad.dataset.rotation = rotation.toFixed(1);
    return;
  }

  const local = getLocalPointer(
    event.clientX,
    event.clientY,
    activeDrag.centerX,
    activeDrag.centerY,
    activeDrag.start.r,
  );

  if (activeDrag.mode === "resize-x" || activeDrag.mode === "resize-both") {
    const width = clamp((Math.abs(local.x) * 2) / getCurrentPadScale(), 58, 360);
    activeDrag.pad.style.setProperty("--w", width.toFixed(1));
  }

  if (activeDrag.mode === "resize-y" || activeDrag.mode === "resize-both") {
    const height = clamp((Math.abs(local.y) * 2) / getCurrentPadScale(), 36, 260);
    activeDrag.pad.style.setProperty("--h", height.toFixed(1));
  }
}

function stopDrag(event) {
  if (!activeDrag) return;
  if (event && event.pointerId !== activeDrag.pointerId) return;

  saveCurrentLayout();
  document.body.classList.remove("dragging-pad");
  activeDrag = null;
}

function addEditHandles(pad) {
  [
    ["resize-x", "handle-east"],
    ["resize-y", "handle-south"],
    ["resize-both", "handle-corner"],
    ["rotate", "handle-rotate"],
  ].forEach(([mode, className]) => {
    const handle = document.createElement("span");
    handle.className = `edit-handle ${className}`;
    handle.dataset.handle = mode;
    handle.setAttribute("aria-hidden", "true");
    pad.appendChild(handle);
  });
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

document.querySelectorAll(".stage-pad").forEach((pad) => {
  addEditHandles(pad);
  pad.addEventListener("pointerdown", startDrag);
  pad.addEventListener("pointermove", moveDrag);
  pad.addEventListener("pointerup", stopDrag);
  pad.addEventListener("pointercancel", stopDrag);
  pad.addEventListener("lostpointercapture", stopDrag);
});

calibrateButton.addEventListener("click", () => {
  setCalibrationMode(!calibrationMode);
});

overlayButton.addEventListener("click", () => {
  setOverlayMode(!document.body.classList.contains("obs-mode"));
});

panelToggleButton.addEventListener("click", () => {
  setControlsOpen(!controlsOpen);
});

panelCloseButton.addEventListener("click", () => {
  setControlsOpen(false);
});

resetLayoutButton.addEventListener("click", () => {
  localStorage.removeItem(layoutStorageKey);
  applyLayout(defaultLayout);
});

padScaleInput.addEventListener("input", () => {
  document.documentElement.style.setProperty(
    "--pad-scale",
    String(Number(padScaleInput.value) / 100),
  );
  saveCurrentLayout();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  setCalibrationMode(false);
  setOverlayMode(false);
  setControlsOpen(true);
});

applyLayout(readLayout());
setControlsOpen(true);
setOverlayMode(new URLSearchParams(window.location.search).has("overlay"));
connectWebSocket();
