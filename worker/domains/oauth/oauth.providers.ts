import type { OAuthProvider } from '@shared/contracts/oauth.contract';
import { Errors } from '../../infra/errors';

export interface OAuthProviderCredentials {
  provider: OAuthProvider;
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}

export interface OAuthProfile {
  provider: OAuthProvider;
  providerUserId: string;
  unionId: string;
  email: string;
  emailVerified: boolean;
  nickname: string;
  avatarUrl: string;
}

/** 生成 PKCE S256 code_challenge */
export async function computePkceChallenge(verifier: string): Promise<string> {
  const bytes = new TextEncoder().encode(verifier);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let binary = '';
  for (const b of digest) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 构造各第三方平台 OAuth 授权跳转地址 */
export async function buildOAuthAuthorizeUrl(params: {
  creds: OAuthProviderCredentials;
  redirectUri: string;
  state: string;
  codeVerifier: string;
}): Promise<string> {
  const { creds, redirectUri, state, codeVerifier } = params;
  if (creds.provider === 'google') {
    const challenge = await computePkceChallenge(codeVerifier);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  if (creds.provider === 'github') {
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', 'read:user user:email');
    url.searchParams.set('state', state);
    return url.toString();
  }

  if (creds.provider === 'qq') {
    const url = new URL('https://graph.qq.com/oauth2.0/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'get_user_info');
    return url.toString();
  }

  if (creds.provider === 'wechat_open') {
    const url = new URL('https://open.weixin.qq.com/connect/qrconnect');
    url.searchParams.set('appid', creds.clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'snsapi_login');
    url.searchParams.set('state', state);
    return `${url.toString()}#wechat_redirect`;
  }

  // 微信公众号网页授权（微信内置浏览器）
  const url = new URL('https://open.weixin.qq.com/connect/oauth2/authorize');
  url.searchParams.set('appid', creds.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'snsapi_userinfo');
  url.searchParams.set('state', state);
  return `${url.toString()}#wechat_redirect`;
}

/** 使用授权 code 向对应 OAuth 平台换取 Access Token 并拉取标准用户画像 */
export async function fetchOAuthUserProfile(params: {
  creds: OAuthProviderCredentials;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthProfile> {
  const { creds, code, redirectUri, codeVerifier } = params;

  if (creds.provider === 'google') {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }),
    });
    const tokenData = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenRes.ok || !tokenData.access_token) throw Errors.unauthorized('Google 授权令牌交换失败');

    const userRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const u = (await userRes.json().catch(() => ({}))) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };
    if (!userRes.ok || !u.sub) throw Errors.unauthorized('获取 Google 用户信息失败');
    return {
      provider: 'google',
      providerUserId: String(u.sub),
      unionId: '',
      email: (u.email || '').trim().toLowerCase(),
      emailVerified: Boolean(u.email_verified),
      nickname: (u.name || u.email?.split('@')[0] || 'Google User').slice(0, 32),
      avatarUrl: (u.picture || '').slice(0, 300),
    };
  }

  if (creds.provider === 'github') {
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenRes.ok || !tokenData.access_token) throw Errors.unauthorized('GitHub 授权令牌交换失败');

    const ghHeaders = {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'AcctHub-OAuth',
    };
    const [uRes, eRes] = await Promise.all([
      fetch('https://api.github.com/user', { headers: ghHeaders }),
      fetch('https://api.github.com/user/emails', { headers: ghHeaders }),
    ]);
    const u = (await uRes.json().catch(() => ({}))) as {
      id?: number;
      login?: string;
      name?: string;
      email?: string;
      avatar_url?: string;
    };
    if (!uRes.ok || !u.id) throw Errors.unauthorized('获取 GitHub 用户信息失败');
    const emails = (await eRes.json().catch(() => [])) as Array<{
      email?: string;
      primary?: boolean;
      verified?: boolean;
    }>;
    const primaryVerified = Array.isArray(emails)
      ? emails.find((e) => e.primary && e.verified) || emails.find((e) => e.verified)
      : undefined;
    const email = (primaryVerified?.email || u.email || '').trim().toLowerCase();
    return {
      provider: 'github',
      providerUserId: String(u.id),
      unionId: '',
      email,
      emailVerified: Boolean(primaryVerified?.verified),
      nickname: (u.name || u.login || 'GitHub User').slice(0, 32),
      avatarUrl: (u.avatar_url || '').slice(0, 300),
    };
  }

  if (creds.provider === 'qq') {
    const tokenUrl = new URL('https://graph.qq.com/oauth2.0/token');
    tokenUrl.searchParams.set('grant_type', 'authorization_code');
    tokenUrl.searchParams.set('client_id', creds.clientId);
    tokenUrl.searchParams.set('client_secret', creds.clientSecret);
    tokenUrl.searchParams.set('code', code);
    tokenUrl.searchParams.set('redirect_uri', redirectUri);
    tokenUrl.searchParams.set('fmt', 'json');
    const tokenRes = await fetch(tokenUrl.toString());
    const tokenData = (await tokenRes.json().catch(() => ({}))) as { access_token?: string };
    if (!tokenRes.ok || !tokenData.access_token) throw Errors.unauthorized('QQ 互联授权令牌交换失败');

    const meRes = await fetch(
      `https://graph.qq.com/oauth2.0/me?access_token=${encodeURIComponent(tokenData.access_token)}&unionid=1&fmt=json`
    );
    const me = (await meRes.json().catch(() => ({}))) as { openid?: string; unionid?: string };
    if (!meRes.ok || !me.openid) throw Errors.unauthorized('获取 QQ OpenID 失败');

    const infoUrl = new URL('https://graph.qq.com/user/get_user_info');
    infoUrl.searchParams.set('access_token', tokenData.access_token);
    infoUrl.searchParams.set('oauth_consumer_key', creds.clientId);
    infoUrl.searchParams.set('openid', me.openid);
    const infoRes = await fetch(infoUrl.toString());
    const info = (await infoRes.json().catch(() => ({}))) as {
      nickname?: string;
      figureurl_qq_2?: string;
      figureurl_qq_1?: string;
    };
    return {
      provider: 'qq',
      providerUserId: me.openid,
      unionId: me.unionid || '',
      email: '',
      emailVerified: false,
      nickname: (info.nickname || `QQ_${me.openid.slice(-6)}`).slice(0, 32),
      avatarUrl: (info.figureurl_qq_2 || info.figureurl_qq_1 || '').slice(0, 300),
    };
  }

  // 微信开放平台 (wechat_open) 与 微信公众号网页授权 (wechat_mp) 共用标准 sns 接口
  const tokenUrl = new URL('https://api.weixin.qq.com/sns/oauth2/access_token');
  tokenUrl.searchParams.set('appid', creds.clientId);
  tokenUrl.searchParams.set('secret', creds.clientSecret);
  tokenUrl.searchParams.set('code', code);
  tokenUrl.searchParams.set('grant_type', 'authorization_code');
  const tokenRes = await fetch(tokenUrl.toString());
  const tokenData = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    openid?: string;
    unionid?: string;
  };
  if (!tokenRes.ok || !tokenData.access_token || !tokenData.openid) {
    throw Errors.unauthorized('微信授权令牌交换失败');
  }

  const infoUrl = new URL('https://api.weixin.qq.com/sns/userinfo');
  infoUrl.searchParams.set('access_token', tokenData.access_token);
  infoUrl.searchParams.set('openid', tokenData.openid);
  infoUrl.searchParams.set('lang', 'zh_CN');
  const infoRes = await fetch(infoUrl.toString());
  const info = (await infoRes.json().catch(() => ({}))) as {
    openid?: string;
    unionid?: string;
    nickname?: string;
    headimgurl?: string;
  };
  return {
    provider: creds.provider,
    providerUserId: info.openid || tokenData.openid,
    unionId: info.unionid || tokenData.unionid || '',
    email: '',
    emailVerified: false,
    nickname: (info.nickname || `WX_${tokenData.openid.slice(-6)}`).slice(0, 32),
    avatarUrl: (info.headimgurl || '').slice(0, 300),
  };
}
