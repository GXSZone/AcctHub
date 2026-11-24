/**
 * 前台应用副作用与站点欢迎弹窗协调 Hook（邀请码持久化、租户白标样式同步、首次进站播报弹窗）
 */

import type React from 'react';
import { useEffect, useRef } from 'react';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import type { BootstrapPayload } from '../types';

export interface WelcomePopupState {
  open: boolean;
  title: string;
  content: string;
  badge: string;
  isWelcome: boolean;
}

export function useStorefrontEffects(
  bootstrap: BootstrapPayload | null,
  setPopupState: React.Dispatch<React.SetStateAction<WelcomePopupState>>
) {
  const m = useCommonModalsI18n();
  const popupCheckedRef = useRef(false);

  // 捕获 ?ref= 邀请码并持久化至 localStorage，便于新会员注册永久归因
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const refCode = (sp.get('ref') || '').trim();
      if (refCode && /^[A-Za-z0-9_-]{3,32}$/.test(refCode)) {
        localStorage.setItem('accthub_ref_code', refCode.toUpperCase());
      }
    } catch {
      // 忽略私密模式下的 localStorage 写入异常
    }
  }, []);

  // 动态同步租户白标主题色、Favicon、页面标题与前台首次进站播报弹窗
  useEffect(() => {
    if (!bootstrap) return;
    const rootStyle = document.documentElement.style;
    const isSub = Boolean(bootstrap.tenant?.isSubAgent);
    const accentHex = (
      isSub ? (bootstrap.tenant?.themeAccent ?? '') : (bootstrap.settings?.theme_accent ?? '')
    ).trim();
    if (/^#[0-9a-fA-F]{6}$/.test(accentHex)) {
      rootStyle.setProperty('--accent', accentHex);
      rootStyle.setProperty('--accent-hover', `color-mix(in srgb, ${accentHex} 88%, black)`);
      rootStyle.setProperty('--accent-soft', `${accentHex}1F`);
    } else {
      rootStyle.removeProperty('--accent');
      rootStyle.removeProperty('--accent-hover');
      rootStyle.removeProperty('--accent-soft');
    }

    const rawFavUrl = (
      isSub ? (bootstrap.tenant?.faviconUrl ?? '') : (bootstrap.settings?.brand_logo_url ?? '')
    ).trim();
    const favUrl = /^(https?:\/\/|\/(?!\/))/i.test(rawFavUrl) ? rawFavUrl : '';
    let iconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (favUrl) {
      if (!iconEl) {
        iconEl = document.createElement('link');
        iconEl.rel = 'icon';
        document.head.appendChild(iconEl);
      }
      iconEl.href = favUrl;
    } else if (iconEl && iconEl.getAttribute('href') !== '/favicon.svg') {
      iconEl.href = '/favicon.svg';
    }

    if (bootstrap.tenant?.seoTitle) {
      document.title = bootstrap.tenant.seoTitle;
    } else if (bootstrap.settings?.brand_name) {
      document.title = `${bootstrap.settings.brand_name} · ${bootstrap.settings.brand_tagline || m.appDefaultTagline}`;
    }

    if (popupCheckedRef.current) return;
    popupCheckedRef.current = true;

    const isStorefront = !window.location.pathname.startsWith('/admin');
    const enabled = bootstrap.settings?.popup_enabled !== 'false';
    if (!isStorefront || !enabled) return;

    const version = bootstrap.settings?.popup_version || '1';
    const freq = bootstrap.settings?.popup_frequency || 'once_per_day';
    const dismissKey = `accthub_popup_dismiss_${version}`;
    const sessionKey = `accthub_popup_seen_${version}`;
    let shouldShow = true;
    try {
      if (freq === 'once_per_day') {
        const dismissedDate = localStorage.getItem(dismissKey);
        const today = new Date().toISOString().slice(0, 10);
        if (dismissedDate === today) shouldShow = false;
        if (sessionStorage.getItem(sessionKey)) shouldShow = false;
      } else if (freq === 'once_per_session') {
        if (sessionStorage.getItem(sessionKey)) shouldShow = false;
      }
      if (shouldShow) {
        sessionStorage.setItem(sessionKey, '1');
        setPopupState({
          open: true,
          title: bootstrap.settings?.popup_title || m.appDefaultPopupTitle,
          content: bootstrap.settings?.popup_content || m.appDefaultPopupContent,
          badge: m.ntcPopupBadgeWelcome,
          isWelcome: true,
        });
      }
    } catch {
      setPopupState({
        open: true,
        title: bootstrap.settings?.popup_title || m.appDefaultPopupTitle,
        content: bootstrap.settings?.popup_content || m.appDefaultPopupContent,
        badge: m.ntcPopupBadgeWelcome,
        isWelcome: true,
      });
    }
  }, [
    bootstrap,
    m.appDefaultPopupContent,
    m.appDefaultPopupTitle,
    m.appDefaultTagline,
    m.ntcPopupBadgeWelcome,
    setPopupState,
  ]);
}
