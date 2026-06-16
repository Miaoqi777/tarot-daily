/* ============================================================
   particles.js — 暗黑奢华金 · Canvas粒子背景
   灵感来源：thefourth.xyz
   ============================================================ */

(function() {
  const canvas = document.getElementById('particles');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let particles = [];
  let animationId;
  let mouseX = -1000;
  let mouseY = -1000;

  // Configuration
  const PARTICLE_COUNT = 60;
  const GOLD_COLORS = [
    'rgba(197, 160, 89, 0.5)',
    'rgba(197, 160, 89, 0.3)',
    'rgba(243, 225, 182, 0.4)',
    'rgba(197, 160, 89, 0.15)',
    'rgba(217, 182, 111, 0.35)'
  ];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function createParticle() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      size: Math.random() * 2 + 0.5,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: -(Math.random() * 0.4 + 0.1),
      opacity: Math.random() * 0.5 + 0.15,
      pulseSpeed: Math.random() * 0.02 + 0.005,
      pulseOffset: Math.random() * Math.PI * 2,
      color: GOLD_COLORS[Math.floor(Math.random() * GOLD_COLORS.length)]
    };
  }

  function initParticles() {
    particles = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push(createParticle());
    }
  }

  function drawParticle(p) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = p.color;

    // Glow effect for larger particles
    if (p.size > 1.2) {
      ctx.shadowColor = 'rgba(197, 160, 89, 0.3)';
      ctx.shadowBlur = 6;
    } else {
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
    }

    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function connectParticles(p1, p2, distance) {
    const maxDist = 150;
    if (distance > maxDist) return;

    const opacity = (1 - distance / maxDist) * 0.08;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = `rgba(197, 160, 89, ${opacity})`;
    ctx.lineWidth = 0.5;
    ctx.stroke();
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];

      // Update position
      p.x += p.speedX;
      p.y += p.speedY;

      // Gentle mouse attraction (very subtle)
      const dx = mouseX - p.x;
      const dy = mouseY - p.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 200 && dist > 0) {
        p.x += dx / dist * 0.1;
        p.y += dy / dist * 0.1;
      }

      // Pulse opacity
      p.currentOpacity = p.opacity + Math.sin(Date.now() * p.pulseSpeed + p.pulseOffset) * 0.1;

      // Wrap around edges
      if (p.x < -10) p.x = canvas.width + 10;
      if (p.x > canvas.width + 10) p.x = -10;
      if (p.y < -10) p.y = canvas.height + 10;
      if (p.y > canvas.height + 10) { p.y = -10; p.x = Math.random() * canvas.width; }

      drawParticle(p);

      // Draw connections to nearby particles
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        const dx2 = p.x - p2.x;
        const dy2 = p.y - p2.y;
        const dist2 = Math.sqrt(dx2 * dx2 + dy2 * dy2);
        connectParticles(p, p2, dist2);
      }
    }

    animationId = requestAnimationFrame(animate);
  }

  // Mouse tracking
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
  });

  document.addEventListener('touchmove', (e) => {
    if (e.touches.length > 0) {
      mouseX = e.touches[0].clientX;
      mouseY = e.touches[0].clientY;
    }
  }, { passive: true });

  // Handle resize
  window.addEventListener('resize', () => {
    resize();
    initParticles();
  });

  // Handle visibility change (pause when hidden)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(animationId);
    } else {
      animate();
    }
  });

  // Start
  resize();
  initParticles();
  animate();
})();
