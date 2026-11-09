// Shared behavior for the top bar + bottom nav on every logged-in page.
// Requires shared/api.js to be loaded first.
document.addEventListener("DOMContentLoaded", () => {
  // Logout (top-left): clear the session, then follow the link to the Login page.
  document.querySelectorAll("[data-logout]").forEach((link) =>
    link.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        await window.LibraAPI?.logout();
      } catch (err) {
        console.warn("Logout request failed; redirecting anyway.", err);
      }
      window.location.href = link.href;
    })
  );
});
