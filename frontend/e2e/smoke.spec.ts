import { expect, test } from "@playwright/test";

test("核心导航、模板设计器与主题切换", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/#/");
  await expect(page.getByRole("heading", { name: "内容工作台" })).toBeVisible();
  if ((page.viewportSize()?.width ?? 1440) > 960) {
    await expect(page.getByText("API 在线")).toBeVisible();
  }

  await page.locator(".nav-item").filter({ hasText: "模板" }).click();
  await expect(page.getByRole("heading", { name: "模板", exact: true })).toBeVisible();
  await page.locator(".resource-card").first().click();
  await expect(page.locator(".canvas-sheet")).toBeVisible();
  await expect(page.locator(".palette-item")).toHaveCount(7);

  await page.locator(".field-row-main").first().click();
  await expect(page.locator(".ant-drawer")).toContainText("编辑字段");
  await page.locator(".ant-drawer").getByRole("textbox").first().fill("文档标题");
  await expect(page.locator(".ant-drawer-title")).toContainText("文档标题");
  await page.locator(".ant-drawer-footer").getByRole("button", { name: /完\s*成/ }).click();
  await expect(page.locator(".field-row").first()).toContainText("文档标题");

  const fieldCount = await page.locator(".field-mini").count();
  await page.locator(".palette-item").filter({ hasText: "字段" }).click();
  await expect(page.locator(".field-mini")).toHaveCount(fieldCount + 1);
  await page.locator(".layout-block.selected").getByRole("button", { name: "删除区块" }).click();
  await expect(page.locator(".field-mini")).toHaveCount(fieldCount);

  await page.locator(".palette-item").filter({ hasText: "说明" }).click();
  await expect(page.getByText("有未保存改动", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "撤销" }).click();
  await page.getByRole("button", { name: "预览" }).click();
  await expect(page.getByRole("dialog")).toContainText("模板预览");
  await page.getByRole("button", { name: "关闭" }).click();

  const themeButton = page.getByRole("button", { name: /切换主题/ });
  await themeButton.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
});

test("检索结果进入文档编辑器", async ({ page }) => {
  await page.goto("/#/search");
  const input = page.getByPlaceholder("例如：安装步骤、故障排查、数据导出");
  await input.fill("电源");
  await page.locator(".search-input button").last().click();
  const result = page.locator(".search-result").first();
  await expect(result).toBeVisible();
  await result.click();
  await expect(page.locator(".document-paper")).toBeVisible();
  await expect(page.locator(".rich-content")).toContainText("先检查电源");
  await expect(page.getByText("发布校验")).toBeVisible();

  await page.getByRole("button", { name: "插入表格" }).click();
  const tableDialog = page.getByRole("dialog", { name: "插入表格" });
  await expect(tableDialog).toBeVisible();
  await expect(page.locator(".ant-modal-centered")).toBeVisible();
  await expect(tableDialog.getByRole("spinbutton", { name: "表格行数" })).toHaveValue("3");
  await expect(tableDialog.getByRole("spinbutton", { name: "表格列数" })).toHaveValue("3");
  await tableDialog.getByRole("button", { name: /插\s*入/ }).click();
  await expect(page.locator(".rich-content table")).toHaveCount(1);
  await expect(page.locator(".rich-content table th")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "增加表格行" })).toHaveText("");
  await expect(page.getByRole("button", { name: "增加表格列" })).toHaveText("");
  await expect(page.getByRole("button", { name: "删除表格" })).toHaveText("");
  await page.getByRole("button", { name: "增加表格行" }).click();
  await expect(page.locator(".rich-content table tr")).toHaveCount(4);
  await page.getByRole("button", { name: "增加表格列" }).click();
  await expect(page.locator(".rich-content table th")).toHaveCount(4);
  await expect(page.locator(".rich-content table td")).toHaveCount(12);
  await page.getByRole("button", { name: "删除表格" }).click();
  await expect(page.locator(".rich-content table")).toHaveCount(0);
});

test("窄屏无横向溢出并保留单列交互", async ({ page }) => {
  await page.goto("/#/templates");
  await expect(page.locator(".card-grid")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.locator(".resource-card").first().click();
  await expect(page.locator(".editor-canvas-wrap")).toBeVisible();
  const editorOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(editorOverflow).toBeLessThanOrEqual(1);
});
