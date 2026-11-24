/**
 * 站内通用 404 未找到页面组件
 */

import { Link } from 'react-router-dom';
import { useI18n } from '../i18n';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';

export function NotFoundView({ homeTo = '/' }: { homeTo?: string }) {
  const m = useCommonModalsI18n();
  const { messages: t } = useI18n();

  return (
    <div className="max-w-md mx-auto px-4 py-24 text-center space-y-4">
      <div className="space-y-2">
        <h1 className="font-editorial text-2xl font-semibold">{m.appPage404Title}</h1>
        <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
          {m.appPage404Desc}
        </p>
      </div>
      <Link
        to={homeTo}
        className="inline-flex items-center justify-center px-4 py-2 rounded-full text-xs font-medium no-underline"
        style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
      >
        {t.backToCatalog}
      </Link>
    </div>
  );
}
