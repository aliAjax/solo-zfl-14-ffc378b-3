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

async function addRepair(page, { location, title, cost = "0", dueDate = "", status = "todo" }) {
  await page.getByLabel("位置").fill(location);
  await page.getByLabel("问题描述").fill(title);
  await page.getByLabel("预计费用").fill(cost);
  if (dueDate) await page.getByLabel("计划完成日期").fill(dueDate);
  await page.getByLabel("处理状态").selectOption(status);
  await page.getByRole("button", { name: "保存事项" }).click();
  await expect(page.getByText(title)).toBeVisible();
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
