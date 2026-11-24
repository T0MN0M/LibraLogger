// Transactions page: add / refund / remove / export purchases, receipt upload sketch.
document.addEventListener("DOMContentLoaded", async () => {
  const api = window.LibraAPI;
  const { formatMoney, formatDate, toISODate, transactionsToCSV, categoryColor } = api.util;
  const $ = (id) => document.getElementById(id);

  const form = $("addForm");
  const f = form.elements; // use form.elements: form.name is the form's own name attribute
  const addStatus = $("addStatus");
  const body = $("txBody");
  const search = $("search");
  const filterCategory = $("filterCategory");

  let categories = [];
  let rows = [];

  f.date.value = toISODate(new Date());

  categories = await api.getCategories();
  // Keep the server's order, but always list "Other" last (below Technology).
  const isOther = (c) => c.name === "Other";
  const menuOrder = [...categories.filter((c) => !isOther(c)), ...categories.filter(isOther)];
  for (const c of menuOrder) {
    $("addCategory").add(new Option(c.name, c.category_ID));
    filterCategory.add(new Option(c.name, c.category_ID));
  }

  await refresh();

  // ----- Add (Purchase.add_Transaction) -----
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = f.name.value.trim();
    const amount = Number(f.amount.value);
    if (!name || !(amount > 0) || !f.date.value) {
      addStatus.style.color = "var(--error)";
      addStatus.textContent = "Please enter a name, an amount above $0, and a date.";
      return;
    }
    await api.addTransaction({
      name,
      amount: Math.round(amount * 100) / 100,
      date: f.date.value,
      category_ID: Number(f.category_ID.value),
      description: f.description.value.trim(),
      recurring: f.recurring.checked,
    });
    addStatus.style.color = "";
    addStatus.textContent = `Added “${name}” (${formatMoney(amount)}).`;
    form.reset();
    f.date.value = toISODate(new Date());
    await refresh();
  });

  // ----- Filters -----
  search.addEventListener("input", render);
  filterCategory.addEventListener("change", render);

  // ----- Row actions (mark refunded / remove) -----
  body.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const id = Number(btn.dataset.id);
    const row = rows.find((r) => r.purchase_ID === id);
    if (btn.dataset.action === "refund") {
      await api.editTransaction(id, { is_refunded: !row.is_refunded });
    } else if (btn.dataset.action === "remove") {
      if (!confirm(`Remove “${row.name}”?`)) return;
      await api.removeTransaction(id);
    }
    await refresh();
  });

  // ----- Hover a row to see its description -----
  const tooltip = document.createElement("div");
  tooltip.className = "tx-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  document.body.append(tooltip);

  body.addEventListener("pointermove", (e) => {
    const tr = e.target.closest("tr[data-description]");
    if (!tr || e.target.closest(".row-actions")) {
      tooltip.hidden = true;
      return;
    }
    tooltip.textContent = tr.dataset.description;
    tooltip.hidden = false;
    // Keep the tooltip on screen near the cursor.
    const pad = 14;
    const { width, height } = tooltip.getBoundingClientRect();
    const x = Math.min(e.clientX + pad, window.innerWidth - width - 8);
    const y = e.clientY + pad + height > window.innerHeight ? e.clientY - height - pad : e.clientY + pad;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  });
  body.addEventListener("pointerleave", () => (tooltip.hidden = true));

  // ----- Export (Purchase.export_Transactions) -----
  $("exportBtn").addEventListener("click", () => {
    const csv = transactionsToCSV(filtered(), categories);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: `libra-transactions-${toISODate(new Date())}.csv`,
    });
    a.click();
    URL.revokeObjectURL(url);
  });

  // ----- Receipt upload (sketch; parsing happens server-side later) -----
  const dropzone = document.querySelector(".dropzone");
  const receiptInput = $("receiptInput");
  const showFile = (file) => {
    if (file) $("receiptLabel").textContent = `Selected: ${file.name} (not uploaded yet)`;
  };
  receiptInput.addEventListener("change", () => showFile(receiptInput.files[0]));
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragging");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragging"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragging");
    showFile(e.dataTransfer.files[0]);
  });

  // ----- Helpers -----
  async function refresh() {
    rows = await api.getTransactions();
    render();
  }

  function filtered() {
    const q = search.value.trim().toLowerCase();
    const cat = Number(filterCategory.value);
    return rows.filter(
      (r) =>
        (!cat || r.category_ID === cat) &&
        (!q || r.name.toLowerCase().includes(q) || (r.description || "").toLowerCase().includes(q))
    );
  }

  function render() {
    const list = filtered();
    const catName = (id) => categories.find((c) => c.category_ID === id)?.name ?? "Other";

    if (!list.length) {
      body.innerHTML = '<tr><td colspan="5" class="empty-state">No transactions match.</td></tr>';
    } else {
      body.replaceChildren(
        ...list.map((r) => {
          const tr = document.createElement("tr");
          if (r.is_refunded) tr.className = "refunded";

          const date = document.createElement("td");
          date.textContent = formatDate(r.date);

          const name = document.createElement("td");
          name.textContent = r.name;
          if (r.description) tr.dataset.description = r.description;
          if (r.recurring) name.insertAdjacentHTML("beforeend", '<span class="tag">recurring</span>');
          if (r.is_refunded) name.insertAdjacentHTML("beforeend", '<span class="tag">refunded</span>');

          const cat = document.createElement("td");
          const pill = document.createElement("span");
          pill.className = "cat-pill";
          pill.style.setProperty("--cat-color", categoryColor(r.category_ID));
          pill.textContent = catName(r.category_ID);
          cat.append(pill);

          const amt = document.createElement("td");
          amt.className = "num";
          amt.textContent = formatMoney(r.amount);

          const actions = document.createElement("td");
          actions.innerHTML = `<div class="row-actions">
            <button type="button" class="icon-btn" data-action="refund" data-id="${r.purchase_ID}">${r.is_refunded ? "Undo refund" : "Refunded"}</button>
            <button type="button" class="icon-btn danger" data-action="remove" data-id="${r.purchase_ID}" aria-label="Remove ${r.name.replace(/"/g, "&quot;")}">Remove</button>
          </div>`;

          tr.append(date, name, cat, amt, actions);
          return tr;
        })
      );
    }

    const total = list.filter((r) => !r.is_refunded).reduce((s, r) => s + Number(r.amount), 0);
    $("tableSummary").textContent = `${list.length} transaction${list.length === 1 ? "" : "s"} · ${formatMoney(total)} total (excluding refunds)`;
  }
});
