document.addEventListener("DOMContentLoaded", () => {
  initStars(document.getElementById("stars"));

  const status = document.getElementById("statusMessage");
  const modal = document.getElementById("twofaModal");
  const enableBtn = document.getElementById("enable2fa");
  const closeBtn = document.getElementById("closeModal");
  const confirmBtn = document.getElementById("confirm2fa");

  // ----- Placeholder settings actions (not functional yet) -----
  document.querySelectorAll("[data-action]").forEach((btn) =>
    btn.addEventListener("click", () => {
      // TODO: hook up once the backend is connected
      status.textContent = `${btn.dataset.action} is not connected yet.`;
    })
  );

  // ----- 2FA confirmation popup -----
  const openModal = () => {
    modal.hidden = false;
    confirmBtn.focus();
  };

  const closeModal = () => {
    modal.hidden = true;
    enableBtn.focus();
  };

  enableBtn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);

  // Close when clicking the dark backdrop or pressing Escape
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  confirmBtn.addEventListener("click", () => {
    // TODO: enable 2FA on the backend and send the test email
    closeModal();
    status.textContent = "2FA is not connected yet (no email was sent).";
  });
});

// ----- Black background with moving stars (same as Registration_Page) -----
function initStars(canvas) {
  const ctx = canvas.getContext("2d");
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
      s.y -= s.speed;
      if (s.y < 0) s.y = canvas.height;
      s.alpha = Math.min(1, Math.max(0.2, s.alpha + (Math.random() - 0.5) * 0.05));
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${s.alpha})`;
      ctx.fill();
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener("resize", resize);
  resize();
  draw();
}
