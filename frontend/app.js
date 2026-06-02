const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const stage = document.getElementById("stage");
const panelToggleButton = document.getElementById("panelToggleButton");
const panelCloseButton = document.getElementById("panelCloseButton");
const calibrateButton = document.getElementById("calibrateButton");
const overlayButton = document.getElementById("overlayButton");
const resetLayoutButton = document.getElementById("resetLayoutButton");
const padScaleInput = document.getElementById("padScaleInput");
const effectStrengthInput = document.getElementById("effectStrengthInput");
const hihatMotionInput = document.getElementById("hihatMotionInput");
const padLayerInput = document.getElementById("padLayerInput");
const padOriginXInput = document.getElementById("padOriginXInput");
const padOriginYInput = document.getElementById("padOriginYInput");
const padTiltXInput = document.getElementById("padTiltXInput");
const padTiltYInput = document.getElementById("padTiltYInput");
const padDepthInput = document.getElementById("padDepthInput");

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
let hihatState = { openness: "unknown", value: 0 };

const layoutStorageKey = "td17-overlay-layout-v1";
const settingsStorageKey = "td17-overlay-settings-v1";
const defaultSettings = {
  effectStrength: 100,
  hihatMotion: 24,
};

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

const zoneVisualClasses = [
  "zone-head",
  "zone-rim",
  "zone-edge",
  "zone-bell",
  "zone-xstick",
  "zone-pedal",
];

const defaultLayout = {
  crash1: { x: 16, y: 14, w: 178, h: 72, r: -16, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
  hihat: { x: 18, y: 42, w: 154, h: 68, r: -18, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
  ride: { x: 76, y: 19, w: 188, h: 78, r: 15, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
  crash2: { x: 72, y: 44, w: 166, h: 70, r: 14, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
  tom1: { x: 40, y: 24, w: 138, h: 78, r: -8, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
  tom2: { x: 56, y: 28, w: 146, h: 80, r: 9, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
  tom3: { x: 64, y: 61, w: 158, h: 88, r: 12, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
  snare: { x: 42, y: 56, w: 164, h: 92, r: -10, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
  kick: { x: 50, y: 79, w: 132, h: 92, r: 0, z: 10, ox: 50, oy: 50, tx: 0, ty: 0, depth: 900 },
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
    z: Number.isFinite(Number(saved?.z)) ? Number(saved.z) : fallback.z,
    ox: Number.isFinite(Number(saved?.ox)) ? Number(saved.ox) : fallback.ox,
    oy: Number.isFinite(Number(saved?.oy)) ? Number(saved.oy) : fallback.oy,
    tx: Number.isFinite(Number(saved?.tx)) ? Number(saved.tx) : fallback.tx,
    ty: Number.isFinite(Number(saved?.ty)) ? Number(saved.ty) : fallback.ty,
    depth: Number.isFinite(Number(saved?.depth)) ? Number(saved.depth) : fallback.depth,
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

function readSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(settingsStorageKey));

    return {
      effectStrength: clamp(
        Number(saved?.effectStrength) || defaultSettings.effectStrength,
        35,
        180,
      ),
      hihatMotion: clamp(
        Number.isFinite(Number(saved?.hihatMotion))
          ? Number(saved.hihatMotion)
          : defaultSettings.hihatMotion,
        0,
        72,
      ),
    };
  } catch {
    return { ...defaultSettings };
  }
}

function writeLayout(layout) {
  localStorage.setItem(layoutStorageKey, JSON.stringify(layout));
}

function writeSettings(settings) {
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
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
      z: Number.parseFloat(pad.style.getPropertyValue("--z")) || defaultLayout[part].z,
      ox: readPadPercentVar(pad, "--origin-x", defaultLayout[part].ox),
      oy: readPadPercentVar(pad, "--origin-y", defaultLayout[part].oy),
      tx: Number.parseFloat(pad.style.getPropertyValue("--tilt-x")) || defaultLayout[part].tx,
      ty: Number.parseFloat(pad.style.getPropertyValue("--tilt-y")) || defaultLayout[part].ty,
      depth: Number.parseFloat(pad.style.getPropertyValue("--depth")) || defaultLayout[part].depth,
    };
  });

  return layout;
}

function getSettings() {
  const effectStrength = Number(effectStrengthInput.value);
  const hihatMotion = Number(hihatMotionInput.value);

  return {
    effectStrength: Number.isFinite(effectStrength)
      ? effectStrength
      : defaultSettings.effectStrength,
    hihatMotion: Number.isFinite(hihatMotion) ? hihatMotion : defaultSettings.hihatMotion,
  };
}

function applyLayout(layout) {
  document.querySelectorAll(".stage-pad").forEach((pad) => {
    const part = pad.dataset.part;
    const pos = normalizePadLayout(part, layout[part]);
    const tiltX = clamp(Number(pos.tx) || 0, -45, 45);
    const tiltY = clamp(Number(pos.ty) || 0, -45, 45);

    pad.style.setProperty("--x", `${pos.x}`);
    pad.style.setProperty("--y", `${pos.y}`);
    pad.style.setProperty("--w", `${pos.w}`);
    pad.style.setProperty("--h", `${pos.h}`);
    pad.style.setProperty("--r", `${pos.r}deg`);
    pad.style.setProperty("--z", `${clamp(Number(pos.z) || 10, 1, 20)}`);
    pad.style.setProperty("--origin-x", `${clamp(Number(pos.ox), 0, 100)}%`);
    pad.style.setProperty("--origin-y", `${clamp(Number(pos.oy), 0, 100)}%`);
    pad.style.setProperty("--tilt-x", `${tiltX}deg`);
    pad.style.setProperty("--tilt-y", `${tiltY}deg`);
    pad.style.setProperty("--depth", `${clamp(Number(pos.depth) || 900, 360, 1600)}px`);
    pad.style.setProperty("--tilt-shade-x", String(clamp(tiltY / 45, -1, 1)));
    pad.style.setProperty("--tilt-shade-y", String(clamp(tiltX / 45, -1, 1)));
    pad.dataset.rotation = String(pos.r);
  });

  const scale = clamp(Number(layout.scale) || defaultLayout.scale, 70, 145);
  padScaleInput.value = String(scale);
  document.documentElement.style.setProperty("--pad-scale", String(scale / 100));
}

function applySettings(settings) {
  const effectStrength = clamp(
    Number(settings.effectStrength) || defaultSettings.effectStrength,
    35,
    180,
  );
  const hihatMotion = clamp(
    Number.isFinite(Number(settings.hihatMotion))
      ? Number(settings.hihatMotion)
      : defaultSettings.hihatMotion,
    0,
    72,
  );

  effectStrengthInput.value = String(effectStrength);
  hihatMotionInput.value = String(hihatMotion);
  setEffectStrengthVariables(effectStrength / 100);
  setHihatStageState(hihatState.openness, hihatState.value);
}

function saveCurrentLayout() {
  writeLayout(getLayout());
}

function saveCurrentSettings() {
  writeSettings(getSettings());
}

function readPadPercentVar(pad, name, fallback) {
  const value = Number.parseFloat(pad.style.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function setSelectedPad(pad) {
  document.querySelectorAll(".stage-pad.selected").forEach((item) => {
    item.classList.remove("selected");
  });

  if (pad) {
    pad.classList.add("selected");
    padLayerInput.disabled = false;
    padOriginXInput.disabled = false;
    padOriginYInput.disabled = false;
    padTiltXInput.disabled = false;
    padTiltYInput.disabled = false;
    padDepthInput.disabled = false;
    padLayerInput.value = String(
      clamp(Number.parseFloat(pad.style.getPropertyValue("--z")) || 10, 1, 20),
    );
    padOriginXInput.value = String(
      clamp(readPadPercentVar(pad, "--origin-x", 50), 0, 100),
    );
    padOriginYInput.value = String(
      clamp(readPadPercentVar(pad, "--origin-y", 50), 0, 100),
    );
    padTiltXInput.value = String(
      clamp(Number.parseFloat(pad.style.getPropertyValue("--tilt-x")) || 0, -45, 45),
    );
    padTiltYInput.value = String(
      clamp(Number.parseFloat(pad.style.getPropertyValue("--tilt-y")) || 0, -45, 45),
    );
    padDepthInput.value = String(
      clamp(Number.parseFloat(pad.style.getPropertyValue("--depth")) || 900, 360, 1600),
    );
  } else {
    padLayerInput.disabled = true;
    padOriginXInput.disabled = true;
    padOriginYInput.disabled = true;
    padTiltXInput.disabled = true;
    padTiltYInput.disabled = true;
    padDepthInput.disabled = true;
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

function getZoneVisual(zone) {
  if (!zone) return "head";
  if (zone.includes("rim")) return "rim";
  if (zone.includes("edge")) return "edge";
  if (zone.includes("bell")) return "bell";
  if (zone.includes("xstick")) return "xstick";
  if (zone.includes("pedal")) return "pedal";
  return "head";
}

function setStagePadZone(pad, zone) {
  const visual = getZoneVisual(zone);

  pad.dataset.zone = zone || "hit";
  pad.classList.remove(...zoneVisualClasses);
  pad.classList.add(`zone-${visual}`);
}

function setStagePadChoked(part, pressed) {
  const pad = document.querySelector(`.stage-pad[data-part="${part}"]`);
  if (!pad) return;

  pad.classList.toggle("choked", Boolean(pressed));
  pad.dataset.choked = pressed ? "true" : "false";
}

function getEffectStrength() {
  return clamp(Number(effectStrengthInput.value) || defaultSettings.effectStrength, 35, 180) / 100;
}

function setEffectStrengthVariables(strength) {
  document.documentElement.style.setProperty("--effect-strength", String(strength));
  document.documentElement.style.setProperty("--effect-opacity", String(strength));
  document.documentElement.style.setProperty("--effect-glow", String(strength));
}

function getHihatMotionPixels() {
  const value = Number(hihatMotionInput.value);
  return Number.isFinite(value) ? clamp(value, 0, 72) : defaultSettings.hihatMotion;
}

function setHihatStageState(openness, value) {
  const pad = document.querySelector('.stage-pad[data-part="hihat"]');
  if (!pad) return;

  const amount = clamp((Number(value) || 0) / 127, 0, 1);
  const effectStrength = getEffectStrength();
  hihatState = { openness: openness || "unknown", value };
  pad.dataset.openness = openness || "unknown";
  pad.style.setProperty("--hihat-closed", amount.toFixed(3));
  pad.style.setProperty("--hihat-inset", `${(7 + amount * 15).toFixed(1)}%`);
  pad.style.setProperty(
    "--hihat-opacity",
    String((0.16 + amount * 0.42) * effectStrength),
  );
  pad.style.setProperty("--state-y", `${(amount * getHihatMotionPixels()).toFixed(1)}px`);
}

function triggerStagePad(part, velocity, zone) {
  const pad = document.querySelector(`.stage-pad[data-part="${part}"]`);
  const label = document.getElementById(`stage-${part}`);

  if (!pad) return;

  setStagePadZone(pad, zone);

  const effectStrength = getEffectStrength();
  const strength = clamp(velocity / 127, 0.1, 1);
  pad.style.setProperty(
    "--hit-alpha",
    String((0.25 + strength * 0.75) * effectStrength),
  );
  pad.style.setProperty("--hit-ring", String((12 + strength * 34) * effectStrength));

  const pulse = document.createElement("i");
  pulse.className = "hit-pulse";
  pulse.style.setProperty(
    "--pulse-alpha",
    String((0.28 + strength * 0.72) * effectStrength),
  );
  pulse.style.setProperty("--pulse-ring", String((12 + strength * 34) * effectStrength));
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

  const effectStrength = getEffectStrength();
  const strength = clamp(velocity / 127, 0.1, 1);
  pad.style.setProperty("--hit-scale", String(1 + strength * 0.18 * effectStrength));
  pad.style.setProperty("--hit-alpha", String((0.35 + strength * 0.65) * effectStrength));

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

function setPadOrigin(pad, originX, originY) {
  const x = clamp(originX, 0, 100);
  const y = clamp(originY, 0, 100);

  pad.style.setProperty("--origin-x", `${x.toFixed(1)}%`);
  pad.style.setProperty("--origin-y", `${y.toFixed(1)}%`);

  if (pad.classList.contains("selected")) {
    padOriginXInput.value = String(Math.round(x));
    padOriginYInput.value = String(Math.round(y));
  }
}

function setSelectedPadPerspective(name, value, min, max, unit) {
  const selectedPad = document.querySelector(".stage-pad.selected");
  if (!selectedPad) return;

  const number = Number(value);
  const next = clamp(Number.isFinite(number) ? number : 0, min, max);
  selectedPad.style.setProperty(name, `${next}${unit}`);

  const tiltX = Number.parseFloat(selectedPad.style.getPropertyValue("--tilt-x")) || 0;
  const tiltY = Number.parseFloat(selectedPad.style.getPropertyValue("--tilt-y")) || 0;
  selectedPad.style.setProperty("--tilt-shade-x", String(clamp(tiltY / 45, -1, 1)));
  selectedPad.style.setProperty("--tilt-shade-y", String(clamp(tiltX / 45, -1, 1)));
  saveCurrentLayout();
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

  if (activeDrag.mode === "origin") {
    const scale = getCurrentPadScale();
    const originX = ((local.x / scale + activeDrag.start.w / 2) / activeDrag.start.w) * 100;
    const originY = ((local.y / scale + activeDrag.start.h / 2) / activeDrag.start.h) * 100;

    setPadOrigin(activeDrag.pad, originX, originY);
    return;
  }

  if (activeDrag.mode === "resize-x" || activeDrag.mode === "resize-both") {
    const width = clamp((Math.abs(local.x) * 2) / getCurrentPadScale(), 58, 900);
    activeDrag.pad.style.setProperty("--w", width.toFixed(1));
  }

  if (activeDrag.mode === "resize-y" || activeDrag.mode === "resize-both") {
    const height = clamp((Math.abs(local.y) * 2) / getCurrentPadScale(), 36, 650);
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
    ["origin", "handle-origin"],
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

  if (calibrationMode) {
    setSelectedPad(document.querySelector(`.stage-pad[data-part="${part}"]`));
  }

  addLogLine(
    `${formatTime(data.timestamp)}  ${displayPart}  ${zone}  vel=${velocity}  note=${note}`,
  );
}

function handleHihatPedal(data) {
  const value = data.value ?? 0;
  const width = clamp((value / 127) * 100, 0, 100);

  hihatText.textContent = `${data.openness} · ${value}`;
  hihatBar.style.width = `${width}%`;
  setHihatStageState(data.openness, value);

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

  setStagePadChoked(part, data.pressed);
  triggerPad(part, data.pressed ? 127 : 40, "choke");
  pulseHero();

  if (calibrationMode) {
    setSelectedPad(document.querySelector(`.stage-pad[data-part="${part}"]`));
  }

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

effectStrengthInput.addEventListener("input", () => {
  setEffectStrengthVariables(getEffectStrength());
  setHihatStageState(hihatState.openness, hihatState.value);
  saveCurrentSettings();
});

hihatMotionInput.addEventListener("input", () => {
  setHihatStageState(hihatState.openness, hihatState.value);
  saveCurrentSettings();
});

padLayerInput.addEventListener("input", () => {
  const selectedPad = document.querySelector(".stage-pad.selected");
  if (!selectedPad) return;

  selectedPad.style.setProperty("--z", String(clamp(Number(padLayerInput.value) || 10, 1, 20)));
  saveCurrentLayout();
});

padOriginXInput.addEventListener("input", () => {
  const selectedPad = document.querySelector(".stage-pad.selected");
  if (!selectedPad) return;
  const value = Number(padOriginXInput.value);
  const currentY = readPadPercentVar(selectedPad, "--origin-y", 50);

  setPadOrigin(selectedPad, Number.isFinite(value) ? value : 50, currentY);
  saveCurrentLayout();
});

padOriginYInput.addEventListener("input", () => {
  const selectedPad = document.querySelector(".stage-pad.selected");
  if (!selectedPad) return;
  const value = Number(padOriginYInput.value);
  const currentX = readPadPercentVar(selectedPad, "--origin-x", 50);

  setPadOrigin(selectedPad, currentX, Number.isFinite(value) ? value : 50);
  saveCurrentLayout();
});

padTiltXInput.addEventListener("input", () => {
  setSelectedPadPerspective("--tilt-x", padTiltXInput.value, -45, 45, "deg");
});

padTiltYInput.addEventListener("input", () => {
  setSelectedPadPerspective("--tilt-y", padTiltYInput.value, -45, 45, "deg");
});

padDepthInput.addEventListener("input", () => {
  setSelectedPadPerspective("--depth", padDepthInput.value, 360, 1600, "px");
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  setCalibrationMode(false);
  setOverlayMode(false);
  setControlsOpen(true);
});

applyLayout(readLayout());
applySettings(readSettings());
setControlsOpen(true);
setOverlayMode(new URLSearchParams(window.location.search).has("overlay"));
connectWebSocket();
