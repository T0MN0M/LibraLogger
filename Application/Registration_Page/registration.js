document.addEventListener("DOMContentLoaded", () => {
  initStars(document.getElementById("stars"));

  const form = document.getElementById("registerForm");
  const message = document.getElementById("formMessage");
  const password = document.getElementById("password");
  const toggle = document.getElementById("togglePassword");
  const month = document.getElementById("dobMonth");
  const day = document.getElementById("dobDay");
  const year = document.getElementById("dobYear");

  // ----- Show / hide password -----
  toggle.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.classList.toggle("active", show);
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.title = show ? "Hide password" : "Show password";
  });

  // ----- Date of birth: digits only, auto-advance MM -> DD -> YYYY -----
  [[month, day], [day, year], [year, null]].forEach(([field, next]) => {
    field.addEventListener("input", () => {
      field.value = field.value.replace(/\D/g, "");
      if (next && field.value.length === field.maxLength) next.focus();
    });
  });

  // Clear the error state on a field as soon as the user edits it
  form.querySelectorAll("input").forEach((input) =>
    input.addEventListener("input", () => input.classList.remove("invalid"))
  );

  // ----- Validation (front-end only; no database yet) -----
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    form.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
    message.classList.remove("success");

    const errors = [];
    const fail = (el, msg) => {
      el.classList.add("invalid");
      errors.push(msg);
    };

    const first = form.firstName;
    const last = form.lastName;
    const email = form.email;

    if (!first.value.trim()) fail(first, "First name is required.");
    if (!last.value.trim()) fail(last, "Last name is required.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) fail(email, "Enter a valid email address.");
    if (password.value.length < 8) fail(password, "Password must be at least 8 characters.");

    if (!isValidDate(month.value, day.value, year.value)) {
      [month, day, year].forEach((el) => el.classList.add("invalid"));
      errors.push("Enter a valid date of birth.");
    }

    if (errors.length) {
      message.textContent = errors[0];
      return;
    }

    // TODO: send to backend once the database is connected
    const data = {
      firstName: first.value.trim(),
      lastName: last.value.trim(),
      email: email.value.trim(),
      dob: `${year.value}-${month.value.padStart(2, "0")}-${day.value.padStart(2, "0")}`,
    };
    console.log("Registration data (not submitted yet):", data);
    message.textContent = "Looks good! (Account creation not connected yet.)";
    message.classList.add("success");
  });

  // ----- Google sign-up placeholder -----
  document.getElementById("googleSignUp").addEventListener("click", () => {
    // TODO: hook up Google OAuth
    message.classList.remove("success");
    message.textContent = "Google sign-up is not connected yet.";
  });
});

function isValidDate(mm, dd, yyyy) {
  const m = Number(mm), d = Number(dd), y = Number(yyyy);
  if (!m || !d || yyyy.length !== 4) return false;
  const date = new Date(y, m - 1, d);
  const real = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  return real && y >= 1900 && date <= new Date();
}

// ----- Black background with moving stars (based on LibraSide_DRAFT/js/main.js) -----
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
