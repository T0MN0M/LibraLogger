// About page: shows app version / data mode (Miscellaneous.find_App_Version).
document.addEventListener("DOMContentLoaded", async () => {
  const info = await window.LibraAPI.getAppVersion();
  document.getElementById("appVersion").textContent = `v${info.version}`;
  document.getElementById("appMode").textContent =
    info.mode === "remote" ? "Live (MySQL)" : "Demo data (browser storage)";
});
