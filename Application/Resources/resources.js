// Resources page: "Saving money at UTD" (Resource.find_Resources / open_Link).
document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.getElementById("resourceGrid");
  const search = document.getElementById("resourceSearch");
  const filterGroup = document.getElementById("resourceFilter");
  let filter = "";

  const resources = await window.LibraAPI.getResources();

  search.addEventListener("input", render);
  filterGroup.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-filter]");
    if (!btn) return;
    filter = btn.dataset.filter;
    filterGroup.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    render();
  });

  render();

  function render() {
    const q = search.value.trim().toLowerCase();
    const list = resources.filter(
      (r) =>
        (!filter || r.category === filter) &&
        (!q || r.resource_name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q))
    );

    if (!list.length) {
      grid.innerHTML = '<li class="empty-state">No resources match.</li>';
      return;
    }

    grid.replaceChildren(
      ...list.map((r) => {
        const li = document.createElement("li");
        li.innerHTML = `
          <article class="card resource">
            <div class="resource-head">
              <div class="resource-image" aria-hidden="true"></div>
              <div>
                <span class="resource-type"></span>
                <h2></h2>
              </div>
            </div>
            <p></p>
            <a class="btn btn-ghost" target="_blank" rel="noopener">Open &rarr;</a>
          </article>`;
        const img = li.querySelector(".resource-image");
        if (r.resource_image) {
          img.innerHTML = `<img alt="" />`;
          img.querySelector("img").src = r.resource_image;
        } else {
          img.textContent = r.resource_name.charAt(0);
        }
        li.querySelector(".resource-type").textContent = r.category || "Resource";
        li.querySelector("h2").textContent = r.resource_name;
        li.querySelector("p").textContent = r.description || "";
        li.querySelector("a").href = r.resource_link;
        return li;
      })
    );
  }
});
