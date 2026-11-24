## 变更说明

<!-- 请简述本次 Pull Request 解决的问题、核心设计思路与改动范围 -->

## 变更类型

- [ ] 功能新增 (`feat`)
- [ ] 问题修复 (`fix`)
- [ ] 代码重构 (`refactor`)
- [ ] 文档与工程规范更新 (`docs` / `chore`)
- [ ] 测试补充 (`test`)

## 验证清单

请确认提交前已全部完成并通过以下检查（不允许跳过测试或放宽检查规则）：

- [ ] `pnpm run lint`（0 error, 0 warning）
- [ ] `pnpm run typecheck`（0 error）
- [ ] `pnpm run arch:check`（架构守卫全数通过）
- [ ] `pnpm run test` 与 `vitest.d1.config.ts` 全部通过
- [ ] `pnpm run build` 生产构建成功
- [ ] 如涉及核心前端流程或跨层改动，已运行 `pnpm run test:e2e`
- [ ] 新增代码注释与更新文档均使用简体中文
