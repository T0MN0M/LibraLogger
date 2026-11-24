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
  const params = new URLSearchParams(window.location.search);
  if (params.get("registered") === "1") {
    say("Account created! Log in with your email and password.", true);
  }
  // The server sends us back here with ?google_error=... if Google sign-in failed
  if (params.get("google_error")) say(params.get("google_error"));

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
      const result = await window.LibraAPI.login(user, password.value);
      // 2FA on: the server emailed a code instead of logging in.
      if (result && result.two_factor_required) return showCodeStep(result.email_hint);
      window.location.href = "../Dashboard/dashboard.html";
    } catch (err) {
      console.error(err);
      // Server messages (err.status set) are safe to show, e.g. "Incorrect email or password."
      say(err.status ? err.message : "Couldn't reach the server. Please try again.");
    }
  });

  // ----- 2FA: enter the code emailed after the password (or Google) check -----
  const twofaForm = document.getElementById("twofaForm");
  const codeInput = document.getElementById("twofaCode");
  const twofaMessage = document.getElementById("twofaMessage");
  const resendBtn = document.getElementById("twofaResend");
  // Things that belong to the password step and are hidden during the code step.
  const passwordStep = [form, document.querySelector(".divider"), document.getElementById("googleLogin"), document.querySelector(".switch-link")];

  const sayCode = (text, isInfo = false) => {
    twofaMessage.textContent = text;
    twofaMessage.classList.toggle("info", isInfo);
  };

  function showCodeStep(emailHint) {
    if (emailHint) document.getElementById("twofaEmail").textContent = emailHint;
    passwordStep.forEach((el) => el && (el.hidden = true));
    twofaForm.hidden = false;
    twofaForm.reset();
    sayCode("");
    codeInput.focus();
  }

  function showPasswordStep(text) {
    twofaForm.hidden = true;
    passwordStep.forEach((el) => el && (el.hidden = false));
    password.value = "";
    say(text || "");
    (username.value ? password : username).focus();
  }

  // Coming back from Google sign-in with 2FA on.
  if (params.get("twofa") === "1") {
    history.replaceState(null, "", window.location.pathname);
    showCodeStep();
  }

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/[^\d ]/g, "");
    codeInput.classList.remove("invalid");
    sayCode("");
  });

  twofaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = codeInput.value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      codeInput.classList.add("invalid");
      codeInput.focus();
      return sayCode("Enter the 6-digit code from your email.");
    }
    const submitBtn = twofaForm.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      await window.LibraAPI.verifyLogin2FA(code);
      window.location.href = "../Dashboard/dashboard.html";
    } catch (err) {
      console.error(err);
      // 401 = this login attempt expired or ran out of tries: start over.
      if (err.status === 401) return showPasswordStep(err.message);
      codeInput.classList.add("invalid");
      codeInput.select();
      sayCode(err.status ? err.message : "Couldn't reach the server. Please try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  resendBtn.addEventListener("click", async () => {
    resendBtn.disabled = true;
    try {
      const { email_hint } = await window.LibraAPI.resendLogin2FA();
      if (email_hint) document.getElementById("twofaEmail").textContent = email_hint;
      codeInput.value = "";
      codeInput.focus();
      sayCode("A new code is on its way.", true);
    } catch (err) {
      console.error(err);
      if (err.status === 401) return showPasswordStep(err.message);
      sayCode(err.status ? err.message : "Couldn't reach the server. Please try again.");
    } finally {
      resendBtn.disabled = false;
    }
  });

  document.getElementById("twofaBack").addEventListener("click", () => showPasswordStep());

  // ----- Placeholder (needs the email service) -----
  document.getElementById("forgotPassword").addEventListener("click", () => {
    // TODO: send a reset email (VerificationToken type EMAIL)
    say("Password reset is not connected yet.", true);
  });

  // ----- Google: the server handles the whole OAuth flow (backend/google.js) -----
  document.getElementById("googleLogin").addEventListener("click", () => {
    window.location.href = "/api/auth/google";
  });
});
