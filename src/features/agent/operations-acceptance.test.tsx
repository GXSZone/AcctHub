import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { agentZhCN } from '../../i18n/namespaces/agent/zh-CN';
import { agentPricingZhCN } from '../../i18n/namespaces/agent-pricing/zh-CN';
import type { AgentInfo } from '../../types';
import { AgentDomainCard } from './AgentDomainCard';
import { AgentPricingBatchBar } from './pricing/AgentPricingBatchBar';

vi.mock('../../i18n/namespaces/agent-pricing', async () => {
  const { agentPricingZhCN } = await import('../../i18n/namespaces/agent-pricing/zh-CN');
  return { useAgentPricingI18n: () => agentPricingZhCN };
});

vi.mock('../../i18n/namespaces/agent', async () => {
  const { agentZhCN } = await import('../../i18n/namespaces/agent/zh-CN');
  return { useAgentI18n: () => agentZhCN };
});

function buttons(markup: string) {
  return markup.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

it('[B17] 空筛选禁用批量改价和恢复默认，有匹配时启用', () => {
  function renderBatchBar(batchTargetCount: number) {
    return renderToStaticMarkup(
      <AgentPricingBatchBar
        batchScopeLabel="筛选结果"
        totalItemsCount={5}
        listedCount={4}
        hiddenCount={1}
        batchTargetCount={batchTargetCount}
        listingFilter="listed"
        query="指定商品"
        batchMode="markup_cost_pct"
        batchValue={10}
        batchRounding="none"
        batchApplying={false}
        onListingFilterChange={vi.fn()}
        onQueryChange={vi.fn()}
        onBatchModeChange={vi.fn()}
        onBatchValueChange={vi.fn()}
        onBatchRoundingChange={vi.fn()}
        onBatchApply={vi.fn()}
        onBatchReset={vi.fn()}
      />
    );
  }

  const empty = buttons(renderBatchBar(0));
  const filtered = buttons(renderBatchBar(1));
  for (const label of [agentPricingZhCN.batchApplyBtn, agentPricingZhCN.batchResetBtn]) {
    const text = `>${label}</button>`;
    expect(empty.find((button) => button.endsWith(text))).toMatch(/^<button[^>]+\bdisabled=""/);
    expect(filtered.find((button) => button.endsWith(text))).toMatch(/^<button(?![^>]*\bdisabled="")/);
  }
});

it('[B54] 多域名卡片按 SaaS 模式显示 Cloudflare 自动签发或人工审批指引', () => {
  function renderDomain(cfSaasEnabled: boolean) {
    return renderToStaticMarkup(
      <AgentDomainCard
        agent={{ slug: 'certificate-fixture' } as AgentInfo}
        domainConfig={{
          neutral_base_domain: 'portfolio.example.test',
          saas_cname_target: 'edge.example.test',
          cf_saas_enabled: cfSaasEnabled,
        }}
        onToast={vi.fn()}
        onError={vi.fn()}
      />
    );
  }

  const manual = renderDomain(false);
  expect(manual).toContain(agentZhCN.domGuideStep3Manual);
  expect(manual).not.toContain(agentZhCN.domGuideStep3);

  const managed = renderDomain(true);
  expect(managed).toContain(agentZhCN.domGuideStep3);
  expect(managed).not.toContain(agentZhCN.domGuideStep3Manual);
});
