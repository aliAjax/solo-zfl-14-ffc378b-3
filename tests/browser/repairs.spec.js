import { test, expect } from "@playwright/test";

const STORAGE_KEY = "zfl-14-repairs";

function dateOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function resetStorage(page) {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
}

async function addRepair(page, { location, title, cost = "0", costType = "", dueDate = "", status = "todo" }) {
  await page.getByLabel("位置").fill(location);
  await page.getByLabel("问题描述").fill(title);
  await page.getByLabel("预计费用").fill(cost);
  if (costType) await page.getByLabel("费用类型").selectOption(costType);
  if (dueDate) await page.getByLabel("计划完成日期").fill(dueDate);
  await page.getByLabel("处理状态").selectOption(status);
  await page.getByRole("button", { name: "保存事项" }).click();
  await expect(page.getByText(title)).toBeVisible();
}

async function setBudget(page, amount) {
  await page.getByLabel("本月预算上限").fill(String(amount));
  await page.getByRole("button", { name: "设置" }).click();
}

test.beforeEach(async ({ page }) => {
  await resetStorage(page);
});

test("新增事项时可填写计划完成日期，列表显示剩余天数", async ({ page }) => {
  await expect(page.getByLabel("计划完成日期")).toHaveAttribute("type", "date");

  await addRepair(page, {
    location: "阳台",
    title: "更换晾衣架钢丝绳",
    cost: "120",
    dueDate: dateOffset(3)
  });

  const card = page.locator(".repair", { hasText: "更换晾衣架钢丝绳" });
  await expect(card.locator(".due")).toHaveText(/剩余 3 天/);
  await expect(card).not.toHaveClass(/overdue/);

  // localStorage 中保存了计划日期
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.repairs[0].dueDate).toBe(dateOffset(3));
});

test("未设定计划日期时给出提示，逾期事项标红并显示逾期天数", async ({ page }) => {
  await addRepair(page, {
    location: "卫生间",
    title: "花洒滴水",
    dueDate: dateOffset(-2)
  });

  const card = page.locator(".repair", { hasText: "花洒滴水" });
  await expect(card).toHaveClass(/overdue/);
  await expect(card.locator(".due")).toHaveClass(/overdue/);
  await expect(card.locator(".due")).toHaveText(/已逾期 2 天/);

  // 今日到期不算逾期
  await addRepair(page, {
    location: "客厅",
    title: "空调滤网清洗",
    dueDate: dateOffset(0)
  });
  const todayCard = page.locator(".repair", { hasText: "空调滤网清洗" });
  await expect(todayCard.locator(".due")).toHaveText(/今日到期/);
  await expect(todayCard).not.toHaveClass(/overdue/);

  // 无计划日期显示占位提示
  await addRepair(page, { location: "玄关", title: "感应灯失灵" });
  const noDateCard = page.locator(".repair", { hasText: "感应灯失灵" });
  await expect(noDateCard.locator(".due")).toHaveText("未设定计划日期");
});

test("未完成事项按计划日期从近到远排列，无日期和已完成事项排在后面", async ({ page }) => {
  await addRepair(page, { location: "远处", title: "五天后", dueDate: dateOffset(5) });
  await addRepair(page, { location: "逾期", title: "昨天到期", dueDate: dateOffset(-1) });
  await addRepair(page, { location: "近处", title: "两天后", dueDate: dateOffset(2) });
  await addRepair(page, { location: "无日期", title: "暂无计划" });
  await addRepair(page, {
    location: "已完工",
    title: "上周完成的修补",
    dueDate: dateOffset(-10),
    status: "done"
  });

  const titles = await page.locator(".repair h3").allTextContents();
  expect(titles).toEqual(["逾期", "近处", "远处", "无日期", "厨房", "已完工"]);

  // 逾期事项标红，已完成的历史过期事项不标红
  await expect(page.locator(".repair", { hasText: "昨天到期" })).toHaveClass(/overdue/);
  await expect(page.locator(".repair", { hasText: "上周完成的修补" })).not.toHaveClass(/overdue/);
});

test("刷新后计划日期、排序和逾期状态保持一致", async ({ page }) => {
  await addRepair(page, { location: "阳台", title: "三天后处理", dueDate: dateOffset(3), cost: "80" });
  await addRepair(page, { location: "卫生间", title: "已经超期", dueDate: dateOffset(-1) });
  await addRepair(page, { location: "书房", title: "还没排期" });

  const before = await page.locator(".repair h3").allTextContents();
  const overdueBefore = await page.locator(".repair.overdue h3").allTextContents();
  const chipBefore = await page.locator(".due").allTextContents();
  const statsBefore = await page.locator(".stat strong").allTextContents();

  await page.reload();
  await expect(page.getByText("已经超期")).toBeVisible();

  const after = await page.locator(".repair h3").allTextContents();
  const overdueAfter = await page.locator(".repair.overdue h3").allTextContents();
  const chipAfter = await page.locator(".due").allTextContents();
  const statsAfter = await page.locator(".stat strong").allTextContents();

  expect(after).toEqual(before);
  expect(overdueAfter).toEqual(overdueBefore);
  expect(chipAfter).toEqual(chipBefore);
  expect(statsAfter).toEqual(statsBefore);

  // 日期输入值也从本地存储恢复（新增表单本身为空，校验存储内容）
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.repairs.find((r) => r.title === "三天后处理").dueDate).toBe(dateOffset(3));
});

test("原有状态筛选、删除和费用统计不受影响", async ({ page }) => {
  await addRepair(page, { location: "阳台", title: "待办项", dueDate: dateOffset(2), cost: "100" });
  await addRepair(page, {
    location: "车库",
    title: "处理中项",
    dueDate: dateOffset(4),
    cost: "200",
    status: "doing"
  });

  // 费用统计仅统计未完成事项
  await expect(page.locator(".stat", { hasText: "预计费用" }).locator("strong")).toHaveText("¥560");

  // 状态筛选
  await page.getByRole("button", { name: "已完成" }).click();
  await expect(page.locator(".repair")).toHaveCount(0);
  await expect(page.locator(".empty")).toBeVisible();
  await page.getByRole("button", { name: "处理中" }).click();
  await expect(page.locator(".repair h3")).toHaveText(["车库"]);

  // 删除事项
  await page.getByRole("button", { name: "全部" }).click();
  await page.locator(".repair", { hasText: "处理中项" }).getByRole("button", { name: "删除" }).click();
  await expect(page.getByText("处理中项")).toHaveCount(0);
  await expect(page.locator(".stat", { hasText: "预计费用" }).locator("strong")).toHaveText("¥360");
});

test("新增事项时可选择费用类型，卡片与本地存储保持一致", async ({ page }) => {
  await expect(page.getByLabel("费用类型")).toBeVisible();

  await addRepair(page, { location: "卫生间", title: "购买水龙头", cost: "150", costType: "material" });
  const materialCard = page.locator(".repair", { hasText: "购买水龙头" });
  await expect(materialCard.locator(".cost-type")).toHaveText("材料费");
  await expect(materialCard.locator(".cost-type")).toHaveClass(/material/);

  await addRepair(page, { location: "阳台", title: "请师傅打孔", cost: "300", costType: "labor" });
  const laborCard = page.locator(".repair", { hasText: "请师傅打孔" });
  await expect(laborCard.locator(".cost-type")).toHaveText("人工费");
  await expect(laborCard.locator(".cost-type")).toHaveClass(/labor/);

  await addRepair(page, { location: "客厅", title: "杂项支出", cost: "20", costType: "other" });
  const otherCard = page.locator(".repair", { hasText: "杂项支出" });
  await expect(otherCard.locator(".cost-type")).toHaveText("其他");

  // 费用类型随 localStorage 持久化
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.repairs.find((r) => r.title === "购买水龙头").costType).toBe("material");
  expect(saved.repairs.find((r) => r.title === "请师傅打孔").costType).toBe("labor");
  expect(saved.repairs.find((r) => r.title === "杂项支出").costType).toBe("other");
});

test("本月预算：完成事项计入本月已花费，超出预算时明显提示", async ({ page }) => {
  const budgetCard = page.locator(".stat.budget");

  // 未完成事项不计入本月花费
  await addRepair(page, { location: "卫生间", title: "待办维修", cost: "100", costType: "material" });
  await expect(budgetCard.locator(".budget-spent")).toContainText("¥0");
  await setBudget(page, 500);
  await expect(budgetCard.locator(".budget-ok")).toHaveText(/还可花费 ¥500/);
  await expect(budgetCard).not.toHaveClass(/over/);

  // 完成两笔事项（450 + 100 = 550），计入本月花费并超限
  await addRepair(page, { location: "厨房", title: "换角阀材料费", cost: "450", costType: "material", status: "done" });
  await expect(budgetCard.locator(".budget-spent")).toContainText("¥450");
  await expect(budgetCard.locator(".budget-ok")).toHaveText(/还可花费 ¥50/);

  await page.locator(".repair", { hasText: "待办维修" }).getByRole("combobox").selectOption("done");
  await expect(budgetCard.locator(".budget-spent")).toContainText("¥550");
  await expect(budgetCard.locator(".budget-alert")).toBeVisible();
  await expect(budgetCard.locator(".budget-alert")).toHaveText(/已超出预算 ¥50/);
  await expect(budgetCard).toHaveClass(/over/);

  // 完成的事项卡片显示完成日期
  const doneCard = page.locator(".repair", { hasText: "待办维修" });
  await expect(doneCard.locator(".done-date")).toBeVisible();

  // 提高预算后解除超限提示
  await setBudget(page, 600);
  await expect(budgetCard).not.toHaveClass(/over/);
  await expect(budgetCard.locator(".budget-alert")).toHaveCount(0);
  await expect(budgetCard.locator(".budget-ok")).toHaveText(/还可花费 ¥50/);
});

test("费用类型、预算和本月花费刷新后保持一致", async ({ page }) => {
  await addRepair(page, { location: "厨房", title: "本月完工维修", cost: "260", costType: "labor", status: "done" });
  await addRepair(page, { location: "书房", title: "未完工维修", cost: "80", costType: "other" });
  await setBudget(page, 200);

  await expect(page.locator(".stat.budget")).toHaveClass(/over/);
  const spentBefore = await page.locator(".budget-spent").textContent();
  const alertBefore = await page.locator(".budget-alert").textContent();
  const budgetValueBefore = await page.getByLabel("本月预算上限").inputValue();

  await page.reload();
  await expect(page.getByText("本月完工维修")).toBeVisible();

  // 预算上限、本月花费、超限状态保持
  await expect(page.getByLabel("本月预算上限")).toHaveValue(budgetValueBefore);
  await expect(page.locator(".budget-spent")).toHaveText(spentBefore);
  await expect(page.locator(".budget-alert")).toHaveText(alertBefore);
  await expect(page.locator(".stat.budget")).toHaveClass(/over/);

  // 费用类型与完成日期保持
  const doneCard = page.locator(".repair", { hasText: "本月完工维修" });
  await expect(doneCard.locator(".cost-type")).toHaveText("人工费");
  await expect(doneCard.locator(".done-date")).toBeVisible();
  const pendingCard = page.locator(".repair", { hasText: "未完工维修" });
  await expect(pendingCard.locator(".cost-type")).toHaveText("其他");

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.monthlyBudget).toBe(200);
  const done = saved.repairs.find((r) => r.title === "本月完工维修");
  expect(done.costType).toBe("labor");
  expect(done.completedAt.startsWith(new Date().toISOString().slice(0, 7))).toBe(true);
});

test("旧数据中无完成日期的已完成事项计入本月已花费，超限提醒与刷新持久化正确", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  const lastMonthDate = dateOffset(-40);
  const todayDate = dateOffset(0);
  // 写入预算功能上线前的旧格式数据：已完成但没有 completedAt / costType
  await page.evaluate(
    ({ key, lastMonthDate, todayDate }) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          filter: "all",
          repairs: [
            {
              id: "legacy-done",
              location: "阁楼",
              title: "历史已完成维修",
              priority: "medium",
              cost: 300,
              status: "done",
              photo: "",
              note: "旧数据没有 completedAt",
              dueDate: ""
            },
            {
              id: "legacy-last-month",
              location: "阳台",
              title: "上月完工的旧事项",
              priority: "low",
              cost: 100,
              status: "done",
              photo: "",
              note: "",
              dueDate: lastMonthDate
            },
            {
              id: "legacy-this-month",
              location: "玄关",
              title: "本月完工的旧事项",
              priority: "low",
              cost: 50,
              status: "done",
              photo: "",
              note: "",
              dueDate: todayDate
            }
          ]
        })
      );
    },
    { key: STORAGE_KEY, lastMonthDate, todayDate }
  );
  await page.reload();

  const budgetCard = page.locator(".stat.budget");
  // 本月已花费：无日期(300，视为本月) + 本月计划完成(50)；上月完工的 100 不计入
  await expect(budgetCard.locator(".budget-spent")).toContainText("¥350");

  // 超出预算时明显提醒
  await setBudget(page, 300);
  await expect(budgetCard).toHaveClass(/over/);
  await expect(budgetCard.locator(".budget-alert")).toHaveText(/已超出预算 ¥50/);

  // 迁移为旧事项补全完成日期与默认费用类型
  for (const title of ["历史已完成维修", "上月完工的旧事项", "本月完工的旧事项"]) {
    await expect(page.locator(".repair", { hasText: title }).locator(".done-date")).toBeVisible();
    await expect(page.locator(".repair", { hasText: title }).locator(".cost-type")).toHaveText("材料费");
  }

  // 刷新后花费、超限状态与迁移结果保持一致
  await page.reload();
  await expect(budgetCard.locator(".budget-spent")).toContainText("¥350");
  await expect(budgetCard).toHaveClass(/over/);
  await expect(page.getByLabel("本月预算上限")).toHaveValue("300");

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.monthlyBudget).toBe(300);
  const byId = Object.fromEntries(saved.repairs.map((r) => [r.id, r]));
  expect(byId["legacy-done"].costType).toBe("material");
  expect(byId["legacy-done"].completedAt).toBe(todayDate);
  expect(byId["legacy-last-month"].completedAt).toBe(lastMonthDate);
  expect(byId["legacy-this-month"].completedAt).toBe(todayDate);
});

test("已完成事项可归档，归档后从所有状态列表隐藏，归档入口显示数量", async ({ page }) => {
  await addRepair(page, { location: "次卧", title: "已完成待归档", cost: "180", costType: "labor", status: "done" });
  await addRepair(page, { location: "阳台", title: "未完成事项", cost: "90" });

  // 未完成事项没有归档按钮
  const pendingCard = page.locator(".repair", { hasText: "未完成事项" });
  await expect(pendingCard.getByRole("button", { name: "归档" })).toHaveCount(0);

  // 归档已完成事项
  const doneCard = page.locator(".repair", { hasText: "已完成待归档" });
  await doneCard.getByRole("button", { name: "归档" }).click();
  await expect(page.getByText("已完成待归档")).toHaveCount(0);

  // 入口显示归档数量，已完成筛选下也不可见
  await expect(page.getByRole("button", { name: /^归档事项（1）$/ })).toBeVisible();
  await page.getByRole("button", { name: "已完成" }).click();
  await expect(page.getByText("已完成待归档")).toHaveCount(0);
  await expect(page.locator(".empty")).toBeVisible();
  await page.getByRole("button", { name: "全部" }).click();
  await expect(page.getByText("已完成待归档")).toHaveCount(0);

  // 未完成统计不受影响，且已花费（归档的已完成事项）仍计入预算
  await expect(page.locator(".stat", { hasText: "未完成" }).locator("strong")).toHaveText("2");
  await expect(page.locator(".budget-spent")).toContainText("¥180");
});

test("归档视图可查看归档事项并恢复，统计与预算不受影响", async ({ page }) => {
  await addRepair(page, { location: "次卧", title: "归档项A", cost: "160", status: "done" });
  await addRepair(page, { location: "书房", title: "归档项B", cost: "240", costType: "other", status: "done" });

  for (const title of ["归档项A", "归档项B"]) {
    await page.locator(".repair", { hasText: title }).getByRole("button", { name: "归档" }).click();
  }
  await expect(page.getByText("归档项A")).toHaveCount(0);
  await expect(page.getByText("归档项B")).toHaveCount(0);

  // 归档视图列出全部归档事项
  await page.getByRole("button", { name: /归档事项/ }).click();
  await expect(page).toHaveURL(/.*/);
  await expect(page.locator(".repair h3")).toHaveText(["书房", "次卧"]);
  for (const title of ["归档项A", "归档项B"]) {
    await expect(page.locator(".repair", { hasText: title }).getByRole("button", { name: "恢复" })).toBeVisible();
  }

  // 恢复一条，返回默认列表后可见，另一条仍归档
  await page.locator(".repair", { hasText: "归档项A" }).getByRole("button", { name: "恢复" }).click();
  await expect(page.locator(".repair h3")).toHaveText(["书房"]);
  await page.getByRole("button", { name: "返回事项列表" }).click();
  await expect(page.getByText("归档项A")).toBeVisible();
  await expect(page.getByText("归档项B")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^归档事项（1）$/ })).toBeVisible();

  // 本月花费仍包含已归档的已完成事项，预算超限提醒正常
  await setBudget(page, 300);
  await expect(page.locator(".stat.budget")).toHaveClass(/over/);
  await expect(page.locator(".budget-alert")).toHaveText(/已超出预算 ¥100/);
});

test("归档状态与归档视图刷新后保持，localStorage 与其他流程一致", async ({ page }) => {
  await addRepair(page, { location: "阁楼", title: "刷新后仍归档", cost: "120", dueDate: dateOffset(-5), status: "done" });
  await page.locator(".repair", { hasText: "刷新后仍归档" }).getByRole("button", { name: "归档" }).click();
  await page.getByRole("button", { name: /归档事项/ }).click();
  await expect(page.locator(".repair", { hasText: "刷新后仍归档" })).toBeVisible();

  // 刷新后仍停留在归档视图，归档事项仍在
  await page.reload();
  await expect(page.getByRole("button", { name: "返回事项列表" })).toBeVisible();
  await expect(page.locator(".repair", { hasText: "刷新后仍归档" })).toBeVisible();

  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.view).toBe("archived");
  const archived = saved.repairs.find((r) => r.title === "刷新后仍归档");
  expect(archived.archived).toBe(true);
  expect(archived.status).toBe("done");

  // 返回默认列表，归档事项隐藏；计划日期排序逻辑对可见事项照常工作
  await page.getByRole("button", { name: "返回事项列表" }).click();
  await expect(page.getByText("刷新后仍归档")).toHaveCount(0);
  await addRepair(page, { location: "玄关", title: "明天到期", dueDate: dateOffset(1) });
  await expect(page.locator(".repair h3").first()).toHaveText("玄关");

  // 再次刷新后归档仍生效
  await page.reload();
  await expect(page.getByText("刷新后仍归档")).toHaveCount(0);
  const saved2 = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved2.view).toBe("active");
  expect(saved2.repairs.find((r) => r.title === "刷新后仍归档").archived).toBe(true);
});

test("导出 JSON 包含全部事项、预算和归档状态", async ({ page }) => {
  await setBudget(page, 880);
  await addRepair(page, { location: "露台", title: "导出测试-待办", cost: "60", costType: "other", dueDate: dateOffset(5) });
  await addRepair(page, { location: "储物间", title: "导出测试-已归档", cost: "220", costType: "labor", status: "done" });
  await page.locator(".repair", { hasText: "导出测试-已归档" }).getByRole("button", { name: "归档" }).click();
  await expect(page.getByText("导出测试-已归档")).toHaveCount(0);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 JSON" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^home-repairs-\d{4}-\d{2}-\d{2}\.json$/);

  const content = JSON.parse(await download.createReadStream().then((stream) => new Promise((resolve, reject) => {
    let data = "";
    stream.on("data", (chunk) => (data += chunk));
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  })));

  expect(content.app).toBe("zfl-14-home-repair");
  expect(typeof content.version).toBe("number");
  expect(content.exportedAt).toContain("T");
  expect(content.data.monthlyBudget).toBe(880);
  expect(Array.isArray(content.data.repairs)).toBe(true);

  const titles = content.data.repairs.map((r) => r.title);
  expect(titles).toContain("导出测试-待办");
  expect(titles).toContain("导出测试-已归档");
  expect(titles).toContain("水槽下方渗水");

  const archived = content.data.repairs.find((r) => r.title === "导出测试-已归档");
  expect(archived.archived).toBe(true);
  expect(archived.status).toBe("done");
  expect(archived.costType).toBe("labor");
  const pending = content.data.repairs.find((r) => r.title === "导出测试-待办");
  expect(pending.archived).toBe(false);
  expect(pending.dueDate).toBe(dateOffset(5));

  await expect(page.locator(".notice.success")).toContainText("已导出");
});

test("导入 JSON 可恢复全部数据，归档和预算生效，刷新后不变", async ({ page }) => {
  const backup = {
    app: "zfl-14-home-repair",
    version: 1,
    exportedAt: new Date().toISOString(),
    data: {
      filter: "all",
      view: "active",
      monthlyBudget: 700,
      repairs: [
        {
          id: "imp-1",
          location: "地下室",
          title: "导入的待办事项",
          priority: "high",
          cost: 50,
          costType: "material",
          status: "todo",
          photo: "",
          note: "来自备份",
          dueDate: "",
          completedAt: "",
          archived: false
        },
        {
          id: "imp-2",
          location: "车库",
          title: "导入的已归档事项",
          priority: "low",
          cost: 300,
          costType: "labor",
          status: "done",
          photo: "",
          note: "",
          dueDate: "",
          completedAt: dateOffset(0),
          archived: true
        }
      ]
    }
  };

  await page.locator("#import-file").setInputFiles({
    name: "home-repairs.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup))
  });

  await expect(page.locator(".notice.success")).toContainText("导入成功");
  await expect(page.getByText("导入的待办事项")).toBeVisible();
  await expect(page.getByText("导入的已归档事项")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^归档事项（1）$/ })).toBeVisible();
  await expect(page.getByLabel("本月预算上限")).toHaveValue("700");
  await expect(page.locator(".budget-spent")).toContainText("¥300");

  // 归档视图可看到恢复的归档事项
  await page.getByRole("button", { name: /归档事项/ }).click();
  await expect(page.getByText("导入的已归档事项")).toBeVisible();

  // 刷新后数据不变
  await page.reload();
  await expect(page.getByText("导入的已归档事项")).toBeVisible();
  await expect(page.getByLabel("本月预算上限")).toHaveValue("700");
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.repairs.map((r) => r.id).sort()).toEqual(["imp-1", "imp-2"]);
  expect(saved.monthlyBudget).toBe(700);
  expect(saved.repairs.find((r) => r.id === "imp-2").archived).toBe(true);
});

test("导入格式错误时提示且不改动现有数据", async ({ page }) => {
  await addRepair(page, { location: "客厅", title: "原有事项", cost: "70" });
  const repairCountBefore = await page.locator(".repair").count();
  const budgetBefore = await page.getByLabel("本月预算上限").inputValue();

  const importWith = async (content) => {
            await page.locator("#import-file").setInputFiles({
              name: "bad.json",
              mimeType: "application/json",
              buffer: Buffer.from(content)
            });
          };

  // 非 JSON
  await importWith("not a json file {{{");
  await expect(page.locator(".notice.error")).toContainText("不是有效的 JSON");

  // 缺少 repairs 列表
  await importWith(JSON.stringify({ app: "zfl-14-home-repair", version: 1, data: { repairs: "nope" } }));
  await expect(page.locator(".notice.error")).toContainText("repairs");

  // 必填字段缺失
  await importWith(JSON.stringify({ repairs: [{ id: "x", status: "todo" }] }));
  await expect(page.locator(".notice.error")).toContainText("缺少");

  // 状态非法
  await importWith(JSON.stringify({ repairs: [{ id: "x", location: "a", title: "b", status: "wat", priority: "low", cost: 1 }] }));
  await expect(page.locator(".notice.error")).toContainText("状态无效");

  // 日期格式非法
  await importWith(JSON.stringify({ repairs: [{ id: "x", location: "a", title: "b", status: "todo", priority: "low", cost: 1, dueDate: "2026/9/1" }] }));
  await expect(page.locator(".notice.error")).toContainText("日期格式无效");

  // 数据保持不变
  await expect(page.locator(".repair")).toHaveCount(repairCountBefore);
  await expect(page.getByText("原有事项")).toBeVisible();
  await expect(page.getByLabel("本月预算上限")).toHaveValue(budgetBefore);
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  expect(saved.repairs.some((r) => r.title === "原有事项")).toBe(true);
});
