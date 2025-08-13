// MediaPipe Hands via CDN
// Using the new tasks API would require bundling; for simplicity, we use Hands solution from CDN

const video = document.getElementById('webcam');
const handsCanvas = document.getElementById('handsCanvas');
const drawCanvas = document.getElementById('drawCanvas');
const clearBtn = document.getElementById('clearBtn');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');
const modeSelect = document.getElementById('modeSelect');
const snapToShapesCheckbox = document.getElementById('snapToShapes');
const helpBtn = document.getElementById('helpBtn');
const helpModal = document.getElementById('helpModal');
const closeHelp = document.getElementById('closeHelp');
const colorPicker = document.getElementById('colorPicker');
const sizePicker = document.getElementById('sizePicker');
const showHandsCheckbox = document.getElementById('showHands');
const suggestionsEl = document.getElementById('suggestions');
const shapeTypeSelect = document.getElementById('shapeTypeSelect');
const captureBtn = document.getElementById('captureBtn');
const gallery = document.getElementById('gallery');
const brightness = document.getElementById('brightness');
const contrast = document.getElementById('contrast');
const saturation = document.getElementById('saturation');
const brightnessVal = document.getElementById('brightnessVal');
const contrastVal = document.getElementById('contrastVal');
const saturationVal = document.getElementById('saturationVal');

const handsCtx = handsCanvas.getContext('2d');
const drawCtx = drawCanvas.getContext('2d');

let drawingStrokes = []; // Array of polylines, each is {points:[{x,y,t}], color, size}
let shapes = []; // Array of geometric shapes {type, cx, cy, w, h, angle, color, selected}
let currentStroke = null;
let lastRecommendAt = 0;
let history = [];
let future = [];
let eraseRadius = 20; // pixels, scaled with DPR

function resizeCanvases() {
  const rect = video.getBoundingClientRect();
  for (const c of [handsCanvas, drawCanvas]) {
    c.width = rect.width * devicePixelRatio;
    c.height = rect.height * devicePixelRatio;
    c.style.width = rect.width + 'px';
    c.style.height = rect.height + 'px';
  }
}

window.addEventListener('resize', resizeCanvases);

async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
  video.srcObject = stream;
  await new Promise((r) => (video.onloadedmetadata = r));
  video.play();
  resizeCanvases();
}

function drawHandsLandmarks(handsResults) {
  handsCtx.clearRect(0, 0, handsCanvas.width, handsCanvas.height);
  if (!showHandsCheckbox.checked) return;
  if (!handsResults || !handsResults.multiHandLandmarks) return;
  const scaleX = handsCanvas.width;
  const scaleY = handsCanvas.height;

  handsCtx.lineWidth = 2 * devicePixelRatio;
  handsCtx.strokeStyle = '#44ff8844';
  handsCtx.fillStyle = '#00e0ff';

  for (const lm of handsResults.multiHandLandmarks) {
    for (const p of lm) {
      handsCtx.beginPath();
      handsCtx.arc(p.x * scaleX, p.y * scaleY, 3 * devicePixelRatio, 0, Math.PI * 2);
      handsCtx.fill();
    }
  }
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

// Simple gesture: pinch index fingertip (8) to thumb tip (4) to draw
function handleAirDraw(handsResults) {
  if (!handsResults || !handsResults.multiHandLandmarks || handsResults.multiHandLandmarks.length === 0) {
    // end stroke if active
    if (currentStroke && currentStroke.points.length > 1) {
      commitStroke(currentStroke);
    }
    currentStroke = null;
    return;
  }

  const lm = handsResults.multiHandLandmarks[0];
  const thumb = lm[4];
  const index = lm[8];
  const pinch = distance(thumb, index);

  // pinch threshold tuned empirically in normalized space
  const isDrawing = pinch < 0.05; // smaller distance => pinching

  const px = index.x * drawCanvas.width;
  const py = index.y * drawCanvas.height;
  const t = performance.now();

  if (isDrawing && modeSelect.value === 'draw') {
    if (!currentStroke) {
      currentStroke = { color: colorPicker.value, size: Number(sizePicker.value) * devicePixelRatio, points: [] };
    }
    const last = currentStroke.points[currentStroke.points.length - 1];
    if (!last || Math.hypot(px - last.x, py - last.y) > 2 * devicePixelRatio) {
      currentStroke.points.push({ x: px, y: py, t });
      // live suggestions while drawing
      maybeRecommend(true);
    }
  } else if (isDrawing && modeSelect.value === 'erase') {
    // Remove any stroke with a point near the pinch point
    if (drawingStrokes.length) {
      pushHistory();
      const radius = eraseRadius * devicePixelRatio;
      drawingStrokes = drawingStrokes.filter((s) => !s.points.some((p) => Math.hypot(p.x - px, p.y - py) < radius));
    }
  } else {
    if (currentStroke && currentStroke.points.length > 1) commitStroke(currentStroke);
    currentStroke = null;
  }

  redraw();
}

function redraw() {
  drawCtx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
  function drawStroke(stroke) {
    drawCtx.strokeStyle = stroke.color;
    drawCtx.lineWidth = stroke.size;
    drawCtx.lineJoin = 'round';
    drawCtx.lineCap = 'round';
    drawCtx.beginPath();
    const pts = stroke.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (i === 0) drawCtx.moveTo(p.x, p.y);
      else drawCtx.lineTo(p.x, p.y);
    }
    drawCtx.stroke();
  }
  function drawShape(shape) {
    const { type, cx, cy, w, h, angle = 0, color = '#fff', selected } = shape;
    drawCtx.save();
    drawCtx.translate(cx, cy);
    drawCtx.rotate(angle);
    drawCtx.strokeStyle = color;
    drawCtx.lineWidth = 3 * devicePixelRatio;
    drawCtx.beginPath();
    if (type === 'circle') {
      const r = Math.max(w, h) / 2;
      drawCtx.arc(0, 0, r, 0, Math.PI * 2);
    } else if (type === 'rect') {
      drawCtx.rect(-w / 2, -h / 2, w, h);
    } else if (type === 'triangle') {
      drawCtx.moveTo(0, -h / 2);
      drawCtx.lineTo(-w / 2, h / 2);
      drawCtx.lineTo(w / 2, h / 2);
      drawCtx.closePath();
    }
    drawCtx.stroke();

    if (selected) drawSelection(shape);
    drawCtx.restore();
  }
  function drawSelection(shape) {
    const { w, h } = shape;
    drawCtx.save();
    drawCtx.strokeStyle = '#7aa2f7';
    drawCtx.setLineDash([8 * devicePixelRatio, 8 * devicePixelRatio]);
    drawCtx.strokeRect(-w / 2, -h / 2, w, h);
    drawCtx.setLineDash([]);
    // handles
    const handleSize = 10 * devicePixelRatio;
    const handles = getHandles(shape);
    for (const hnd of handles) {
      drawCtx.fillStyle = hnd.color;
      drawCtx.fillRect(hnd.x - handleSize / 2, hnd.y - handleSize / 2, handleSize, handleSize);
    }
    drawCtx.restore();
  }
  for (const s of drawingStrokes) drawStroke(s);
  if (currentStroke) drawStroke(currentStroke);
  for (const sh of shapes) drawShape(sh);
}

clearBtn.addEventListener('click', () => {
  pushHistory();
  drawingStrokes = [];
  shapes = [];
  currentStroke = null;
  redraw();
  renderSuggestions([]);
});

undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.key.toLowerCase() === 'z') undo();
  if (e.ctrlKey && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) redo();
});

helpBtn.addEventListener('click', () => helpModal.classList.remove('hidden'));
closeHelp.addEventListener('click', () => helpModal.classList.add('hidden'));

function renderSuggestions(items) {
  suggestionsEl.innerHTML = '';
  for (const s of items) {
    const li = document.createElement('li');
    li.className = 'suggestion';
    const preview = document.createElement('canvas');
    const label = document.createElement('span');
    label.textContent = s;
    // draw small preview
    drawSuggestionPreview(preview, String(s));
    li.appendChild(preview);
    li.appendChild(label);
    li.addEventListener('click', () => insertSuggestedShape(String(s)));
    suggestionsEl.appendChild(li);
  }
}

function drawSuggestionPreview(canvas, label) {
  const size = 48 * devicePixelRatio;
  canvas.width = size; canvas.height = size; canvas.style.width = '48px'; canvas.style.height = '48px';
  const ctx = canvas.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);
  ctx.translate(24, 24);
  ctx.strokeStyle = '#9db4ff';
  ctx.lineWidth = 2;
  const type = guessTypeFromLabel(label);
  ctx.beginPath();
  if (type === 'circle') ctx.arc(0, 0, 18, 0, Math.PI * 2);
  else if (type === 'rect') ctx.rect(-18, -12, 36, 24);
  else if (type === 'triangle') { ctx.moveTo(0, -18); ctx.lineTo(-16, 12); ctx.lineTo(16, 12); ctx.closePath(); }
  else { ctx.moveTo(-18, -12); ctx.lineTo(18, 12); }
  ctx.stroke();
}

function guessTypeFromLabel(label) {
  const name = String(label).toLowerCase();
  if (name.includes('circle') || name.includes('oval') || name.includes('round')) return 'circle';
  if (name.includes('square') || name.includes('rectangle') || name.includes('rect')) return 'rect';
  if (name.includes('triangle')) return 'triangle';
  return 'rect';
}

async function maybeRecommend(includeCurrent = false) {
  const now = performance.now();
  if (now - lastRecommendAt < 1200) return;
  lastRecommendAt = now;
  try {
    const recent = drawingStrokes.slice(-4);
    if (includeCurrent && currentStroke && currentStroke.points.length > 1) recent.push(currentStroke);
    const payload = simplifyStrokes(recent);
    const res = await fetch('/api/recommend-shapes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ strokes: payload, width: drawCanvas.width, height: drawCanvas.height }),
    });
    const data = await res.json();
    renderSuggestions(data.suggestions || []);
  } catch (e) {
    console.error(e);
  }
}

function simplifyStrokes(strokes) {
  // Downsample points to reduce payload and remove timestamps
  const simplified = [];
  for (const s of strokes) {
    const step = Math.ceil(s.points.length / 32);
    const pts = [];
    for (let i = 0; i < s.points.length; i += step) {
      const p = s.points[i];
      pts.push([Number((p.x / drawCanvas.width).toFixed(4)), Number((p.y / drawCanvas.height).toFixed(4))]);
    }
    simplified.push({ color: s.color, size: Number((s.size / devicePixelRatio).toFixed(2)), points: pts });
  }
  return simplified;
}

function pushHistory() {
  history.push({
    drawingStrokes: JSON.parse(JSON.stringify(drawingStrokes)),
    shapes: JSON.parse(JSON.stringify(shapes)),
  });
  if (history.length > 50) history.shift();
  future = [];
}
function undo() {
  if (history.length === 0) return;
  const snapshot = history.pop();
  future.push({
    drawingStrokes: JSON.parse(JSON.stringify(drawingStrokes)),
    shapes: JSON.parse(JSON.stringify(shapes)),
  });
  drawingStrokes = snapshot.drawingStrokes;
  shapes = snapshot.shapes;
  redraw();
}
function redo() {
  if (future.length === 0) return;
  const snapshot = future.pop();
  history.push({
    drawingStrokes: JSON.parse(JSON.stringify(drawingStrokes)),
    shapes: JSON.parse(JSON.stringify(shapes)),
  });
  drawingStrokes = snapshot.drawingStrokes;
  shapes = snapshot.shapes;
  redraw();
}

function commitStroke(stroke) {
  pushHistory();
  drawingStrokes.push(stroke);
  if (snapToShapesCheckbox.checked) {
    let snap = null;
    if (shapeTypeSelect.value !== 'auto') {
      snap = fitShapeFromType(stroke, shapeTypeSelect.value);
    } else {
      snap = detectShapeFromStroke(stroke);
    }
    if (snap) shapes.push(snap);
  }
  maybeRecommend();
}

function detectShapeFromStroke(stroke) {
  const pts = stroke.points;
  if (pts.length < 8) return null;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const closed = Math.hypot(first.x - last.x, first.y - last.y) < 25 * devicePixelRatio;
  if (!closed) return null;
  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const cx = minX + w / 2;
  const cy = minY + h / 2;

  // Circularity: ratio of area of stroke hull vs bbox, or variance of radius
  const rAvg = (w + h) / 4;
  let rVar = 0;
  let count = 0;
  for (let i = 0; i < pts.length; i += Math.ceil(pts.length / 32)) {
    const p = pts[i];
    const r = Math.hypot(p.x - cx, p.y - cy);
    rVar += Math.abs(r - rAvg);
    count++;
  }
  rVar /= count;

  if (rVar < 0.12 * rAvg) {
    return { type: 'circle', cx, cy, w: Math.max(w, h), h: Math.max(w, h), angle: 0, color: stroke.color, selected: false };
  }

  // Aspect ratio: ~1 => square, else rectangle; point-count corners => triangle heuristic
  const aspect = w / h;
  if (aspect > 0.75 && aspect < 1.25) {
    return { type: 'rect', cx, cy, w, h, angle: 0, color: stroke.color, selected: false };
  }

  // Triangle heuristic: find three extreme points via k-means-like reduction
  const simplified = [];
  const step = Math.ceil(pts.length / 12);
  for (let i = 0; i < pts.length; i += step) simplified.push(pts[i]);
  // Compute convex hull (gift wrapping)
  function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
  const points = simplified.sort((a, b) => a.x === b.x ? a.y - b.y : a.x - b.x);
  const lower = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, lower.length - 1).concat(upper.slice(0, upper.length - 1));
  if (hull.length === 3) {
    return { type: 'triangle', cx, cy, w, h, angle: 0, color: stroke.color, selected: false };
  }
  return null;
}

function fitShapeFromType(stroke, type) {
  const pts = stroke.points;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) { if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y; if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y; }
  const w = maxX - minX;
  const h = maxY - minY;
  const cx = minX + w / 2;
  const cy = minY + h / 2;
  if (type === 'circle') {
    const size = Math.max(w, h);
    return { type: 'circle', cx, cy, w: size, h: size, angle: 0, color: stroke.color, selected: false };
  }
  if (type === 'rect') return { type: 'rect', cx, cy, w, h, angle: 0, color: stroke.color, selected: false };
  if (type === 'triangle') return { type: 'triangle', cx, cy, w, h, angle: 0, color: stroke.color, selected: false };
  return null;
}

// Editing interactions (pinch to move/resize/rotate/delete)
let editState = { targetIndex: -1, mode: null };
function getHandles(shape) {
  const { w, h } = shape;
  const halfW = w / 2, halfH = h / 2;
  const handleOffset = 16 * devicePixelRatio;
  return [
    { key: 'top-left', x: -halfW, y: -halfH, color: '#7aa2f7' },
    { key: 'top-right', x: halfW, y: -halfH, color: '#7aa2f7' },
    { key: 'bottom-left', x: -halfW, y: halfH, color: '#7aa2f7' },
    { key: 'bottom-right', x: halfW, y: halfH, color: '#7aa2f7' },
    { key: 'rotate', x: 0, y: -halfH - handleOffset, color: '#ffd166' },
    { key: 'delete', x: halfW + handleOffset, y: -halfH - handleOffset, color: '#ff5a5f' },
  ];
}

function screenToLocal(shape, x, y) {
  const cos = Math.cos(shape.angle || 0);
  const sin = Math.sin(shape.angle || 0);
  const dx = x - shape.cx;
  const dy = y - shape.cy;
  return { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
}

function localToWorld(shape, x, y) {
  const cos = Math.cos(shape.angle || 0);
  const sin = Math.sin(shape.angle || 0);
  return { x: shape.cx + cos * x - sin * y, y: shape.cy + sin * x + cos * y };
}

function handleEditWithHands(results) {
  if (modeSelect.value !== 'edit') return;
  if (!results || !results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    editState = { targetIndex: -1, mode: null };
    return;
  }
  const lm = results.multiHandLandmarks[0];
  const thumb = lm[4];
  const index = lm[8];
  const pinch = distance(thumb, index);
  const isPinching = pinch < 0.05;
  const px = index.x * drawCanvas.width;
  const py = index.y * drawCanvas.height;

  // selection
  let targetIndex = editState.targetIndex;
  if (targetIndex === -1) {
    for (let i = shapes.length - 1; i >= 0; i--) {
      const sh = shapes[i];
      const local = screenToLocal(sh, px, py);
      if (Math.abs(local.x) <= sh.w / 2 && Math.abs(local.y) <= sh.h / 2) {
        targetIndex = i;
        break;
      }
    }
  }

  shapes.forEach((s, i) => (s.selected = i === targetIndex));

  if (targetIndex === -1) return redraw();

  const target = shapes[targetIndex];

  const handles = getHandles(target);
  let activeHandle = null;
  for (const h of handles) {
    const world = localToWorld(target, h.x, h.y);
    const hx = world.x;
    const hy = world.y;
    if (Math.hypot(px - hx, py - hy) < 18 * devicePixelRatio) {
      activeHandle = h;
      break;
    }
  }

  if (isPinching) {
    if (!editState.mode) pushHistory();
    if (activeHandle) {
      editState = { targetIndex, mode: activeHandle.key };
    } else if (!editState.mode) {
      editState = { targetIndex, mode: 'move' };
    }

    const sh = shapes[targetIndex];
    if (editState.mode === 'move') {
      sh.cx = px;
      sh.cy = py;
    } else if (editState.mode === 'rotate') {
      sh.angle = Math.atan2(py - sh.cy, px - sh.cx);
    } else if (editState.mode === 'delete') {
      shapes.splice(targetIndex, 1);
      editState = { targetIndex: -1, mode: null };
    } else {
      // resize handles
      const local = screenToLocal(sh, px, py);
      if (editState.mode.includes('left')) sh.w = Math.max(20, (sh.w / 2 - local.x) + sh.w / 2);
      if (editState.mode.includes('right')) sh.w = Math.max(20, local.x + sh.w / 2);
      if (editState.mode.includes('top')) sh.h = Math.max(20, (sh.h / 2 - local.y) + sh.h / 2);
      if (editState.mode.includes('bottom')) sh.h = Math.max(20, local.y + sh.h / 2);
    }
  } else {
    editState = { targetIndex, mode: null };
  }

  redraw();
}

function insertSuggestedShape(label) {
  const name = label.toLowerCase();
  let type = guessTypeFromLabel(name);
  const size = 220 * devicePixelRatio;
  const sh = { type, cx: drawCanvas.width / 2, cy: drawCanvas.height / 2, w: size, h: size * (type === 'rect' ? 0.75 : 1), angle: 0, color: colorPicker.value, selected: false };
  pushHistory();
  shapes.push(sh);
  redraw();
}

// Change shape type for selected shape in edit mode
shapeTypeSelect.addEventListener('change', () => {
  if (modeSelect.value !== 'edit') return;
  const val = shapeTypeSelect.value;
  if (val === 'auto') return;
  const idx = shapes.findIndex((s) => s.selected);
  if (idx === -1) return;
  pushHistory();
  const s = shapes[idx];
  shapes[idx] = { ...s, type: val };
  redraw();
});

async function main() {
  await setupCamera();

  // Load MediaPipe Hands via script tag dynamically
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js';
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js';
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js';
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });

  const hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    selfieMode: true,
    minDetectionConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  hands.onResults((results) => {
    drawHandsLandmarks(results);
    handleAirDraw(results);
    handleEditWithHands(results);
  });

  const camera = new Camera(video, {
    onFrame: async () => {
      await hands.send({ image: video });
    },
    width: 1280,
    height: 720,
  });
  camera.start();

  // Filters
  function updateFilters() {
    const f = `brightness(${brightness.value}%) contrast(${contrast.value}%) saturate(${saturation.value}%)`;
    video.style.filter = f;
    handsCanvas.style.filter = f;
    drawCanvas.style.filter = f;
    brightnessVal.textContent = brightness.value + '%';
    contrastVal.textContent = contrast.value + '%';
    saturationVal.textContent = saturation.value + '%';
  }
  [brightness, contrast, saturation].forEach((el) => el.addEventListener('input', updateFilters));
  updateFilters();

  // Capture button
  captureBtn.addEventListener('click', () => {
    const off = document.createElement('canvas');
    const rect = drawCanvas.getBoundingClientRect();
    off.width = drawCanvas.width;
    off.height = drawCanvas.height;
    const ctx = off.getContext('2d');
    // Apply filters to snapshot
    ctx.filter = getComputedStyle(video).filter;
    ctx.drawImage(video, 0, 0, off.width, off.height);
    ctx.drawImage(drawCanvas, 0, 0);
    const url = off.toDataURL('image/png');
    const img = document.createElement('img');
    img.src = url;
    gallery.prepend(img);
  });
}

main();


