import "./styles.css";

const STORAGE_KEY = "zfl-14-repairs";
const EXPORT_APP = "zfl-14-home-repair";
const EXPORT_VERSION = 1;
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

const costTypes = {
  material: "材料费",
  labor: "人工费",
  other: "其他"
};

let state = loadState();
let notice = null;
const app = document.querySelector("#app");

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const raw = JSON.parse(saved);
    const migrated = raw;
    const parsedBudget = Number(raw.monthlyBudget || 0);
    let changed = raw.monthlyBudget !== parsedBudget;
    migrated.monthlyBudget = parsedBudget;
    if (!["active", "archived"].includes(raw.view)) {
      migrated.view = "active";
      changed = true;
    }
    migrated.repairs.forEach((repair) => {
      repair.costType = repair.costType || "material";
      repair.completedAt = repair.completedAt || "";
      repair.dueDate = repair.dueDate || "";
      repair.archived = Boolean(repair.archived);
      // 预算功能上线前的已完成事项没有完成日期，按计划日期或当前日期补全
      if (repair.status === "done" && !repair.completedAt) {
        repair.completedAt = inferCompletedAt(repair);
        changed = true;
      }
    });
    if (changed) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  }
  return {
    filter: "all",
    view: "active",
    monthlyBudget: 0,
    repairs: [
      {
        id: crypto.randomUUID(),
        location: "厨房",
        title: "水槽下方渗水",
        priority: "high",
        cost: 260,
        costType: "material",
        status: "todo",
        photo: "",
        note: "先检查软管接口",
        dueDate: "",
        completedAt: "",
        archived: false
      }
    ]
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function showNotice(type, message) {
  notice = { type, message };
}

function exportData() {
  const payload = {
    app: EXPORT_APP,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data: {
      filter: state.filter,
      view: state.view,
      monthlyBudget: Number(state.monthlyBudget || 0),
      repairs: state.repairs
    }
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `home-repairs-${todayText()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showNotice("success", `已导出 ${state.repairs.length} 条事项`);
  render(true);
}

async function importData(file) {
  try {
    const text = await file.text();
    const imported = validateImport(text);
    state = imported;
    saveState();
    showNotice("success", `导入成功，已恢复 ${state.repairs.length} 条事项`);
  } catch (error) {
    showNotice("error", `导入失败：${error.message}`);
  }
  render(true);
}

function validateImport(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("文件不是有效的 JSON");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("文件格式不正确");
  }

  // 兼容直接导出的旧版纯状态文件
  const source = parsed.app === EXPORT_APP ? parsed.data : parsed;
  if (!source || typeof source !== "object" || !Array.isArray(source.repairs)) {
    throw new Error("缺少 repairs 事项列表");
  }

  const validStatuses = ["todo", "doing", "done"];
  const validPriorities = Object.keys(priorities);
  const validCostTypes = Object.keys(costTypes);
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  const repairs = source.repairs.map((repair, index) => {
    const label = `第 ${index + 1} 条事项`;
    if (!repair || typeof repair !== "object") throw new Error(`${label}格式不正确`);
    if (!["string", "number"].includes(typeof repair.id) || !String(repair.id).trim()) {
      throw new Error(`${label}缺少 id`);
    }
    for (const field of ["location", "title"]) {
      if (typeof repair[field] !== "string" || !repair[field].trim()) {
        throw new Error(`${label}缺少${field === "location" ? "位置" : "问题描述"}`);
      }
    }
    if (!validStatuses.includes(repair.status)) throw new Error(`${label}状态无效`);
    if (!validPriorities.includes(repair.priority)) throw new Error(`${label}优先级无效`);
    const costType = repair.costType || "material";
    if (!validCostTypes.includes(costType)) throw new Error(`${label}费用类型无效`);
    const cost = Number(repair.cost || 0);
    if (!Number.isFinite(cost) || cost < 0) throw new Error(`${label}费用无效`);
    for (const field of ["dueDate", "completedAt"]) {
      if (repair[field] && (typeof repair[field] !== "string" || !datePattern.test(repair[field]))) {
        throw new Error(`${label}日期格式无效`);
      }
    }
    return {
      id: String(repair.id),
      location: repair.location,
      title: repair.title,
      priority: repair.priority,
      cost,
      costType,
      status: repair.status,
      photo: typeof repair.photo === "string" ? repair.photo : "",
      note: typeof repair.note === "string" ? repair.note : "",
      dueDate: repair.dueDate || "",
      completedAt: repair.completedAt || "",
      archived: Boolean(repair.archived)
    };
  });

  const ids = repairs.map((repair) => repair.id);
  if (new Set(ids).size !== ids.length) throw new Error("事项 id 重复");

  const budget = Number(source.monthlyBudget || 0);
  if (!Number.isFinite(budget) || budget < 0) throw new Error("预算金额无效");

  return {
    filter: validStatuses.includes(source.filter) || source.filter === "all" ? source.filter : "all",
    view: ["active", "archived"].includes(source.view) ? source.view : "active",
    monthlyBudget: budget,
    repairs
  };
}

function render(keepNotice = false) {
  if (!keepNotice) notice = null;
  const repairs = visibleRepairs();
  const activeRepairs = state.repairs.filter((repair) => !repair.archived);
  const unfinished = activeRepairs.filter((repair) => repair.status !== "done");
  const totalCost = unfinished.reduce((total, repair) => total + Number(repair.cost || 0), 0);
  const doing = activeRepairs.filter((repair) => repair.status === "doing").length;
  const archivedCount = state.repairs.filter((repair) => repair.archived).length;
  const monthSpent = monthlySpending(state.repairs);
  const budget = Number(state.monthlyBudget || 0);
  const overBudget = budget > 0 && monthSpent > budget;

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
          <div class="stat budget ${overBudget ? "over" : ""}">
            <form id="budget-form">
              <label for="budget-input">本月预算上限</label>
              <div class="budget-input">
                <span>¥</span>
                <input id="budget-input" name="budget" type="number" min="0" step="1" value="${budget || ""}" placeholder="未设置">
                <button type="submit" class="budget-save">设置</button>
              </div>
            </form>
            <p class="budget-spent">本月已花费 <strong>¥${monthSpent}</strong>${budget > 0 ? ` / ¥${budget}` : ""}</p>
            ${overBudget ? `<p class="budget-alert">⚠ 已超出预算 ¥${monthSpent - budget}</p>` : budget > 0 ? `<p class="budget-ok">预算内，还可花费 ¥${budget - monthSpent}</p>` : `<p class="budget-ok">设置预算后自动提醒超限</p>`}
          </div>
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
            <label>费用类型<select name="costType">${renderCostTypeOptions("material")}</select></label>
            <label>计划完成日期<input name="dueDate" type="date"></label>
            <label>处理状态<select name="status">${renderStatusOptions("todo")}</select></label>
            <label>照片链接<input name="photo" type="url" placeholder="可选，粘贴图片地址"></label>
            <label>备注<textarea name="note" placeholder="师傅电话、材料或注意事项"></textarea></label>
            <button class="primary" type="submit">保存事项</button>
          </form>

          <div class="backup">
            <h2>数据备份</h2>
            <p class="backup-hint">导出包含全部事项、预算和归档状态的 JSON 文件，可再导入恢复。</p>
            <div class="backup-actions">
              <button type="button" class="ghost" id="export-button">导出 JSON</button>
              <button type="button" class="ghost" id="import-button">导入 JSON</button>
              <input type="file" id="import-file" accept="application/json,.json" hidden>
            </div>
          </div>
        </aside>

        <section>
          <div class="toolbar">
            ${state.view === "archived" ? `
              <button class="seg" data-view="active">← 返回事项列表</button>
              <span class="view-title">归档事项（${archivedCount}）</span>
            ` : `
              ${Object.entries(statuses).map(([value, label]) => `<button class="seg ${state.filter === value ? "active" : ""}" data-filter="${value}">${label}</button>`).join("")}
              <button class="seg archive-link" data-view="archived">归档事项${archivedCount ? `（${archivedCount}）` : ""}</button>
            `}
          </div>
          ${notice ? `<div class="notice ${notice.type}" data-notice>${escapeHtml(notice.message)}</div>` : ""}
          <div class="repairs">
            ${repairs.length ? repairs.map(renderRepair).join("") : `<div class="empty">${state.view === "archived" ? "还没有归档的维修事项" : "当前状态下没有维修事项"}</div>`}
          </div>
        </section>
      </section>
    </main>
  `;

  bindEvents();
}

function renderRepair(repair) {
  return `
    <article class="repair ${isOverdue(repair) ? "overdue" : ""} ${repair.archived ? "archived" : ""}">
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
          <span class="chip cost-type ${repair.costType || "material"}">${costTypes[repair.costType || "material"]}</span>
          <span class="chip">预计 ¥${Number(repair.cost || 0)}</span>
          ${repair.status === "done" && repair.completedAt ? `<span class="chip done-date">完成于 ${formatDate(repair.completedAt)}</span>` : ""}
          <span class="chip">${escapeHtml(repair.note || "暂无备注")}</span>
        </div>
        <div class="actions">
          ${repair.archived ? `
            <button class="ghost" data-restore="${repair.id}">恢复</button>
            <button class="ghost danger" data-delete="${repair.id}">删除</button>
          ` : `
            <select data-status="${repair.id}">${renderStatusOptions(repair.status)}</select>
            ${repair.status === "done" ? `<button class="ghost" data-archive="${repair.id}">归档</button>` : ""}
            <button class="ghost danger" data-delete="${repair.id}">删除</button>
          `}
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

function renderCostTypeOptions(selected) {
  return Object.entries(costTypes)
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
      costType: data.costType,
      dueDate: data.dueDate || "",
      status: data.status,
      completedAt: data.status === "done" ? todayText() : "",
      photo: data.photo.trim(),
      note: data.note.trim(),
      archived: false
    });
    saveState();
    render();
  });

  document.querySelector("#budget-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target).get("budget");
    state.monthlyBudget = Math.max(0, Number(data || 0));
    saveState();
    render();
    document.querySelector("#budget-input")?.focus();
  });

  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      state.view = "active";
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-archive]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.archive);
      if (repair && repair.status === "done") repair.archived = true;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-restore]").forEach((button) => {
    button.addEventListener("click", () => {
      const repair = state.repairs.find((item) => item.id === button.dataset.restore);
      if (repair) repair.archived = false;
      saveState();
      render();
    });
  });

  document.querySelectorAll("[data-status]").forEach((select) => {
    select.addEventListener("change", () => {
      const repair = state.repairs.find((item) => item.id === select.dataset.status);
      repair.status = select.value;
      if (repair.status === "done") {
        if (!repair.completedAt) repair.completedAt = todayText();
      } else {
        repair.completedAt = "";
      }
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

  document.querySelector("#export-button").addEventListener("click", exportData);

  const importButton = document.querySelector("#import-button");
  const importFile = document.querySelector("#import-file");
  importButton.addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => {
    const file = importFile.files[0];
    if (file) importData(file);
    importFile.value = "";
  });
}

function visibleRepairs() {
  if (state.view === "archived") {
    return sortRepairs(state.repairs.filter((repair) => repair.archived));
  }
  const list = state.filter === "all"
    ? state.repairs.filter((repair) => !repair.archived)
    : state.repairs.filter((repair) => !repair.archived && repair.status === state.filter);
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

function todayText() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function currentMonthText() {
  return todayText().slice(0, 7);
}

function inferCompletedAt(repair) {
  // 有不晚于今天的计划日期时，认为在计划当天完成；否则按本月完成处理
  if (repair.dueDate && repair.dueDate <= todayText()) {
    return repair.dueDate;
  }
  return todayText();
}

function monthlySpending(repairs) {
  const month = currentMonthText();
  return repairs
    .filter((repair) => {
      if (repair.status !== "done") return false;
      // 无完成日期的旧数据按本月完成兜底，避免漏算预算
      if (!repair.completedAt) return true;
      return repair.completedAt.startsWith(month);
    })
    .reduce((total, repair) => total + Number(repair.cost || 0), 0);
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
