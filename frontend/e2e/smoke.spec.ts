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
  await page.locator(".ant-drawer .ant-select").click();
  await page.locator(".ant-select-item-option").filter({ hasText: "单选" }).click();
  const enumOptions = page.locator(".ant-drawer").getByRole("textbox", { name: "选项（每行“值|显示名”）" });
  await enumOptions.fill("draft|草稿");
  await enumOptions.press("Enter");
  await enumOptions.type("published|已发布");
  await expect(enumOptions).toHaveValue("draft|草稿\npublished|已发布");
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
  let nativeDialog = false;
  page.on("dialog", async (dialog) => {
    nativeDialog = true;
    await dialog.dismiss();
  });
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

  await page.getByRole("button", { name: "插入链接" }).click();
  const linkDialog = page.getByRole("dialog", { name: "插入链接" });
  await expect(linkDialog).toBeVisible();
  await expect(page.locator(".ant-modal-centered")).toBeVisible();
  await linkDialog.getByRole("textbox", { name: "链接文字" }).fill("示例链接");
  await linkDialog.getByRole("textbox", { name: "链接地址" }).fill("https://example.com/docs");
  await linkDialog.getByRole("button", { name: /插\s*入/ }).click();
  await expect(page.locator('.rich-content a[href="https://example.com/docs"]')).toHaveText("示例链接");
  expect(nativeDialog).toBe(false);
});

test("数据源管理显示浙江地市动态选项", async ({ page }) => {
  await page.goto("/#/data-sources");
  await expect(page.getByRole("heading", { name: "数据源", exact: true })).toBeVisible();
  const row = page.locator("tr").filter({ hasText: "浙江省地市" });
  await expect(row).toContainText("biz_region_city");
  await row.getByRole("button", { name: /选\s*项/ }).click();
  await expect(page.locator(".ant-drawer")).toContainText("杭州市");
  await expect(page.locator(".ant-drawer")).toContainText("丽水市");
});

test("模板单选可以绑定系统数据源", async ({ page }) => {
  await page.goto("/#/templates");
  await page.locator(".resource-card").first().click();
  await page.locator(".field-row-main").first().click();
  const drawer = page.locator(".ant-drawer");
  await drawer.locator(".ant-select").first().click();
  await page.locator(".ant-select-item-option").filter({ hasText: "单选" }).click();
  await drawer.getByText("系统数据源", { exact: true }).click();
  await expect(drawer.getByText("浙江省地市", { exact: true })).toBeVisible();
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

test("已发布阅读视图完整渲染富文本", async ({ page }) => {
  const assetId = `asset_${"a".repeat(32)}`;
  const templateSource = {
    schemaVersion: 1,
    metadata: { name: "阅读渲染模板", description: "" },
    fields: [
      { id: "title", type: "string", label: "标题", placeholder: "", help: "", requiredAt: [], options: [] },
      { id: "body", type: "richtext", label: "正文", placeholder: "", help: "", requiredAt: [], options: [] },
    ],
    layout: {
      id: "root", kind: "stack", title: "", fieldId: null, text: "", children: [
        { id: "slot_title", kind: "field", title: "", fieldId: "title", text: "", children: [] },
        { id: "slot_body", kind: "richText", title: "", fieldId: "body", text: "", children: [] },
      ],
    },
    workflow: { singleReview: true },
    indexing: { titleField: "title", summaryField: "", fullTextField: "body" },
  };
  const content = {
    title: "阅读验证",
    body: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "加粗", marks: [{ type: "bold" }] },
            { type: "text", text: "斜体", marks: [{ type: "italic" }] },
            { type: "text", text: "代码", marks: [{ type: "code" }] },
            { type: "text", text: "查看文档", marks: [{ type: "link", attrs: { href: "https://example.com/docs" } }] },
            { type: "text", text: "危险链接", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
          ],
        },
        { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "三级标题" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "无序项" }] }] }] },
        { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "引用内容" }] }] },
        {
          type: "table",
          content: [{
            type: "tableRow",
            content: [
              { type: "tableCell", attrs: { header: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "表头" }] }] },
              { type: "tableCell", attrs: { header: false }, content: [{ type: "paragraph", content: [{ type: "text", text: "单元格" }] }] },
            ],
          }],
        },
        { type: "paragraph", content: [{ type: "image", attrs: { assetId, alt: "示例图片" } }] },
      ],
    },
  };
  const document = {
    id: "doc_test",
    title: "阅读验证",
    status: "published",
    templateId: "tpl_test",
    templateVersionId: "tpv_test",
    templateName: "阅读渲染模板",
    draftRevisionId: "rev_test",
    publishedRevisionId: "rev_test",
    controlVersion: 2,
    draftGeneration: 1,
    publicationGeneration: 1,
    createdAt: "2026-10-25T00:00:00Z",
    updatedAt: "2026-10-25T00:00:00Z",
    content,
    templateSource,
  };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=", "base64");

  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/v1/session") return route.fulfill({ json: { tenantId: "default", userId: "dev", role: "publisher", authMode: "dev", version: "0.2.0" } });
    if (path === "/api/v1/documents/doc_test" || path === "/api/v1/documents/doc_test/published") return route.fulfill({ json: document, headers: { ETag: '"2"' } });
    if (path === "/api/v1/assets") return route.fulfill({ json: { items: [] } });
    if (path === `/api/v1/assets/${assetId}/content`) return route.fulfill({ body: png, contentType: "image/png" });
    return route.fulfill({ status: 404, json: { code: "NOT_FOUND", message: path } });
  });

  await page.goto("/#/documents/doc_test");
  await page.getByRole("button", { name: "阅读" }).click();
  const drawer = page.locator(".ant-drawer").filter({ hasText: "已发布阅读视图" });
  await expect(drawer.locator(".rich-content")).toBeVisible();
  await expect(drawer.locator('a[href="https://example.com/docs"]')).toHaveText("查看文档");
  await expect(drawer.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(drawer.locator("strong")).toHaveText("加粗");
  await expect(drawer.locator("em")).toHaveText("斜体");
  await expect(drawer.locator("code")).toHaveText("代码");
  await expect(drawer.locator("h3")).toHaveText("三级标题");
  await expect(drawer.locator("ul li")).toHaveText("无序项");
  await expect(drawer.locator("blockquote")).toContainText("引用内容");
  await expect(drawer.locator("table th")).toHaveText("表头");
  await expect(drawer.locator("table td")).toHaveText("单元格");
  await expect(drawer.locator("img.rich-inline-image")).toHaveAttribute("alt", "示例图片");
});
