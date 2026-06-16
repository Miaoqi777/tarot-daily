/* ============================================================
   white-noise.js — 白噪音陪伴系统 (Web Audio API)
   默认关闭 · 点击切换 · 4种自然音效
   ============================================================ */

let audioCtx = null;
let noiseNodes = [];
let noiseGain = null;
let isPlaying = false;
let currentSound = 'rain';

function initWhiteNoise() {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  // Default OFF — do nothing until user clicks
}

function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

// ---------- Pink noise generator (sounds more natural than white) ----------
function createPinkNoise(ctx, duration) {
  const bufSize = ctx.sampleRate * duration;
  const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Paul Kellet's pink noise algorithm
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < bufSize; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return { buffer, data };
}

// ---------- Rain (gentle, layered) ----------
function createRainSound(ctx) {
  const nodes = [];
  // Layer 1: steady gentle rain — pink noise bandpass
  const pink1 = createPinkNoise(ctx, 3);
  const src1 = ctx.createBufferSource();
  src1.buffer = pink1.buffer; src1.loop = true;
  const bp1 = ctx.createBiquadFilter();
  bp1.type = 'bandpass'; bp1.frequency.value = 600; bp1.Q.value = 0.8;
  const g1 = ctx.createGain(); g1.gain.value = 0.25;
  src1.connect(bp1); bp1.connect(g1);
  nodes.push({ source: src1, filter: bp1, gain: g1 });

  // Layer 2: distant rumble — lower bandpass
  const pink2 = createPinkNoise(ctx, 4);
  const src2 = ctx.createBufferSource();
  src2.buffer = pink2.buffer; src2.loop = true;
  const bp2 = ctx.createBiquadFilter();
  bp2.type = 'bandpass'; bp2.frequency.value = 250; bp2.Q.value = 0.5;
  const g2 = ctx.createGain(); g2.gain.value = 0.12;
  src2.connect(bp2); bp2.connect(g2);
  nodes.push({ source: src2, filter: bp2, gain: g2 });

  // Layer 3: occasional larger drops — highpass with random pops
  const bufSize = ctx.sampleRate * 2;
  const buf3 = ctx.createBuffer(1, bufSize, ctx.sampleRate);
  const d3 = buf3.getChannelData(0);
  for (let i = 0; i < bufSize; i++) {
    let s = (Math.random() * 2 - 1) * 0.08;
    if (Math.random() < 0.004) s += (Math.random() * 2 - 1) * 0.6;
    d3[i] = s;
  }
  const src3 = ctx.createBufferSource();
  src3.buffer = buf3; src3.loop = true;
  const hp3 = ctx.createBiquadFilter();
  hp3.type = 'highpass'; hp3.frequency.value = 1500;
  const g3 = ctx.createGain(); g3.gain.value = 0.18;
  src3.connect(hp3); hp3.connect(g3);
  nodes.push({ source: src3, filter: hp3, gain: g3 });

  return nodes;
}

// ---------- Wind (soft, breathing) ----------
function createWindSound(ctx) {
  const nodes = [];
  // Pink noise with slow LFO amplitude modulation
  const pink = createPinkNoise(ctx, 4);
  const src = ctx.createBufferSource();
  src.buffer = pink.buffer; src.loop = true;

  const bp = ctx.createBiquadFilter();
  bp.type = 'lowpass'; bp.frequency.value = 600;

  // LFO for breathing effect on filter
  const lfo = ctx.createOscillator();
  lfo.type = 'sine'; lfo.frequency.value = 0.12;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 350;
  lfo.connect(lfoGain);
  lfoGain.connect(bp.frequency);
  lfo.start();

  // Amplitude LFO for wind gusts
  const ampLfo = ctx.createOscillator();
  ampLfo.type = 'sine'; ampLfo.frequency.value = 0.08;
  const ampLfoGain = ctx.createGain();
  ampLfoGain.gain.value = 0.08;

  const gain = ctx.createGain();
  gain.gain.value = 0.15;
  ampLfo.connect(ampLfoGain);
  ampLfoGain.connect(gain.gain);
  ampLfo.start();

  src.connect(bp);
  bp.connect(gain);
  nodes.push({ source: src, filter: bp, gain, lfo, lfoGain, ampLfo, ampLfoGain });

  // Soft whistle layer
  const whistleBuf = ctx.createBuffer(1, ctx.sampleRate * 6, ctx.sampleRate);
  const wd = whistleBuf.getChannelData(0);
  for (let i = 0; i < whistleBuf.length; i++) {
    const t = i / ctx.sampleRate;
    wd[i] = Math.sin(t * 400 + Math.sin(t * 1.5) * 80) * 0.03 * (0.5 + 0.5 * Math.sin(t * 0.3));
  }
  const ws = ctx.createBufferSource();
  ws.buffer = whistleBuf; ws.loop = true;
  const wg = ctx.createGain(); wg.gain.value = 0.08;
  ws.connect(wg);
  nodes.push({ source: ws, gain: wg });

  return nodes;
}

// ---------- Ocean (soothing waves) ----------
function createOceanSound(ctx) {
  const nodes = [];
  // Pink noise filtered with rhythmic LFO amplitude
  const pink = createPinkNoise(ctx, 3);
  const src = ctx.createBufferSource();
  src.buffer = pink.buffer; src.loop = true;

  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 350; bp.Q.value = 0.6;

  // Wave rhythm — slow sine LFO on gain
  const waveLfo = ctx.createOscillator();
  waveLfo.type = 'sine'; waveLfo.frequency.value = 0.1;
  const waveLfoGain = ctx.createGain();
  waveLfoGain.gain.value = 0.1;
  waveLfo.connect(waveLfoGain);
  waveLfo.start();

  const gain = ctx.createGain();
  gain.gain.value = 0.15;
  waveLfoGain.connect(gain.gain);

  src.connect(bp);
  bp.connect(gain);
  nodes.push({ source: src, filter: bp, gain, waveLfo, waveLfoGain });

  // Secondary wave layer — slightly faster rhythm
  const pink2 = createPinkNoise(ctx, 3);
  const src2 = ctx.createBufferSource();
  src2.buffer = pink2.buffer; src2.loop = true;
  const bp2 = ctx.createBiquadFilter();
  bp2.type = 'lowpass'; bp2.frequency.value = 500;

  const lfo2 = ctx.createOscillator();
  lfo2.type = 'sine'; lfo2.frequency.value = 0.14;
  const lfoGain2 = ctx.createGain();
  lfoGain2.gain.value = 0.06;
  lfo2.connect(lfoGain2);
  lfo2.start();

  const gain2 = ctx.createGain();
  gain2.gain.value = 0.1;
  lfoGain2.connect(gain2.gain);

  src2.connect(bp2);
  bp2.connect(gain2);
  nodes.push({ source: src2, filter: bp2, gain: gain2, lfo2, lfoGain2 });

  return nodes;
}

// ---------- Forest (birds + rustle) ----------
function createForestSound(ctx) {
  const nodes = [];
  // Base rustle — pink noise bandpass
  const pink = createPinkNoise(ctx, 3);
  const src = ctx.createBufferSource();
  src.buffer = pink.buffer; src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 1.2;

  // Rustle LFO
  const rustleLfo = ctx.createOscillator();
  rustleLfo.type = 'triangle'; rustleLfo.frequency.value = 0.6;
  const rustleGain = ctx.createGain();
  rustleGain.gain.value = 0.03;
  rustleLfo.connect(rustleGain);
  rustleLfo.start();

  const gain = ctx.createGain();
  gain.gain.value = 0.1;
  rustleGain.connect(gain.gain);

  src.connect(bp); bp.connect(gain);
  nodes.push({ source: src, filter: bp, gain, rustleLfo, rustleGain });

  // Soft bird chirps — short sine bursts with envelope
  const chirpBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const cd = chirpBuf.getChannelData(0);
  for (let i = 0; i < chirpBuf.length; i++) {
    let s = 0;
    // Create random bird chirps
    if (Math.random() < 0.0006) {
      const start = i;
      const dur = 500 + Math.random() * 1500; // chirp duration in samples
      for (let j = 0; j < dur && (start + j) < chirpBuf.length; j++) {
        const t = j / ctx.sampleRate;
        const freq = 1800 + Math.sin(t * 30) * 600;
        const env = Math.exp(-t * 8);
        cd[start + j] += Math.sin(t * freq * Math.PI * 2) * env * 0.08;
      }
    }
    cd[i] = Math.max(-0.3, Math.min(0.3, cd[i] || 0));
  }

  const cs = ctx.createBufferSource();
  cs.buffer = chirpBuf; cs.loop = true;
  const cg = ctx.createGain(); cg.gain.value = 0.2;
  cs.connect(cg);
  nodes.push({ source: cs, gain: cg });

  return nodes;
}

// ---------- Sound selector (called from UI) ----------
function selectNoiseSound(sound, btn) {
  currentSound = sound;
  if (btn) {
    document.querySelectorAll('.wn-option').forEach(o => o.classList.remove('active'));
    btn.classList.add('active');
  }
  if (isPlaying) {
    stopNoise();
    startNoise();
  }
}

// ---------- Toggle play/pause ----------
function toggleWhiteNoise() {
  if (isPlaying) {
    stopNoise();
    updateNoiseUI();
  } else {
    startNoise();
    updateNoiseUI();
    // Show expanded panel briefly
    const expanded = document.getElementById('wn-expanded');
    if (expanded) expanded.classList.add('visible');
  }
}

function startNoise() {
  if (isPlaying) return;
  const ctx = getAudioContext();
  stopNoiseNodes();

  let nodes;
  switch (currentSound) {
    case 'wind': nodes = createWindSound(ctx); break;
    case 'ocean': nodes = createOceanSound(ctx); break;
    case 'forest': nodes = createForestSound(ctx); break;
    case 'rain':
    default: nodes = createRainSound(ctx); break;
  }

  noiseGain = ctx.createGain();
  const vol = document.getElementById('wn-volume');
  noiseGain.gain.value = vol ? parseInt(vol.value) / 100 * 0.4 : 0.2;

  nodes.forEach(n => {
    n.gain.connect(noiseGain);
    n.source.start(0);
  });

  noiseGain.connect(ctx.destination);
  noiseNodes = nodes;
  isPlaying = true;
}

function stopNoiseNodes() {
  noiseNodes.forEach(n => {
    try { n.source.stop(); } catch (e) {}
    try { if (n.lfo) n.lfo.stop(); } catch (e) {}
    try { if (n.ampLfo) n.ampLfo.stop(); } catch (e) {}
    try { if (n.waveLfo) n.waveLfo.stop(); } catch (e) {}
    try { if (n.lfo2) n.lfo2.stop(); } catch (e) {}
    try { if (n.rustleLfo) n.rustleLfo.stop(); } catch (e) {}
  });
  noiseNodes = [];
}

function stopNoise() {
  stopNoiseNodes();
  if (noiseGain) {
    try { noiseGain.disconnect(); } catch (e) {}
    noiseGain = null;
  }
  isPlaying = false;
}

function setNoiseVolume(value) {
  if (noiseGain) {
    noiseGain.gain.value = parseInt(value) / 100 * 0.4;
  }
}

function updateNoiseUI() {
  const toggle = document.getElementById('wn-toggle');
  const expanded = document.getElementById('wn-expanded');
  if (!toggle) return;

  if (isPlaying) {
    toggle.classList.add('playing');
    toggle.textContent = '[+]';
  } else {
    toggle.classList.remove('playing');
    toggle.textContent = '♪';
    if (expanded) expanded.classList.remove('visible');
  }
}

// ---------- Init: set up click handler properly ----------
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('wn-toggle');
  if (toggle) {
    // Remove old inline handler by cloning
    const newToggle = toggle.cloneNode(true);
    toggle.parentNode.replaceChild(newToggle, toggle);
    newToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleWhiteNoise();
    });
  }

  // Click outside to close panel
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('white-noise-panel');
    if (panel && !panel.contains(e.target)) {
      const expanded = document.getElementById('wn-expanded');
      if (expanded) expanded.classList.remove('visible');
    }
  });
});
