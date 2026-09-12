import "./styles.css";

const STORAGE_KEY = "zfl-14-repairs";
const statuses = {
  all: "全部",
  todo: "待处理",
  doing: "处理中",
  done: "已完成"
};

const priorities = {
  high: "高优先级",
  medium: "中优先级",
  low: "低优先级"
};

let state = loadState();
const app = document.querySelector("#app");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) return JSON.parse(saved);
  return {
    filter: "all",
    repairs: [
      {
        id: crypto.randomUUID(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        status: "todo",
        photo: "",
        note: "先检查软管接口",
        dueDate: ""
      }
    ]
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  const repairs = filteredRepairs();
  const unfinished = state.repairs.filter((repair) => repair.status !== "done");
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const doing = state.repairs.filter((repair) => repair.status === "doing").length;

  app.innerHTML = `
    <main class="shell">
      <header class="header">
        <div>
          <p class="eyebrow">本地家庭维护台</p>
          <h1>家庭维修事项</h1>
        </div>
        <section class="stats">
          <div class="stat"><span>未完成</span><strong>${unfinished.length}</strong></div>
          <div class="stat"><span>处理中</span><strong>${doing}</strong></div>
          <div class="stat"><span>预计费用</span><strong>¥${totalCost}</strong></div>
        </section>
      </header>

      <section class="layout">
        <aside class="panel">
          <h2>新增维修事项</h2>
          <form class="form" id="repair-form">
            <label>位置<input name="location" required placeholder="例如卫生间"></label>
            <label>问题描述<textarea name="title" required placeholder="例如门锁松动"></textarea></label>
            <label>优先级<select name="priority">${renderPriorityOptions("medium")}</select></label>
            <label>预计费用<input name="cost" type="number" min="0" step="1" value="0"></label>
            <label>计划完成日期<input name="dueDate" type="date"></label>
            <label>处理状态<select name="status">${renderStatusOptions("todo")}</select></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>
        </aside>

        <section>
          <div class="toolbar">
            ${Object.entries(statuses).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
          </div>
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">当前状态下没有维修事项</div>`}
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderRepair(repair) {
  return `
    <article class="repair ${isOverdue(repair) ? "overdue" : ""}">
      <div class="photo">${repair.photo ? `<img src="${escapeHtml(repair.photo)}" alt="${escapeHtml(repair.location)}维修照片">` : "未添加照片"}</div>
      <div class="content">
        <div class="row">
          <h3>${escapeHtml(repair.location)}</h3>
          <span class="priority ${repair.priority}">${priorities[repair.priority]}</span>
          <span class="status ${repair.status}">${statuses[repair.status]}</span>
        </div>
        <p>${escapeHtml(repair.title)}</p>
        <div class="row">
          ${renderDueChip(repair)}
          <span class="chip">预计 ¥${Number(repair.cost || 0)}</span>
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        <div class="actions">
          <select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>
          <button class="ghost" data-delete="${repair.id}">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderStatusOptions(selected) {
  return Object.entries(statuses)
    .filter(([value]) => value !== "all")
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function renderPriorityOptions(selected) {
  return Object.entries(priorities)
    .map(([value, label]) => `<option value="${value}" ${selected === value ? "selected" : ""}>${label}</option>`)
    .join("");
}

function bindEvents() {
  document.querySelector("#repair-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    state.repairs.unshift({
      id: crypto.randomUUID(),
      location: data.location.trim(),
      title: data.title.trim(),
      priority: data.priority,
      cost: Number(data.cost || 0),
      dueDate: data.dueDate || "",
      status: data.status,
      photo: data.photo.trim(),
      note: data.note.trim()
    });
    saveState();
    render();
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const repair = state.repairs.find((item) => item.id === select.dataset.status);
      repair.status = select.value;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      state.repairs = state.repairs.filter((repair) => repair.id !== button.dataset.delete);
      saveState();
      render();
    });
  });
}

function filteredRepairs() {
  const list = state.filter === "all" ? state.repairs.slice() : state.repairs.filter((repair) => repair.status === state.filter);
  return sortRepairs(list);
}

function sortRepairs(list) {
  return list
    .map((repair, index) => ({ repair, index }))
    .sort((a, b) => {
      const aDone = a.repair.status === "done";
      const bDone = b.repair.status === "done";
      if (aDone !== bDone) return aDone ? 1 : -1;

      const aHas = Boolean(a.repair.dueDate);
      const bHas = Boolean(b.repair.dueDate);
      if (aHas !== bHas) return aHas ? -1 : 1;
      if (aHas && a.repair.dueDate !== b.repair.dueDate) {
        return a.repair.dueDate < b.repair.dueDate ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.repair);
}

function daysUntil(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  const today = new Date();
  const due = new Date(year, month - 1, day);
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due - midnight) / 86400000);
}

function isOverdue(repair) {
  return repair.status !== "done" && Boolean(repair.dueDate) && daysUntil(repair.dueDate) < 0;
}

function formatDate(dateText) {
  const [, month, day] = dateText.split("-");
  return `${Number(month)}月${Number(day)}日`;
}

function renderDueChip(repair) {
  if (!repair.dueDate) {
    return `<span class="chip due no-date">未设定计划日期</span>`;
  }

  if (repair.status === "done") {
    return `<span class="chip due">计划 ${formatDate(repair.dueDate)}</span>`;
  }

  const days = daysUntil(repair.dueDate);
  let label;
  if (days < 0) label = `已逾期 ${Math.abs(days)} 天（${formatDate(repair.dueDate)}）`;
  else if (days === 0) label = `今日到期（${formatDate(repair.dueDate)}）`;
  else label = `剩余 ${days} 天（${formatDate(repair.dueDate)}）`;
  return `<span class="chip due ${days < 0 ? "overdue" : ""}">${label}</span>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

render();
