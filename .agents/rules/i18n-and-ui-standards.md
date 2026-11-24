---

name: i18n-and-ui-standards
trigger: model_decision
description: 当开发或重构前端 React 页面、UI 组件、样式、多语种字典、商品动态翻译或后端 API 错误提示时必须遵循的 5 语种国际化与前端工程规范。
---

# AcctHub 全站 5 语种国际化与前端 UI 规范

## 1. 全站 5 语种覆盖与按域懒加载

1. **支持语种**：全站统一支持 `zh-CN`、`zh-TW`、`en`、`ja`、`ko` 五种语言（与 `shared/constants/enums.ts` 的 `SUPPORTED_LOCALES` 保持一致）。
2. **命名空间分包懒加载**：
   - 语言包按业务域拆分至 `src/i18n/namespaces/<domain>/{zh-CN,zh-TW,en,ja,ko}.ts`（如 `storefront`、`commerce`、`extensions`、`risk-control`、`agent`、`admin-core`、`admin-ops`、`account`），通过动态 `import()` 按需加载，避免首屏打包全站 5 语种全量字典。
   - **键集合 100% 对称**：同一命名空间下 5 个语种文件的键结构必须完全一致，并由自动化测试与 `arch-guard` 强制校验。
3. **零硬编码文案**：
   - C 端前台、代理工作台、运营总控后台页面一律不得在 JSX 文本、占位符、按钮文案、Toast 提示与弹窗标题中硬编码自然语言字符串，必须通过对应命名空间的 Hook（如 `useStorefrontI18n()`、`useExtensionsI18n()`）或全局字典消费。
   - 后端所有业务错误与校验错误均通过 `shared/constants/error-codes.ts` 与 `error.middleware.ts` 自动按请求头 `X-Lang` / `Accept-Language` 转换为对应 5 语种文案。
4. **数据库动态内容多语种**：
   - 商品、公告、帮助文档等可运营内容统一通过 `translations_json` 与 `shared/domain/i18n.ts` 的 `resolveLocalizedField` 实现「目标语种 → `en` → `zh-CN`」三级优雅回退。

## 2. React 19、状态管理与 UI/a11y 规范

- **服务端状态与客户端 UI 状态分离**：所有接口数据读取、轮询、分页与变更一律使用 TanStack Query v5（`src/queries/`）；`useState` 仅用于纯本地 UI 交互状态（弹窗开关、表单草稿、选中 Tab 等）。
- **原生语义与无障碍零警告**：
  - 优先使用原生 `<button type="button">`、`<dialog>`、`<fieldset>`、`<label htmlFor>` 与语义化列表；
  - 严禁在静态 `<div>` 上裸绑 `onClick` 充当按钮；
  - 全仓必须保持 Biome a11y 规则 **0 error, 0 warning**。
- **渲染稳定性与性能**：大模块（管理后台各 Tab、代理面板、富文本编辑器、各语种命名空间）保持 `React.lazy` 与代码分割；注意稳定回调与 Query Key 引用，避免切 Tab 频闪或重复发包。
