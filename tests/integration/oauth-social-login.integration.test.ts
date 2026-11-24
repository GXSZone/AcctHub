import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agents, agentTiers, tenantDomains, users } from '../../worker/db/schema/index';
import { resetRateLimitBucketsForTest } from '../../worker/infra/security';
import { createTestApp, type TestAppContext } from './helpers/test-app';

describe('社交登录与白牌隔离：QQ / 微信 / Google / GitHub OAuth 登录与分站独立回调集成测试', () => {
  let ctx: TestAppContext;
  let adminHeaders: { Authorization: string };

  beforeEach(async () => {
    resetRateLimitBucketsForTest();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        // Google token + userinfo
        if (url.includes('oauth2.googleapis.com/token')) {
          return new Response(JSON.stringify({ access_token: 'g_tok_123' }), { status: 200 });
        }
        if (url.includes('openidconnect.googleapis.com/v1/userinfo')) {
          return new Response(
            JSON.stringify({
              sub: 'google-sub-001',
              email: 'alice.google@example.com',
              email_verified: true,
              name: 'Alice Google',
              picture: 'https://img.example.com/alice.png',
            }),
            { status: 200 }
          );
        }
        // GitHub token + user + emails
        if (url.includes('github.com/login/oauth/access_token')) {
          return new Response(JSON.stringify({ access_token: 'gh_tok_456' }), { status: 200 });
        }
        if (url.includes('api.github.com/user/emails')) {
          return new Response(
            JSON.stringify([{ email: 'dev.gh@example.com', primary: true, verified: true }]),
            { status: 200 }
          );
        }
        if (url.includes('api.github.com/user')) {
          return new Response(
            JSON.stringify({
              id: 998877,
              login: 'devgh',
              name: 'Dev GH',
              avatar_url: 'https://avatars.example.com/devgh.png',
            }),
            { status: 200 }
          );
        }
        // QQ token + me + user_info
        if (url.includes('graph.qq.com/oauth2.0/token')) {
          return new Response(JSON.stringify({ access_token: 'qq_tok_789' }), { status: 200 });
        }
        if (url.includes('graph.qq.com/oauth2.0/me')) {
          return new Response(JSON.stringify({ openid: 'QQ_OPEN_001', unionid: 'QQ_UNI_001' }), {
            status: 200,
          });
        }
        if (url.includes('graph.qq.com/user/get_user_info')) {
          return new Response(
            JSON.stringify({ ret: 0, nickname: '企鹅用户', figureurl_qq_2: 'https://q.example.com/a.png' }),
            { status: 200 }
          );
        }
        // 微信 token + userinfo（同 unionid 跨端识别）
        if (url.includes('api.weixin.qq.com/sns/oauth2/access_token')) {
          return new Response(
            JSON.stringify({
              access_token: 'wx_tok_1',
              openid: url.includes('WX_MP_APP') ? 'WX_MP_OPEN_1' : 'WX_PC_OPEN_1',
              unionid: 'WX_UNION_SHARED_888',
            }),
            { status: 200 }
          );
        }
        if (url.includes('api.weixin.qq.com/sns/userinfo')) {
          return new Response(
            JSON.stringify({
              openid: 'WX_OPEN_1',
              unionid: 'WX_UNION_SHARED_888',
              nickname: '微信买家',
              headimgurl: 'https://wx.example.com/head.png',
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ error: `unexpected mock url: ${url}` }), { status: 500 });
      })
    );

    ctx = createTestApp();
    adminHeaders = await ctx.adminHeaders();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    ctx.close();
  });

  it('主站配置 4 大渠道后完成 Google/GitHub/QQ/微信登录、微信 unionid 跨端归并、防重放与绑定解绑防锁死', async () => {
    // 1. 总控配置 Google + GitHub + QQ + 微信双端
    const saveRes = await ctx.jsonRequest<{
      providers: Array<{ provider: string; enabled: boolean; has_secret: boolean; secret_masked: string }>;
    }>('/api/admin/oauth/config', {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        callback_base_url: '',
        providers: {
          google: { enabled: true, client_id: 'G_APP_1', client_secret: 'G_SECRET_123456' },
          github: { enabled: true, client_id: 'GH_APP_1', client_secret: 'GH_SECRET_123456' },
          qq: { enabled: true, client_id: 'QQ_APP_1', client_secret: 'QQ_SECRET_123456' },
          wechat_open: { enabled: true, client_id: 'WX_PC_APP', client_secret: 'WX_PC_SEC_1234' },
          wechat_mp: { enabled: true, client_id: 'WX_MP_APP', client_secret: 'WX_MP_SEC_1234' },
        },
      }),
    });
    expect(saveRes.status).toBe(200);
    expect(saveRes.data.providers.filter((p) => p.enabled && p.has_secret)).toHaveLength(5);

    // 公开列表与 bootstrap 均可见 5 个已启用渠道
    const pub = await ctx.jsonRequest<{ providers: Array<{ provider: string }> }>(
      '/api/auth/oauth/providers'
    );
    expect(pub.status).toBe(200);
    expect(pub.data.providers).toHaveLength(5);

    // 2. Google 首次登录自动注册并核销一次性票据（支持二次消费防重放拦截）
    const startG = await ctx.jsonRequest<{ authorize_url: string }>('/api/auth/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ provider: 'google', mode: 'login', redirect_path: '/orders' }),
    });
    expect(startG.status).toBe(200);
    const authUrlG = new URL(startG.data.authorize_url);
    expect(authUrlG.searchParams.get('code_challenge_method')).toBe('S256');
    const stateG = authUrlG.searchParams.get('state') || '';

    const cbG = await ctx.request(
      `/api/auth/oauth/google/callback?code=mock_code_g&state=${encodeURIComponent(stateG)}`
    );
    expect(cbG.status).toBe(302);
    const locG = new URL(cbG.headers.get('Location') || '');
    expect(locG.pathname).toBe('/oauth/callback');
    const ticketG = locG.searchParams.get('ticket') || '';
    expect(ticketG.startsWith('aho_')).toBe(true);

    // 同一个 state 重放回调必须被拒绝
    const replayCb = await ctx.request(
      `/api/auth/oauth/google/callback?code=mock_code_g&state=${encodeURIComponent(stateG)}`
    );
    expect(replayCb.status).toBe(401);

    // 核销一次性票据换取 JWT 会话
    const exG = await ctx.jsonRequest<{
      token: string;
      redirect_path: string;
      user: { id: number; email: string; display_name: string };
    }>('/api/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket: ticketG }),
    });
    expect(exG.status).toBe(200);
    expect(exG.data.redirect_path).toBe('/orders');
    expect(exG.data.user.email).toBe('alice.google@example.com');

    // 同一票据二次核销必须 401
    const replayTicket = await ctx.jsonRequest('/api/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket: ticketG }),
    });
    expect(replayTicket.status).toBe(401);

    // 3. 已登录会员绑定 GitHub，然后可解绑 GitHub（因为还有真实邮箱 & Google）
    const userHeaders = { Authorization: `Bearer ${exG.data.token}` };
    const startBindGh = await ctx.jsonRequest<{ authorize_url: string }>('/api/auth/oauth/start', {
      method: 'POST',
      headers: userHeaders,
      body: JSON.stringify({ provider: 'github', mode: 'bind', redirect_path: '/account/security' }),
    });
    const stateGh = new URL(startBindGh.data.authorize_url).searchParams.get('state') || '';
    const cbGh = await ctx.request(
      `/api/auth/oauth/github/callback?code=mock_gh&state=${encodeURIComponent(stateGh)}`
    );
    const ticketGh = new URL(cbGh.headers.get('Location') || '').searchParams.get('ticket') || '';
    const exGh = await ctx.jsonRequest<{ action: string; user: { id: number } }>('/api/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket: ticketGh }),
    });
    expect(exGh.status).toBe(200);
    expect(exGh.data.action).toBe('bind');
    expect(exGh.data.user.id).toBe(exG.data.user.id);

    const listB = await ctx.jsonRequest<{ bindings: Array<{ provider: string }> }>(
      '/api/auth/oauth/bindings',
      {
        headers: userHeaders,
      }
    );
    expect(listB.data.bindings.map((b) => b.provider).sort()).toEqual(['github', 'google']);

    const unbindGh = await ctx.jsonRequest('/api/auth/oauth/bindings/github', {
      method: 'DELETE',
      headers: userHeaders,
    });
    expect(unbindGh.status).toBe(200);

    // 4. QQ 首次登录自动分配 @oauth.local 占位邮箱，尝试解绑最后一个第三方登录应被防锁死拒绝 (409)
    const startQq = await ctx.jsonRequest<{ authorize_url: string }>('/api/auth/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ provider: 'qq', mode: 'login' }),
    });
    const stateQq = new URL(startQq.data.authorize_url).searchParams.get('state') || '';
    const cbQq = await ctx.request(
      `/api/auth/oauth/qq/callback?code=mock_qq&state=${encodeURIComponent(stateQq)}`
    );
    const ticketQq = new URL(cbQq.headers.get('Location') || '').searchParams.get('ticket') || '';
    const exQq = await ctx.jsonRequest<{ token: string; user: { email: string } }>(
      '/api/auth/oauth/exchange',
      { method: 'POST', body: JSON.stringify({ ticket: ticketQq }) }
    );
    expect(exQq.status).toBe(200);
    expect(exQq.data.user.email.endsWith('@oauth.local')).toBe(true);

    const lockGuard = await ctx.jsonRequest('/api/auth/oauth/bindings/qq', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${exQq.data.token}` },
    });
    expect(lockGuard.status).toBe(409);

    // 5. 微信 PC 扫码登录后，同一 unionid 再用微信公众号网页授权登录，必须自动识别为同一会员 ID
    const startWxPc = await ctx.jsonRequest<{ authorize_url: string }>('/api/auth/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ provider: 'wechat_open', mode: 'login' }),
    });
    const cbWxPc = await ctx.request(
      `/api/auth/oauth/wechat_open/callback?code=wxpc&state=${encodeURIComponent(
        new URL(startWxPc.data.authorize_url).searchParams.get('state') || ''
      )}`
    );
    const exWxPc = await ctx.jsonRequest<{ user: { id: number } }>('/api/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        ticket: new URL(cbWxPc.headers.get('Location') || '').searchParams.get('ticket') || '',
      }),
    });
    expect(exWxPc.status).toBe(200);

    const startWxMp = await ctx.jsonRequest<{ authorize_url: string }>('/api/auth/oauth/start', {
      method: 'POST',
      body: JSON.stringify({ provider: 'wechat_mp', mode: 'login' }),
    });
    const cbWxMp = await ctx.request(
      `/api/auth/oauth/wechat_mp/callback?code=wxmp&state=${encodeURIComponent(
        new URL(startWxMp.data.authorize_url).searchParams.get('state') || ''
      )}`
    );
    const exWxMp = await ctx.jsonRequest<{ user: { id: number } }>('/api/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({
        ticket: new URL(cbWxMp.headers.get('Location') || '').searchParams.get('ticket') || '',
      }),
    });
    expect(exWxMp.status).toBe(200);
    expect(exWxMp.data.user.id).toBe(exWxPc.data.user.id);
  });

  it('分站纯独立白牌零暴露隔离：未自配 OAuth 的分站彻底隐藏主站渠道，自配后仅用自有凭证且严防跨站回调', async () => {
    // 1. 主站先开启 Google
    await ctx.jsonRequest('/api/admin/oauth/config', {
      method: 'PUT',
      headers: adminHeaders,
      body: JSON.stringify({
        providers: {
          google: { enabled: true, client_id: 'MAIN_GOOGLE_ID', client_secret: 'MAIN_GOOGLE_SEC' },
        },
      }),
    });

    // 2. 创建代理分站及已授权独立域名 shop-sub.example.com
    const regAgent = await ctx.jsonRequest<{ token: string; user: { id: number } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        email: 'subowner@example.com',
        password: 'Password123!',
        display_name: 'SubOwner',
      }),
    });
    await ctx.db.update(users).set({ role: 'agent' }).where(eq(users.id, regAgent.data.user.id));
    const [tier] = await ctx.db
      .insert(agentTiers)
      .values({
        ownerAgentId: 0,
        code: 'flagship',
        name: '旗舰分站',
        minRecharge: 0,
        discountRate: 0.85,
        levelRank: 1,
      })
      .returning();
    const [agent] = await ctx.db
      .insert(agents)
      .values({
        userId: regAgent.data.user.id,
        tierId: tier.id,
        slug: 'substore',
        brandName: 'SubBrand',
        apiKey: 'ak_sub_test_1',
        status: 'active',
      })
      .returning();
    await ctx.db.insert(tenantDomains).values({
      agentId: agent.id,
      hostname: 'shop-sub.example.com',
      domainType: 'custom',
      isPrimary: 1,
      status: 'active',
      sslStatus: 'active',
    });

    const subHost = 'https://shop-sub.example.com';

    // 3. 分站尚未自配 OAuth：公开渠道列表必须为空（零暴露主站 Google！）
    const subProvidersBefore = await ctx.jsonRequest<{ providers: unknown[] }>(
      `${subHost}/api/auth/oauth/providers`
    );
    expect(subProvidersBefore.status).toBe(200);
    expect(subProvidersBefore.data.providers).toHaveLength(0);

    // 直接尝试在分站发起 Google 授权也必须被拒绝
    const subStartDenied = await ctx.jsonRequest(`${subHost}/api/auth/oauth/start`, {
      method: 'POST',
      body: JSON.stringify({ provider: 'google', mode: 'login' }),
    });
    expect(subStartDenied.status).toBe(400);

    // 4. 分站长在自己分站独立域名下登录并配置自己的 GitHub OAuth 凭证
    const agentLogin = await ctx.jsonRequest<{ token: string }>(`${subHost}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ email: 'subowner@example.com', password: 'Password123!' }),
    });
    expect(agentLogin.status).toBe(200);
    const agentHeaders = { Authorization: `Bearer ${agentLogin.data.token}` };
    const saveSub = await ctx.jsonRequest<{
      providers: Array<{ provider: string; enabled: boolean; client_id: string }>;
    }>(`${subHost}/api/agent/oauth/config`, {
      method: 'PUT',
      headers: agentHeaders,
      body: JSON.stringify({
        providers: {
          github: { enabled: true, client_id: 'SUB_OWN_GH_ID', client_secret: 'SUB_OWN_GH_SECRET' },
        },
      }),
    });
    expect(saveSub.status).toBe(200);

    // 分站现在只展示自己的 GitHub，不暴露主站的 Google
    const subProvidersAfter = await ctx.jsonRequest<{ providers: Array<{ provider: string }> }>(
      `${subHost}/api/auth/oauth/providers`
    );
    expect(subProvidersAfter.data.providers.map((p) => p.provider)).toEqual(['github']);

    // 分站发起授权：client_id 与 redirect_uri 100% 是分站自己的！
    const subStart = await ctx.jsonRequest<{ authorize_url: string }>(`${subHost}/api/auth/oauth/start`, {
      method: 'POST',
      body: JSON.stringify({ provider: 'github', mode: 'login' }),
    });
    expect(subStart.status).toBe(200);
    const subAuthUrl = new URL(subStart.data.authorize_url);
    expect(subAuthUrl.searchParams.get('client_id')).toBe('SUB_OWN_GH_ID');
    expect(subAuthUrl.searchParams.get('redirect_uri')).toBe(
      'https://shop-sub.example.com/api/auth/oauth/github/callback'
    );
    const subState = subAuthUrl.searchParams.get('state') || '';

    // 5. 安全红线校验：拿着分站的 state 回调到主站必须被严格拦截（401）
    const crossSiteCb = await ctx.request(
      `/api/auth/oauth/github/callback?code=gh_sub_code&state=${encodeURIComponent(subState)}`
    );
    expect(crossSiteCb.status).toBe(401);

    // 在分站自身域名完成回调并核销票据，生成的会员归属分站 site_agent_id = agent.id
    const subCb = await ctx.request(
      `${subHost}/api/auth/oauth/github/callback?code=gh_sub_code&state=${encodeURIComponent(subState)}`
    );
    expect(subCb.status).toBe(302);
    const subLoc = new URL(subCb.headers.get('Location') || '');
    expect(subLoc.origin).toBe(subHost);
    const subTicket = subLoc.searchParams.get('ticket') || '';

    // 拿着分站的票据在主站核销也必须 401
    const crossTicket = await ctx.jsonRequest('/api/auth/oauth/exchange', {
      method: 'POST',
      body: JSON.stringify({ ticket: subTicket }),
    });
    expect(crossTicket.status).toBe(401);

    // 在分站域核销成功！
    const subEx = await ctx.jsonRequest<{ user: { email: string; id: number } }>(
      `${subHost}/api/auth/oauth/exchange`,
      { method: 'POST', body: JSON.stringify({ ticket: subTicket }) }
    );
    expect(subEx.status).toBe(200);
    expect(subEx.data.user.email).toBe('dev.gh@example.com');
    const [dbUser] = await ctx.db.select().from(users).where(eq(users.id, subEx.data.user.id)).limit(1);
    expect(dbUser?.siteAgentId).toBe(agent.id);
  });
});
