const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');
const overlay = document.querySelector('#overlay');
const cue = document.querySelector('#cue');
const hint = document.querySelector('#hint');
const action = document.querySelector('#action');
const pause = document.querySelector('#pause');
const announcement = document.querySelector('#announcement');
const roundLabel = document.querySelector('#round');
const remainingLabel = document.querySelector('#remaining');
const countLabel = document.querySelector('#count');

const width = 420;
const height = 560;
const headWidth = 174;
const headHeight = 169;
const headTop = 464;
const headAnchor = .44;
const ballRadius = 12;
const headHitRadius = 14;
const spawnY = headTop - 9;
const fixedStep = 1 / 180;
const maxBalls = 5;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const paddlePhoto = new Image();
const kissPhoto = new Image();
kissPhoto.src = './besito-frizado.jpg';
const palette = [
  ['#ff91b9', '#7b284c'], ['#ffbd74', '#79402e'],
  ['#e9f88c', '#4e6632'], ['#bca7fa', '#493b7a'],
  ['#9ee9e3', '#2c6668']
];
const messages = {
  ready: ['La frente al rescate', 'Desliza a Noemí y rompe todos los bloques.', 'Lanzar bolita'],
  retry: ['¡Rebota otra vez!', 'Los bloques rotos se quedan rotos.', 'Lanzar otra bolita'],
  mosaic: ['¡Ahora rompe el besito!', 'Dale al mosaico de Josesito pieza por pieza.', 'Romper el besito'],
  paused: ['En pausa', '', 'Seguir jugando'],
  won: ['¡Josesito quedó en pedacitos!', 'Victoria de NoemiMonster ♡', 'Jugar otra vez']
};

const keys = new Set();
const particles = [];
let round = 1;
let remaining = 0;
let tiles = [];
let balls = [];
let paddle = width / 2;
let previousPaddle = paddle;
let headOutline = [];
let headLeft = 0;
let headRight = 0;
let pointer = null;
let mode = 'ready';
let audio;

function clamp(n, min, max) { return Math.max(min, Math.min(n, max)); }
function aim(x) {
  const margin = headHitRadius + ballRadius + 1;
  paddle = clamp(x, margin - headLeft, width - margin - headRight);
}

function traceHead() {
  const mask = document.createElement('canvas');
  mask.width = headWidth;
  mask.height = height - headTop + headHitRadius + 2;
  const pixels = mask.getContext('2d');
  pixels.drawImage(paddlePhoto, 0, 0, headWidth, headHeight);
  const { data } = pixels.getImageData(0, 0, mask.width, mask.height);
  const left = [];
  const right = [];
  const offset = headWidth * headAnchor;
  for (let y = 0; y < mask.height; y += 2) {
    let first = -1;
    let last = -1;
    for (let x = 0; x < mask.width; x++) {
      if (data[(y * mask.width + x) * 4 + 3] < 128) continue;
      if (first < 0) first = x;
      last = x;
    }
    if (first < 0) continue;
    left.push({ x: first - offset, y: headTop + y });
    right.push({ x: last + 1 - offset, y: headTop + y });
  }
  headOutline = left.concat(right.reverse());
  headLeft = Math.min(...headOutline.map(point => point.x));
  headRight = Math.max(...headOutline.map(point => point.x));
  aim(paddle);
}
paddlePhoto.addEventListener('load', traceHead);
paddlePhoto.src = './noemi.webp';

function headContact(ball) {
  const x = ball.x - paddle;
  const y = ball.y;
  if (!headOutline.length || y < headTop - headHitRadius || y >= height ||
      x < headLeft - headHitRadius || x > headRight + headHitRadius) return null;

  let inside = false;
  let nearest;
  let distanceSquared = Infinity;
  for (let i = 0; i < headOutline.length; i++) {
    const a = headOutline[i];
    const b = headOutline[(i + 1) % headOutline.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) continue;
    if ((a.y > y) !== (b.y > y) && x < a.x + dx * (y - a.y) / dy) inside = !inside;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / lengthSquared, 0, 1);
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const d = (x - px) ** 2 + (y - py) ** 2;
    if (d >= distanceSquared) continue;
    distanceSquared = d;
    const length = Math.sqrt(lengthSquared);
    nearest = { x: px, y: py, nx: -dy / length, ny: dx / length };
  }
  if (!nearest || (!inside && distanceSquared > headHitRadius ** 2)) return null;
  if (!inside && distanceSquared > 0) {
    const distance = Math.sqrt(distanceSquared);
    nearest.nx = (x - nearest.x) / distance;
    nearest.ny = (y - nearest.y) / distance;
  }
  return { ...nearest, x: nearest.x + paddle, inside };
}

function bounceOffHead(ball, paddleSpeed) {
  const contact = headContact(ball);
  if (!contact) return;
  const { x, y, nx, ny, inside } = contact;
  if (!inside && (ball.vx - paddleSpeed) * nx + ball.vy * ny >= 0) return;
  const side = x < paddle ? -headLeft : headRight;
  const angle = clamp((x - paddle) / side, -1, 1) * 1.07;
  const speed = clamp(Math.hypot(ball.vx, ball.vy) + 9, 365, 480);
  const gap = headHitRadius + .75;
  ball.x = x + nx * gap;
  ball.y = y + ny * gap;
  ball.vx = Math.sin(angle) * speed;
  if (Math.abs(ball.vx) < 62) ball.vx = ball.vx < 0 ? -62 : 62;
  ball.vy = -Math.cos(angle) * speed;
  const inwardSpeed = ball.vx * nx + ball.vy * ny;
  if (inwardSpeed < 0) {
    ball.vx -= 2 * inwardSpeed * nx;
    ball.vy = -Math.abs(ball.vy - 2 * inwardSpeed * ny);
  }
  scatter(x, y, '#ffd2a6', 7);
  chirp(330, 530, .09, .045);
}

function chirp(from, to, duration = .12, volume = .055) {
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  try {
    audio ||= new Audio();
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    const time = audio.currentTime;
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.type = 'triangle';
    tone.frequency.setValueAtTime(from, time);
    tone.frequency.exponentialRampToValueAtTime(to, time + duration);
    gain.gain.setValueAtTime(.001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + .012);
    gain.gain.exponentialRampToValueAtTime(.001, time + duration);
    tone.connect(gain).connect(audio.destination);
    tone.start(time);
    tone.stop(time + duration + .015);
  } catch { /* El juego también funciona sin audio. */ }
}

function setMode(next, focus = true) {
  mode = next;
  const playing = mode === 'playing';
  overlay.hidden = playing;
  pause.hidden = !playing;
  if (playing) {
    if (focus && document.activeElement === action) pause.focus({ preventScroll: true });
    return;
  }
  const [title, instruction, button] = messages[mode];
  cue.textContent = title;
  hint.textContent = instruction;
  hint.hidden = !instruction;
  action.textContent = button;
  announcement.textContent = title;
  if (focus) cue.focus({ preventScroll: true });
}

function updateHud() {
  roundLabel.textContent = `${round} / 2`;
  remainingLabel.textContent = remaining;
  countLabel.textContent = balls.length || (mode === 'won' ? 0 : 1);
}

function buildRound(number) {
  round = number;
  const rows = round === 1 ? 4 : 5;
  const columns = 6;
  const tileWidth = 62;
  const tileHeight = round === 1 ? 42 : 51;
  tiles = Array.from({ length: rows * columns }, (_, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    return { col, row, columns, rows, x: 24 + col * tileWidth, y: 26 + row * tileHeight,
      w: tileWidth - 3, h: tileHeight - 3, alive: true, bonus: index % 7 === 3 };
  });
  remaining = tiles.length;
  balls = [];
  updateHud();
}

function launch() {
  if (mode === 'won') {
    particles.length = 0;
    aim(width / 2);
    buildRound(1);
  }
  if (mode !== 'paused') {
    const vx = paddle > width / 2 ? -138 : 138;
    balls = [{ x: paddle, y: spawnY, vx, vy: -351, spin: 0 }];
    updateHud();
  }
  setMode('playing');
  chirp(435, 660);
}

function scatter(x, y, color, amount) {
  if (reducedMotion.matches) return;
  for (let i = 0; i < amount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 35 + Math.random() * 165;
    particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      life: .25 + Math.random() * .46, size: 2 + Math.random() * 8, color });
  }
}

function hitTile(tile, ball, previousX, previousY, spawned) {
  const nearX = clamp(ball.x, tile.x, tile.x + tile.w);
  const nearY = clamp(ball.y, tile.y, tile.y + tile.h);
  if ((ball.x - nearX) ** 2 + (ball.y - nearY) ** 2 > ballRadius ** 2) return false;
  const sideX = previousX < tile.x || previousX > tile.x + tile.w;
  const sideY = previousY < tile.y || previousY > tile.y + tile.h;
  if (sideX && (!sideY || Math.abs(ball.x - nearX) > Math.abs(ball.y - nearY))) {
    ball.x = previousX;
    ball.vx *= -1;
  } else {
    ball.y = previousY;
    ball.vy *= -1;
  }
  tile.alive = false;
  remaining--;
  if (remaining > 0 && tile.bonus && balls.length + spawned.length < maxBalls) {
    const splitX = (ball.vx >= 0 ? -1 : 1) * (175 + Math.random() * 75);
    spawned.push({ x: ball.x, y: ball.y, vx: splitX, vy: Math.sign(ball.vy) * 315, spin: -ball.spin });
    chirp(510, 1020, .19);
  } else {
    chirp(445 + (tile.row * 45), 225, .1, .045);
  }
  scatter(tile.x + tile.w / 2, tile.y + tile.h / 2, palette[tile.row][0], tile.bonus ? 12 : 7);
  updateHud();
  return true;
}

function step(dt) {
  const steer = Number(keys.has('ArrowRight')) - Number(keys.has('ArrowLeft'));
  if (steer && mode !== 'paused' && mode !== 'won') aim(paddle + steer * 435 * dt);
  const paddleSpeed = (paddle - previousPaddle) / dt;
  previousPaddle = paddle;

  for (const p of particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 235 * dt;
  }
  while (particles.length && particles[0].life <= 0) particles.shift();
  if (mode !== 'playing') return;

  const spawned = [];
  for (const ball of balls) {
    const previousX = ball.x;
    const previousY = ball.y;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.spin += ball.vx * dt * .009;
    if (ball.x < ballRadius || ball.x > width - ballRadius) {
      ball.x = clamp(ball.x, ballRadius, width - ballRadius);
      ball.vx *= -1;
    }
    if (ball.y < ballRadius) {
      ball.y = ballRadius;
      ball.vy = Math.abs(ball.vy);
    }
    bounceOffHead(ball, paddleSpeed);
    for (const tile of tiles) {
      if (tile.alive && hitTile(tile, ball, previousX, previousY, spawned)) break;
    }
    if (remaining === 0) {
      balls = [];
      if (round === 1) {
        buildRound(2);
        setMode('mosaic');
        chirp(330, 875, .35);
      } else {
        scatter(width / 2, height * .36, '#ff93d2', 36);
        setMode('won');
        updateHud();
        chirp(390, 1060, .47);
      }
      return;
    }
  }
  const active = balls.filter(ball => ball.y < height + ballRadius);
  if (active.length !== balls.length || spawned.length) {
    balls = [...active, ...spawned];
    updateHud();
  }
  if (!balls.length) setMode('retry');
}

function drawTile(tile) {
  const [light, dark] = palette[tile.row];
  ctx.beginPath();
  ctx.roundRect(tile.x, tile.y, tile.w, tile.h, round === 1 ? 8 : 2);
  if (round === 2 && kissPhoto.complete && kissPhoto.naturalWidth) {
    const sw = kissPhoto.naturalWidth / tile.columns;
    const sh = kissPhoto.naturalHeight / tile.rows;
    ctx.save();
    ctx.clip();
    ctx.drawImage(kissPhoto, sw * tile.col, sh * tile.row, sw, sh, tile.x, tile.y, tile.w, tile.h);
    ctx.fillStyle = '#de81fa12';
    ctx.fillRect(tile.x, tile.y, tile.w, tile.h);
    ctx.restore();
    ctx.strokeStyle = '#f6c0ff88';
  } else {
    const sheen = ctx.createLinearGradient(tile.x, tile.y, tile.x + 8, tile.y + tile.h);
    sheen.addColorStop(0, light);
    sheen.addColorStop(1, dark);
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.strokeStyle = '#ffeaf4ac';
    ctx.fillStyle = '#fff8e653';
    ctx.fillRect(tile.x + 8, tile.y + 5, tile.w - 16, 2);
  }
  ctx.lineWidth = 1.25;
  ctx.stroke();
  if (tile.bonus) {
    ctx.fillStyle = round === 1 ? '#25162fd9' : '#260d3577';
    ctx.beginPath();
    ctx.arc(tile.x + tile.w / 2, tile.y + tile.h / 2, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff3e3';
    ctx.lineWidth = 2;
    const x = tile.x + tile.w / 2;
    const y = tile.y + tile.h / 2;
    ctx.fillRect(x - 4, y - 1, 8, 2);
    ctx.fillRect(x - 1, y - 4, 2, 8);
  }
}

function drawBall(ball) {
  ctx.save();
  ctx.translate(ball.x, ball.y);
  ctx.rotate(Math.sin(ball.spin) * .37);
  ctx.shadowColor = '#ed87b984';
  ctx.shadowBlur = 12;
  const blush = ctx.createLinearGradient(0, -12, 0, 14);
  blush.addColorStop(0, '#fff0cb');
  blush.addColorStop(.54, '#ffb088');
  blush.addColorStop(1, '#fa7491');
  ctx.fillStyle = blush;
  ctx.strokeStyle = '#6a2d53';
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-7, -11);
  ctx.quadraticCurveTo(0, -9, 7, -11);
  ctx.bezierCurveTo(9, -5, 16, -5, 16, 3);
  ctx.bezierCurveTo(16, 13, 5, 16, 0, 6);
  ctx.bezierCurveTo(-5, 16, -16, 13, -16, 3);
  ctx.bezierCurveTo(-16, -5, -9, -5, -7, -11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#9b4160';
  ctx.lineWidth = 2.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(1, -4);
  ctx.bezierCurveTo(-2.5, -.5, -1.2, 4, 0, 6);
  ctx.stroke();
  ctx.fillStyle = '#f7708488';
  ctx.beginPath();
  ctx.ellipse(-9, 5, 4.1, 2.5, .25, 0, 2 * Math.PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9, 5, 4.1, 2.5, -.25, 0, 2 * Math.PI);
  ctx.fill();
  ctx.fillStyle = '#fff4dbc7';
  ctx.beginPath();
  ctx.ellipse(-9, 0, 3.2, 1.5, -.5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(9, 0, 3.2, 1.5, .5, 0, 2 * Math.PI);
  ctx.fill();
  ctx.restore();
}

function drawPaddle() {
  if (!paddlePhoto.complete || !paddlePhoto.naturalWidth) return;
  ctx.save();
  ctx.shadowColor = '#df93c75c';
  ctx.shadowBlur = 12;
  ctx.drawImage(paddlePhoto, paddle - headWidth * headAnchor, headTop, headWidth, headHeight);
  ctx.restore();
}

function draw() {
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  const backdrop = ctx.createLinearGradient(0, 0, width, height);
  backdrop.addColorStop(0, '#211629');
  backdrop.addColorStop(1, '#171225');
  ctx.fillStyle = backdrop;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#d4a1e222';
  for (let y = 12; y < height; y += 16) {
    for (let x = 12; x < width; x += 16) ctx.fillRect(x, y, 1.4, 1.4);
  }
  for (const tile of tiles) if (tile.alive) drawTile(tile);
  drawPaddle();
  if (balls.length) {
    for (const ball of balls) drawBall(ball);
  } else if (mode !== 'won') drawBall({ x: paddle, y: spawnY, spin: 0 });
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life * 2.4, 0, 1);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size * .66);
  }
  ctx.globalAlpha = 1;
}

function moveToPointer(event) {
  const rect = canvas.getBoundingClientRect();
  aim((event.clientX - rect.left) * width / rect.width);
}

canvas.addEventListener('pointerdown', event => {
  if (pointer !== null || mode === 'paused' || mode === 'won') return;
  pointer = event.pointerId;
  canvas.setPointerCapture(pointer);
  moveToPointer(event);
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId === pointer || (event.pointerType === 'mouse' && mode === 'playing')) moveToPointer(event);
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  canvas.addEventListener(name, event => {
    if (event.pointerId === pointer) pointer = null;
  });
}

window.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    keys.add(event.key);
  }
  if (event.code === 'Space' && !event.target.closest('button, a')) {
    event.preventDefault();
    if (!event.repeat) {
      if (mode === 'playing') setMode('paused');
      else launch();
    }
  }
});
window.addEventListener('keyup', event => keys.delete(event.key));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('visibilitychange', () => {
  keys.clear();
  if (document.hidden && mode === 'playing') setMode('paused', false);
});
action.addEventListener('click', launch);
pause.addEventListener('click', () => setMode('paused'));

new ResizeObserver(() => {
  const rect = canvas.getBoundingClientRect();
  const density = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(rect.width * density));
  canvas.height = Math.max(1, Math.round(rect.height * density));
  draw();
}).observe(canvas);

let lastFrame;
let elapsed = 0;
function frame(now) {
  if (lastFrame !== undefined) elapsed += Math.min(.033, (now - lastFrame) / 1000);
  lastFrame = now;
  while (elapsed >= fixedStep) {
    step(fixedStep);
    elapsed -= fixedStep;
  }
  draw();
  requestAnimationFrame(frame);
}

buildRound(1);
setMode('ready', false);
requestAnimationFrame(frame);
