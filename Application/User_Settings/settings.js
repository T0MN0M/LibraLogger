// Settings page (Class: User_Prefs + Miscellaneous from the Component Diagram).
// Stars background comes from ../shared/stars.js; data goes through ../shared/api.js.
document.addEventListener("DOMContentLoaded", async () => {
  const api = window.LibraAPI;
  const $ = (id) => document.getElementById(id);

  const status = $("statusMessage");
  const modal = $("twofaModal");
  const toggle2fa = $("toggle2fa");
  const closeBtn = $("closeModal");
  const confirmBtn = $("confirm2fa");

  const say = (msg, isError = false) => {
    status.style.color = isError ? "var(--error)" : "";
    status.textContent = msg;
  };

  let profile = await api.getProfile();
  renderProfile();

  const version = await api.getAppVersion();
  $("appVersion").textContent = `v${version.version}`;

  // ----- Not-yet-connected actions (need the email service / backend) -----
  document.querySelectorAll("[data-action]").forEach((btn) =>
    btn.addEventListener("click", () => {
      // TODO: hook up once the backend + email service are connected
      say(`${btn.dataset.action} is not connected yet.`);
    })
  );

  // ----- Inline edit: name / nickname / birthday (change_Name, change_NickName, change_Birthday) -----
  document.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => startEdit(btn.dataset.edit, btn))
  );

  function startEdit(key, btn) {
    const dd = btn.parentElement.querySelector("dd");
    if (dd.querySelector("input")) return;

    const input = document.createElement("input");
    input.className = "edit-input";
    input.type = key === "birthday" ? "date" : "text";
    input.value = profile[key] || "";
    if (key === "birthday") input.max = api.util.toISODate(new Date());
    else input.maxLength = key === "nickname" ? 30 : 60;
    input.setAttribute("aria-label", btn.getAttribute("aria-label"));

    dd.classList.remove("empty");
    dd.replaceChildren(input);
    input.focus();

    let done = false;
    const finish = async (save) => {
      if (done) return;
      done = true;
      const value = input.value.trim();
      if (save && key === "user_name" && !value) {
        say("Name can't be empty.", true);
      } else if (save && value !== (profile[key] || "")) {
        profile = await api.updateProfile({ [key]: value });
        say("Saved.");
      }
      renderProfile();
    };

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  // ----- Profile picture (change_PFP) -----
  $("pfpChange").addEventListener("click", () => $("pfpInput").click());
  $("pfpInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      // Shrink to 256px so it fits in localStorage now (and uploads quickly later).
      const dataUrl = await resizeImage(file, 256);
      profile = await api.updateProfile({ profile_picture: dataUrl });
      renderProfile();
      say("Profile picture updated.");
    } catch (err) {
      console.error(err);
      say("Could not use that image.", true);
    }
  });

  // ----- Profile card colors (edit_Profile_Card) -----
  for (const [id, key] of [["profileColor", "profile_color"], ["profileBorder", "profile_border"]]) {
    $(id).addEventListener("input", (e) => {
      profile[key] = e.target.value;
      renderPfpColors();
    });
    $(id).addEventListener("change", async (e) => {
      profile = await api.updateProfile({ [key]: e.target.value });
      say("Profile card colors saved.");
    });
  }

  // ----- 2FA (enable_2FA / disable_2FA) -----
  // Turning on: "Yes" emails a code (step 1), entering that code turns 2FA on (step 2).
  // After that, every login asks for a new emailed code (see Login_Page/login.js).
  const stepConfirm = $("twofaStepConfirm");
  const stepCode = $("twofaStepCode");
  const codeInput = $("twofaCode");
  const codeError = $("twofaError");
  const sendError = $("twofaSendError");
  const resendBtn = $("twofaResend");

  const showCodeStep = (emailHint) => {
    if (emailHint) $("twofaEmail").textContent = emailHint;
    stepConfirm.hidden = true;
    stepCode.hidden = false;
    $("twofaTitle").textContent = "Enter Code";
    codeInput.focus();
  };

  const openModal = () => {
    stepConfirm.hidden = false;
    stepCode.hidden = true;
    stepCode.reset();
    sendError.textContent = "";
    codeError.textContent = "";
    codeInput.classList.remove("invalid");
    $("twofaTitle").textContent = "Confirm 2FA";
    modal.hidden = false;
    confirmBtn.focus();
  };
  const closeModal = () => {
    modal.hidden = true;
    toggle2fa.focus();
  };

  toggle2fa.addEventListener("click", async () => {
    if (!profile.status_2FA) return openModal();
    if (!confirm("Turn off Two-Factor Authentication?")) return;
    try {
      await api.disable2FA();
      profile = await api.getProfile();
      renderProfile();
      say("2FA disabled.");
    } catch (err) {
      console.error(err);
      say(err.status ? err.message : "Couldn't turn off 2FA. Please try again.", true);
    }
  });
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!modal.hidden) closeModal();
    else if (!pwModal.hidden) closePasswordModal();
  });

  // Step 1: "Yes" -> email a code.
  confirmBtn.addEventListener("click", async () => {
    confirmBtn.disabled = true;
    sendError.textContent = "";
    try {
      const { email_hint } = await api.start2FAEnable();
      showCodeStep(email_hint);
    } catch (err) {
      console.error(err);
      // 429 = a code was sent moments ago; it's still valid, so go straight to entering it.
      if (err.status === 429) {
        showCodeStep();
        codeError.textContent = err.message;
      } else {
        sendError.textContent = err.status ? err.message : "Couldn't send the code. Please try again.";
      }
    } finally {
      confirmBtn.disabled = false;
    }
  });

  // Step 2: enter the code -> 2FA on.
  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.replace(/[^\d ]/g, "");
    codeInput.classList.remove("invalid");
    codeError.textContent = "";
  });

  stepCode.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = codeInput.value.replace(/\s/g, "");
    if (!/^\d{6}$/.test(code)) {
      codeInput.classList.add("invalid");
      codeError.textContent = "Enter the 6-digit code from your email.";
      return codeInput.focus();
    }
    const submitBtn = stepCode.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api.confirm2FAEnable(code);
      profile = await api.getProfile();
      closeModal();
      renderProfile();
      say("2FA enabled. You'll be asked for an emailed code each time you log in.");
    } catch (err) {
      console.error(err);
      codeInput.classList.add("invalid");
      codeInput.select();
      codeError.textContent = err.status ? err.message : "Couldn't check the code. Please try again.";
    } finally {
      submitBtn.disabled = false;
    }
  });

  resendBtn.addEventListener("click", async () => {
    resendBtn.disabled = true;
    codeError.textContent = "";
    try {
      const { email_hint } = await api.start2FAEnable();
      showCodeStep(email_hint);
      codeInput.value = "";
    } catch (err) {
      console.error(err);
      codeError.textContent = err.status ? err.message : "Couldn't send a new code. Please try again.";
    } finally {
      resendBtn.disabled = false;
    }
  });

  // ----- Change password -----
  // The real password is stored only as a hash, so it can't be shown here.
  // The eye buttons just reveal what the user is typing into this form.
  const pwModal = $("passwordModal");
  const pwForm = $("passwordForm");
  const pwError = $("passwordError");
  const pwOpenBtn = $("changePassword");
  const currentPw = $("currentPassword");
  const newPw = $("newPassword");
  const confirmPw = $("confirmPassword");
  const pwInputs = [currentPw, newPw, confirmPw];

  const openPasswordModal = () => {
    pwForm.reset();
    pwError.textContent = "";
    pwInputs.forEach((input) => {
      input.type = "password";
      input.classList.remove("invalid");
    });
    pwForm.querySelectorAll(".eye-btn").forEach((btn) => setEyeState(btn, false));
    pwModal.hidden = false;
    currentPw.focus();
  };
  const closePasswordModal = () => {
    pwModal.hidden = true;
    pwOpenBtn.focus();
  };

  function setEyeState(btn, shown) {
    btn.classList.toggle("active", shown);
    btn.setAttribute("aria-label", shown ? "Hide password" : "Show password");
    btn.title = shown ? "Hide password" : "Show password";
  }

  pwOpenBtn.addEventListener("click", openPasswordModal);
  pwModal.querySelector("[data-close-modal]").addEventListener("click", closePasswordModal);
  pwModal.addEventListener("click", (e) => {
    if (e.target === pwModal) closePasswordModal();
  });

  pwForm.querySelectorAll(".eye-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      const input = btn.parentElement.querySelector("input");
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      setEyeState(btn, show);
    })
  );

  pwInputs.forEach((input) => input.addEventListener("input", () => input.classList.remove("invalid")));

  pwForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    pwInputs.forEach((input) => input.classList.remove("invalid"));

    // Same rules as the registration page.
    const fail = (input, msg) => {
      input.classList.add("invalid");
      input.focus();
      pwError.textContent = msg;
    };
    const next = newPw.value;
    if (!currentPw.value) return fail(currentPw, "Enter your current password.");
    if (next.length < 8) return fail(newPw, "Password must be at least 8 characters.");
    if (next.length > 100) return fail(newPw, "Password must be no more than 100 characters.");
    if (!/[A-Z]/.test(next)) return fail(newPw, "Password must contain at least one uppercase letter.");
    if (!/[0-9]/.test(next)) return fail(newPw, "Password must contain at least one number.");
    if (next === currentPw.value) return fail(newPw, "New password must be different from your current one.");
    if (confirmPw.value !== next) return fail(confirmPw, "Passwords don't match.");

    const submitBtn = pwForm.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    try {
      await api.changePassword(currentPw.value, next);
      closePasswordModal();
      say(api.config.mode === "mock" ? "Password updated. (Not saved until the backend is connected.)" : "Password updated.");
    } catch (err) {
      console.error(err);
      fail(currentPw, "Could not change password. Check your current password and try again.");
    } finally {
      submitBtn.disabled = false;
    }
  });

  // ----- Reset data (reset_User_Data) -----
  $("resetData").addEventListener("click", async () => {
    if (!confirm("Reset all of your transactions, budget and profile data?")) return;
    await api.resetUserData();
    profile = await api.getProfile();
    renderProfile();
    say("Your data has been reset.");
  });

  // ----- Delete account (delete_Account) -----
  $("deleteAccount").addEventListener("click", async () => {
    if (!confirm("Permanently delete your account? This cannot be undone.")) return;
    await api.deleteAccount();
    window.location.href = "../Registration_Page/registration.html";
  });

  // ----- Updates (find_Updates) -----
  $("checkUpdates").addEventListener("click", () => {
    // TODO: compare with the latest GitHub release once releases are published
    say(`You're on v${version.version}. Update checks will be available once the backend is live.`);
  });

  // =================================================================
  function renderProfile() {
    $("fieldName").textContent = profile.user_name;
    $("fieldEmail").textContent = profile.user_email;
    setOptional($("fieldNickname"), profile.nickname, "[add nickname]");
    setOptional(
      $("fieldBirthday"),
      profile.birthday && api.util.formatDate(profile.birthday, { month: "long", day: "numeric", year: "numeric" }),
      "[add birthday]"
    );

    $("profileColor").value = profile.profile_color || "#5fe0b7";
    $("profileBorder").value = profile.profile_border || "#e87500";
    renderPfpColors();

    const pfp = $("pfp");
    if (profile.profile_picture) {
      const img = pfp.querySelector("img") || document.createElement("img");
      img.src = profile.profile_picture;
      img.alt = "";
      pfp.replaceChildren(img);
    }

    toggle2fa.textContent = profile.status_2FA ? "Disable 2FA" : "Enable 2FA";
    toggle2fa.classList.toggle("is-on", Boolean(profile.status_2FA));
  }

  function renderPfpColors() {
    const pfp = $("pfp");
    pfp.style.color = profile.profile_color || "";
    pfp.style.borderColor = profile.profile_border || "";
  }

  function setOptional(dd, value, placeholder) {
    dd.textContent = value || placeholder;
    dd.classList.toggle("empty", !value);
  }

  function resizeImage(file, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = size;
        const side = Math.min(img.width, img.height); // center-crop to a square
        canvas
          .getContext("2d")
          .drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }
});
