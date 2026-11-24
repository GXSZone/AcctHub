/**
 * 全局直属下级代理专属弹窗宿主（全站任意页面自动检测并全局弹出上级推送的通知）
 */

import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { fmt } from '../i18n';
import { useAgentI18n } from '../i18n/namespaces/agent';
import { useAgentNoticesQuery } from '../queries/agent.queries';
import type { UserProfile } from '../types';
import { WelcomePopupModal } from './WelcomePopupModal';

interface DownlineGlobalPopupHostProps {
  user: UserProfile | null;
  welcomePopupOpen: boolean;
}

export function DownlineGlobalPopupHost({ user, welcomePopupOpen }: DownlineGlobalPopupHostProps) {
  const ag = useAgentI18n();
  const location = useLocation();
  const [popupOpen, setPopupOpen] = useState(false);
  const handledKeyRef = useRef<string | null>(null);

  const isSetupRoute = location.pathname.startsWith('/setup');
  const isAgentUser = Boolean(user && user.role === 'agent' && !isSetupRoute);
  const noticesQuery = useAgentNoticesQuery(isAgentUser, user?.id);
  const upstreamPopup = noticesQuery.data?.upstream_popup;

  useEffect(() => {
    if (!isAgentUser) {
      handledKeyRef.current = null;
      setPopupOpen(false);
      return;
    }
    if (welcomePopupOpen || !upstreamPopup?.enabled || !(upstreamPopup.title || upstreamPopup.content)) {
      return;
    }

    const version = upstreamPopup.version || '1';
    const checkKey = `${user?.id ?? 0}:${version}`;
    if (handledKeyRef.current === checkKey) return;
    handledKeyRef.current = checkKey;

    const freq = upstreamPopup.frequency || 'once_per_day';
    const dismissKey = `accthub_dl_popup_dismiss_${version}`;
    const sessionKey = `accthub_dl_popup_seen_${version}`;
    let shouldShow = true;
    try {
      if (freq === 'once_per_day') {
        if (localStorage.getItem(dismissKey) === new Date().toISOString().slice(0, 10)) shouldShow = false;
        if (sessionStorage.getItem(sessionKey)) shouldShow = false;
      } else if (freq === 'once_per_session' && sessionStorage.getItem(sessionKey)) {
        shouldShow = false;
      }
      if (shouldShow) {
        sessionStorage.setItem(sessionKey, '1');
        setPopupOpen(true);
      }
    } catch {
      setPopupOpen(true);
    }
  }, [isAgentUser, user?.id, welcomePopupOpen, upstreamPopup]);

  if (!popupOpen || !upstreamPopup) return null;

  return (
    <WelcomePopupModal
      open={popupOpen}
      title={upstreamPopup.title || ag.upstreamPopupDefaultTitle}
      content={upstreamPopup.content || ''}
      badge={fmt(ag.upstreamPopupDirectBadge, {
        source: upstreamPopup.source_name || ag.defaultMainBrand,
      })}
      showDismissToday
      onClose={() => setPopupOpen(false)}
      onDismissToday={() => {
        try {
          const v = upstreamPopup.version || '1';
          localStorage.setItem(`accthub_dl_popup_dismiss_${v}`, new Date().toISOString().slice(0, 10));
        } catch (err) {
          console.warn('Failed to persist upstream popup dismiss state:', err);
        }
      }}
    />
  );
}
