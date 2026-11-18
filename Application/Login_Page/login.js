// Login page. Stars background comes from ../shared/stars.js.
// Login -> Dashboard (sitemap: Login -> Users Homepage).
// In remote mode LibraAPI.login() calls POST /api/auth/login: the server checks
// the password hash and sets a session cookie. (Mock mode accepts anything.)
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("loginForm");
  const username = document.getElementById("username");
  const password = document.getElementById("password");
  const toggle = document.getElementById("togglePassword");
  const message = document.getElementById("formMessage");

  const say = (text, isInfo = false) => {
    message.textContent = text;
    message.classList.toggle("info", isInfo);
  };

  // Coming from the Registration page after creating an account
  if (new URLSearchParams(window.location.search).get("registered") === "1") {
    say("Account created! Log in with your email and password.", true);
  }

  // ----- Show / hide password -----
  toggle.addEventListener("click", () => {
    const show = password.type === "password";
    password.type = show ? "text" : "password";
    toggle.classList.toggle("active", show);
    toggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
    toggle.title = show ? "Hide password" : "Show password";
  });

  // Clear the error state as soon as the user edits a field
  [username, password].forEach((input) =>
    input.addEventListener("input", () => {
      input.classList.remove("invalid");
      say("");
    })
  );

  // ----- Login -----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const user = username.value.trim();
    const missing = [];
    if (!user) missing.push(username);
    if (!password.value) missing.push(password);
    if (missing.length) {
      missing.forEach((el) => el.classList.add("invalid"));
      missing[0].focus();
      say("Please enter your email and password.");
      return;
    }

    try {
      await window.LibraAPI.login(user, password.value);
      window.location.href = "../Dashboard/dashboard.html";
    } catch (err) {
      console.error(err);
      // Server messages (err.status set) are safe to show, e.g. "Incorrect email or password."
      say(err.status ? err.message : "Couldn't reach the server. Please try again.");
    }
  });

  // ----- Placeholders (need the email service / Google OAuth) -----
  document.getElementById("forgotPassword").addEventListener("click", () => {
    // TODO: send a reset email (VerificationToken type EMAIL)
    say("Password reset is not connected yet.", true);
  });

  document.getElementById("googleLogin").addEventListener("click", () => {
    // TODO: hook up Google OAuth
    say("Google sign-in is not connected yet.", true);
  });
});
