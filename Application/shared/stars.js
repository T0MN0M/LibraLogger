// Black background with moving stars (shared by every app page).
// Usage: <canvas id="stars"></canvas> + <script src="../shared/stars.js" defer></script>
(function () {
  function initStars(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let stars = [];

    function resize() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      const count = Math.round((canvas.width * canvas.height) / 6000);
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.5 + 0.3,
        speed: Math.random() * 0.3 + 0.05,
        alpha: Math.random(),
      }));
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const s of stars) {
        if (!reduceMotion) {
          s.y -= s.speed;
          if (s.y < 0) s.y = canvas.height;
          s.alpha = Math.min(1, Math.max(0.2, s.alpha + (Math.random() - 0.5) * 0.05));
        }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
        ctx.fill();
      }
      if (!reduceMotion) requestAnimationFrame(draw);
    }

    window.addEventListener("resize", () => {
      resize();
      if (reduceMotion) draw();
    });
    resize();
    draw();
  }

  window.initStars = initStars;
  document.addEventListener("DOMContentLoaded", () => initStars(document.getElementById("stars")));
})();
