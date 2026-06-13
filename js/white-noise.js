/* ============================================================
   white-noise.js — 白噪音陪伴系统 (Web Audio API 合成)
   ============================================================ */

let audioCtx = null;
let noiseNodes = {};
let noiseGain = null;
let isPlaying = false;
let currentSound = 'rain';

function initWhiteNoise() {
  // Check for Web Audio API support
  if (!window.AudioContext && !window.webkitAudioContext) {
    console.log('Web Audio API not supported');
    return;
  }
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

// ---------- Sound Generators ----------

function createRainSound(ctx) {
  const nodes = [];

  // Create 3 layers of rain
  for (let layer = 0; layer < 3; layer++) {
    const bufferSize = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      // Filtered white noise with random pops
      let sample = (Math.random() * 2 - 1) * 0.3;
      if (Math.random() < 0.003 * (layer + 1)) {
        sample += (Math.random() * 2 - 1) * (0.5 + layer * 0.2);
      }
      data[i] = sample;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3000 + layer * 1000;

    const gain = ctx.createGain();
    gain.gain.value = 0.25 - layer * 0.05;

    source.connect(filter);
    filter.connect(gain);
    nodes.push({ source, filter, gain });
  }

  return nodes;
}

function createWindSound(ctx) {
  const nodes = [];
  const bufferSize = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    let sample = (Math.random() * 2 - 1) * 0.2;
    // Slow amplitude modulation
    const mod = Math.sin(i * 0.0003) * 0.5 + 0.5;
    sample *= mod;
    data[i] = sample;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  // Low pass filter for wind
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;

  // LFO for filter modulation
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.15;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 400;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();

  const gain = ctx.createGain();
  gain.gain.value = 0.3;

  source.connect(filter);
  filter.connect(gain);
  nodes.push({ source, filter, gain, lfo, lfoGain });

  return nodes;
}

function createOceanSound(ctx) {
  const nodes = [];
  const bufferSize = ctx.sampleRate * 3;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < bufferSize; i++) {
    let sample = (Math.random() * 2 - 1) * 0.15;
    // Rhythmic amplitude — simulate wave patterns
    const wave = Math.sin(i * 0.001) * 0.5 + 0.5;
    const wave2 = Math.sin(i * 0.0023 + 1.5) * 0.3 + 0.7;
    sample *= wave * wave2;
    data[i] = sample;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1200;

  const gain = ctx.createGain();
  gain.gain.value = 0.4;

  source.connect(filter);
  filter.connect(gain);
  nodes.push({ source, filter, gain });

  return nodes;
}

function createForestSound(ctx) {
  const nodes = [];

  // Base ambient noise
  const ambBufSize = ctx.sampleRate * 3;
  const ambBuffer = ctx.createBuffer(1, ambBufSize, ctx.sampleRate);
  const ambData = ambBuffer.getChannelData(0);

  for (let i = 0; i < ambBufSize; i++) {
    let sample = (Math.random() * 2 - 1) * 0.1;
    // Rustling leaves modulation
    const rustle = Math.sin(i * 0.005) * 0.5 + 0.5;
    sample *= rustle;
    ambData[i] = sample;
  }

  const ambSource = ctx.createBufferSource();
  ambSource.buffer = ambBuffer;
  ambSource.loop = true;

  const ambFilter = ctx.createBiquadFilter();
  ambFilter.type = 'bandpass';
  ambFilter.frequency.value = 2000;
  ambFilter.Q.value = 1.5;

  const ambGain = ctx.createGain();
  ambGain.gain.value = 0.15;

  ambSource.connect(ambFilter);
  ambFilter.connect(ambGain);
  nodes.push({ source: ambSource, filter: ambFilter, gain: ambGain });

  // Occasional bird chirps
  const chirpBufSize = ctx.sampleRate * 1;
  const chirpBuffer = ctx.createBuffer(1, chirpBufSize, ctx.sampleRate);
  const chirpData = chirpBuffer.getChannelData(0);

  for (let i = 0; i < chirpBufSize; i++) {
    let sample = 0;
    if (Math.random() < 0.0008) {
      const t = (i % 4000) / ctx.sampleRate;
      sample = Math.sin(t * 3000 + Math.sin(t * 800) * 5) * Math.exp(-t * 15) * 0.3;
    }
    chirpData[i] = sample;
  }

  const chirpSource = ctx.createBufferSource();
  chirpSource.buffer = chirpBuffer;
  chirpSource.loop = true;

  const chirpFilter = ctx.createBiquadFilter();
  chirpFilter.type = 'highpass';
  chirpFilter.frequency.value = 2500;

  const chirpGain = ctx.createGain();
  chirpGain.gain.value = 0.2;

  chirpSource.connect(chirpFilter);
  chirpFilter.connect(chirpGain);
  nodes.push({ source: chirpSource, filter: chirpFilter, gain: chirpGain });

  return nodes;
}

// ---------- Player Control ----------

function selectNoiseSound(sound, btn) {
  currentSound = sound;

  // Update UI
  if (btn) {
    document.querySelectorAll('.wn-option').forEach(o => o.classList.remove('active'));
    btn.classList.add('active');
  }

  if (isPlaying) {
    stopNoise();
    startNoise();
  }
}

function toggleWhiteNoise() {
  if (isPlaying) {
    stopNoise();
  } else {
    startNoise();
  }
}

function startNoise() {
  const ctx = getAudioContext();

  // Stop any existing
  stopNoiseNodes();

  let nodes;
  switch (currentSound) {
    case 'wind': nodes = createWindSound(ctx); break;
    case 'ocean': nodes = createOceanSound(ctx); break;
    case 'forest': nodes = createForestSound(ctx); break;
    case 'rain':
    default: nodes = createRainSound(ctx); break;
  }

  // Master gain
  noiseGain = ctx.createGain();
  const vol = document.getElementById('wn-volume');
  noiseGain.gain.value = vol ? parseInt(vol.value) / 100 * 0.6 : 0.24;

  nodes.forEach(n => {
    n.gain.connect(noiseGain);
    n.source.start();
  });

  noiseGain.connect(ctx.destination);
  noiseNodes = { nodes, type: currentSound };

  isPlaying = true;
  updateNoiseUI();
}

function stopNoiseNodes() {
  if (noiseNodes.nodes) {
    noiseNodes.nodes.forEach(n => {
      try {
        n.source.stop();
        if (n.lfo) n.lfo.stop();
      } catch (e) {}
    });
  }
  noiseNodes = {};
}

function stopNoise() {
  stopNoiseNodes();
  if (noiseGain) {
    noiseGain.disconnect();
    noiseGain = null;
  }
  isPlaying = false;
  updateNoiseUI();
}

function setNoiseVolume(value) {
  if (noiseGain) {
    noiseGain.gain.value = parseInt(value) / 100 * 0.6;
  }
}

function updateNoiseUI() {
  const toggle = document.getElementById('wn-toggle');
  const expanded = document.getElementById('wn-expanded');

  if (isPlaying) {
    toggle.classList.add('playing');
    toggle.textContent = '🎵';
    expanded.classList.add('visible');
  } else {
    toggle.classList.remove('playing');
    toggle.textContent = '🎵';
    expanded.classList.remove('visible');
  }
}

// Toggle expanded panel
document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.getElementById('wn-toggle');
  if (toggle) {
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const expanded = document.getElementById('wn-expanded');
      expanded.classList.toggle('visible');
    });
  }

  // Click outside to close
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('white-noise-panel');
    if (panel && !panel.contains(e.target)) {
      document.getElementById('wn-expanded').classList.remove('visible');
    }
  });
});
