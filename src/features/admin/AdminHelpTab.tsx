/**
 * 帮助中心富文本教程文章管理面板（主站总控与代理分站 1:1 共享完整富文本编辑器）
 */

import { Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { adminApi } from '../../api/admin.api';
import { tenantAgentApi } from '../../api/tenant-agent.api';
import { RichTextEditor } from '../../components/editor/RichTextEditor';
import { useAdminOpsI18n } from '../../i18n/namespaces/admin-ops';

export interface HelpArticleRow {
  id: number;
  category: string;
  title: string;
  content: string;
  sort_order: number;
}

interface AdminHelpTabProps {
  mode?: 'admin' | 'agent';
  articles: HelpArticleRow[];
  onReload: () => Promise<void>;
  showToast: (msg: string) => void;
}

export function AdminHelpTab({ mode = 'admin', articles, onReload, showToast }: AdminHelpTabProps) {
  const ao = useAdminOpsI18n();
  const [editingHelpId, setEditingHelpId] = useState<number | null>(null);
  const [helpDraft, setHelpDraft] = useState({
    category: ao.helpDefaultEditCat,
    title: '',
    content: '',
    sort_order: 1,
  });
  const [newHelp, setNewHelp] = useState({
    category: ao.helpDefaultNewCat,
    title: '',
    content: '',
    sort_order: 10,
  });

  const isAgent = mode === 'agent';

  const handleUpdate = async (id: number) => {
    if (isAgent) await tenantAgentApi.updateHelp(id, helpDraft);
    else await adminApi.updateHelp(id, helpDraft);
    setEditingHelpId(null);
    await onReload();
    showToast(ao.helpUpdatedToast);
  };

  const handleDelete = async (id: number) => {
    if (isAgent) await tenantAgentApi.deleteHelp(id);
    else await adminApi.deleteHelp(id);
    await onReload();
    showToast(ao.helpDeletedToast);
  };

  const handleCreate = async () => {
    if (isAgent) await tenantAgentApi.createHelp(newHelp);
    else await adminApi.createHelp(newHelp);
    setNewHelp({ category: ao.helpDefaultNewCat, title: '', content: '', sort_order: 10 });
    await onReload();
    showToast(ao.helpCreatedToast);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="paper-card rounded-2xl p-6 space-y-3">
        <h2 className="font-editorial text-xl font-semibold">{ao.helpTitle}</h2>
        {articles.map((art) => {
          const isEditing = editingHelpId === art.id;
          return (
            <div
              key={art.id}
              className="p-4 rounded-xl border space-y-2"
              style={{
                borderColor: isEditing ? 'var(--accent)' : 'var(--border-color)',
                backgroundColor: 'var(--bg-canvas)',
              }}
            >
              {isEditing ? (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      value={helpDraft.category}
                      onChange={(e) => setHelpDraft({ ...helpDraft, category: e.target.value })}
                      placeholder={ao.helpCatPh}
                      className="acct-input text-xs"
                    />
                    <input
                      value={helpDraft.title}
                      onChange={(e) => setHelpDraft({ ...helpDraft, title: e.target.value })}
                      placeholder={ao.helpTitlePh}
                      className="acct-input text-xs col-span-2"
                    />
                  </div>
                  <RichTextEditor
                    value={helpDraft.content}
                    onChange={(html) => setHelpDraft({ ...helpDraft, content: html })}
                    minHeight={200}
                  />
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingHelpId(null)}
                      className="px-3 py-1 rounded-lg border text-xs cursor-pointer"
                      style={{ borderColor: 'var(--border-color)' }}
                    >
                      {ao.helpCancelBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleUpdate(art.id)}
                      className="px-3 py-1 rounded-lg text-xs font-medium cursor-pointer"
                      style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
                    >
                      {ao.helpSaveBtn}
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span
                      className="text-[10.5px] px-2 py-0.5 rounded-full font-medium"
                      style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                    >
                      {art.category}
                    </span>
                    <div className="text-xs font-semibold mt-1.5">{art.title}</div>
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--ink-secondary)' }}>
                      {art.content
                        .replace(/<[^>]+>/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingHelpId(art.id);
                        setHelpDraft({
                          category: art.category,
                          title: art.title,
                          content: art.content,
                          sort_order: art.sort_order,
                        });
                      }}
                      className="p-1.5 rounded-lg cursor-pointer"
                      style={{ color: 'var(--accent)' }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(art.id)}
                      className="p-1.5 rounded-lg cursor-pointer"
                      style={{ color: 'var(--danger)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
        className="paper-card rounded-2xl p-6 space-y-3 self-start"
      >
        <h2 className="font-editorial text-xl font-semibold">{ao.helpCreateTitle}</h2>
        <div className="grid grid-cols-3 gap-2">
          <input
            required
            placeholder={ao.helpNewCatPh}
            value={newHelp.category}
            onChange={(e) => setNewHelp({ ...newHelp, category: e.target.value })}
            className="acct-input"
          />
          <input
            required
            placeholder={ao.helpNewTitlePh}
            value={newHelp.title}
            onChange={(e) => setNewHelp({ ...newHelp, title: e.target.value })}
            className="acct-input col-span-2"
          />
        </div>
        <RichTextEditor
          value={newHelp.content}
          onChange={(html) => setNewHelp({ ...newHelp, content: html })}
          placeholder={ao.helpNewContentPh}
          minHeight={220}
        />
        <button
          type="submit"
          className="px-5 py-2.5 rounded-xl text-xs font-medium cursor-pointer"
          style={{ backgroundColor: 'var(--accent)', color: '#FAF9F5' }}
        >
          {ao.helpPublishBtn}
        </button>
      </form>
    </div>
  );
}
