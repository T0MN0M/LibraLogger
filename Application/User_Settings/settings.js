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
  const openModal = () => {
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
    profile = await api.updateProfile({ status_2FA: false });
    renderProfile();
    say("2FA disabled.");
  });
  closeBtn.addEventListener("click", closeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });
  confirmBtn.addEventListener("click", async () => {
    // TODO: backend sends the 2FA test email (VerificationToken type SMS_2FA / EMAIL)
    profile = await api.updateProfile({ status_2FA: true });
    closeModal();
    renderProfile();
    say("2FA enabled. (Test email will be sent once the email service is connected.)");
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
