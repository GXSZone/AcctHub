/**
 * 顶部导航栏自定义外链与分组编辑器（主站总控与分站后台通用）
 * 支持添加独立直链与自定义名称分组（每组可自由增删多条外链、调整排序并实时预览 Header 效果）。
 */

import {
  type HeaderCustomLink,
  type HeaderNavEntry,
  MAX_GROUP_ITEMS,
  MAX_HEADER_ENTRIES,
  parseHeaderNavEntries,
  parseHeaderNavEntriesDraft,
} from '@shared/domain/header-links';
import { ArrowDown, ArrowUp, ExternalLink, FolderPlus, Layers, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { fmt } from '../i18n';
import { useCommonModalsI18n } from '../i18n/namespaces/common-modals';
import { HeaderExternalLinks } from './HeaderExternalLinks';

interface HeaderLinksEditorProps {
  linksJson: string;
  onChangeJson: (nextJson: string) => void;
}

function swapItems<T>(arr: T[], a: number, b: number): T[] {
  if (b < 0 || b >= arr.length) return arr;
  const copy = [...arr];
  [copy[a], copy[b]] = [copy[b], copy[a]];
  return copy;
}

export function HeaderLinksEditor({ linksJson, onChangeJson }: HeaderLinksEditorProps) {
  const m = useCommonModalsI18n();
  const [entries, setEntries] = useState<HeaderNavEntry[]>(() => parseHeaderNavEntriesDraft(linksJson));
  const lastCommittedRef = useRef<string>(linksJson);

  useEffect(() => {
    if (linksJson === lastCommittedRef.current) return;
    lastCommittedRef.current = linksJson;
    setEntries(parseHeaderNavEntriesDraft(linksJson));
  }, [linksJson]);

  const commit = (next: HeaderNavEntry[]) => {
    const serialized = JSON.stringify(next);
    lastCommittedRef.current = serialized;
    setEntries(next);
    onChangeJson(serialized);
  };

  const previewEntries = useMemo(() => parseHeaderNavEntries(JSON.stringify(entries)), [entries]);

  const updateGroupItems = (groupIdx: number, updater: (items: HeaderCustomLink[]) => HeaderCustomLink[]) => {
    commit(
      entries.map((entry, idx) =>
        idx === groupIdx && entry.type === 'group' ? { ...entry, items: updater(entry.items) } : entry
      )
    );
  };

  return (
    <div
      className="p-4 rounded-2xl border space-y-3.5"
      style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-canvas)' }}
    >
      {/* 头部标题与双入口添加按钮 */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold flex items-center gap-1.5">
            <ExternalLink className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>{m.hdrLinksEditorTitle}</span>
          </div>
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--ink-muted)' }}>
            {m.hdrLinksEditorDesc}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            disabled={entries.length >= MAX_HEADER_ENTRIES}
            onClick={() => commit([...entries, { type: 'link', label: '', url: 'https://' }])}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-pointer disabled:opacity-45 transition-colors hover:bg-[var(--bg-subtle)]"
            style={{
              borderColor: 'var(--border-color)',
              backgroundColor: 'var(--bg-surface)',
              color: 'var(--ink-primary)',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{m.hdrLinksAddBtn}</span>
          </button>
          <button
            type="button"
            disabled={entries.length >= MAX_HEADER_ENTRIES}
            onClick={() =>
              commit([...entries, { type: 'group', label: '', items: [{ label: '', url: 'https://' }] }])
            }
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl border text-xs font-medium cursor-pointer disabled:opacity-45 transition-colors"
            style={{
              borderColor: 'var(--accent)',
              backgroundColor: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{m.hdrLinksAddGroupBtn}</span>
          </button>
        </div>
      </div>

      {/* 所见即所得实时预览条 */}
      {previewEntries.length > 0 && (
        <div
          className="px-3 py-2 rounded-xl border flex flex-wrap items-center justify-between gap-2"
          style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
        >
          <span className="text-[11px] font-medium shrink-0" style={{ color: 'var(--ink-muted)' }}>
            {m.hdrLinksPreviewLabel}
          </span>
          <div className="flex items-center gap-1">
            <HeaderExternalLinks entries={previewEntries} />
          </div>
        </div>
      )}

      {/* 条目编辑列表 */}
      {entries.length === 0 ? (
        <p className="text-[11px] py-2" style={{ color: 'var(--ink-muted)' }}>
          {m.hdrLinksEmpty}
        </p>
      ) : (
        <div className="space-y-2.5">
          {entries.map((entry, idx) =>
            entry.type === 'link' ? (
              <div
                key={`edit-link-${idx}`}
                className="p-2.5 rounded-xl border grid grid-cols-1 sm:grid-cols-[auto_165px_1fr_auto] gap-2 items-center"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
              >
                <span
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap w-fit"
                  style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-secondary)' }}
                >
                  <ExternalLink className="w-3 h-3 shrink-0" />
                  <span>{m.hdrLinksBadgeLink}</span>
                </span>
                <input
                  type="text"
                  maxLength={20}
                  value={entry.label}
                  onChange={(e) =>
                    commit(
                      entries.map((row, i) =>
                        i === idx && row.type === 'link' ? { ...row, label: e.target.value } : row
                      )
                    )
                  }
                  placeholder={m.hdrLinksLabelPh}
                  className="acct-input py-1.5 text-xs"
                />
                <input
                  type="url"
                  value={entry.url}
                  onChange={(e) =>
                    commit(
                      entries.map((row, i) =>
                        i === idx && row.type === 'link' ? { ...row, url: e.target.value } : row
                      )
                    )
                  }
                  placeholder={m.hdrLinksUrlPh}
                  className="acct-input py-1.5 text-xs font-mono-num"
                />
                <div className="flex items-center gap-1 justify-self-end">
                  <button
                    type="button"
                    disabled={idx === 0}
                    aria-label={m.hdrLinksMoveUpAria}
                    onClick={() => commit(swapItems(entries, idx, idx - 1))}
                    className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-35"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                  >
                    <ArrowUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === entries.length - 1}
                    aria-label={m.hdrLinksMoveDownAria}
                    onClick={() => commit(swapItems(entries, idx, idx + 1))}
                    className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-35"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                  >
                    <ArrowDown className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={m.hdrLinksRemoveAria}
                    onClick={() => commit(entries.filter((_, i) => i !== idx))}
                    className="p-1.5 rounded-lg border cursor-pointer"
                    style={{ borderColor: 'var(--border-color)', color: 'var(--danger)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              <div
                key={`edit-group-${idx}`}
                className="p-3 rounded-xl border space-y-2.5"
                style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-surface)' }}
              >
                {/* 分组头部：自定义分组名 + 计数 + 排序/删除 */}
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap shrink-0"
                    style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    <Layers className="w-3 h-3 shrink-0" />
                    <span>{m.hdrLinksBadgeGroup}</span>
                  </span>
                  <input
                    type="text"
                    maxLength={20}
                    value={entry.label}
                    onChange={(e) =>
                      commit(
                        entries.map((row, i) =>
                          i === idx && row.type === 'group' ? { ...row, label: e.target.value } : row
                        )
                      )
                    }
                    placeholder={m.hdrLinksGroupLabelPh}
                    className="acct-input py-1.5 text-xs font-medium flex-1 min-w-[160px]"
                  />
                  <span
                    className="text-[11px] px-2 py-0.5 rounded-full font-mono-num shrink-0"
                    style={{ backgroundColor: 'var(--bg-subtle)', color: 'var(--ink-muted)' }}
                  >
                    {fmt(m.hdrLinksGroupCount, { count: entry.items.length })}
                  </span>
                  <div className="flex items-center gap-1 shrink-0 ml-auto">
                    <button
                      type="button"
                      disabled={idx === 0}
                      aria-label={m.hdrLinksMoveUpAria}
                      onClick={() => commit(swapItems(entries, idx, idx - 1))}
                      className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-35"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === entries.length - 1}
                      aria-label={m.hdrLinksMoveDownAria}
                      onClick={() => commit(swapItems(entries, idx, idx + 1))}
                      className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-35"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={m.hdrLinksRemoveAria}
                      onClick={() => commit(entries.filter((_, i) => i !== idx))}
                      className="p-1.5 rounded-lg border cursor-pointer"
                      style={{ borderColor: 'var(--border-color)', color: 'var(--danger)' }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* 组内链接列表 */}
                <div
                  className="pl-3 ml-1.5 border-l-2 space-y-2"
                  style={{ borderColor: 'var(--border-color)' }}
                >
                  {entry.items.length === 0 ? (
                    <p className="text-[11px] py-1" style={{ color: 'var(--ink-muted)' }}>
                      {m.hdrLinksGroupEmptyHint}
                    </p>
                  ) : (
                    entry.items.map((sub, subIdx) => (
                      <div
                        key={`sub-${idx}-${subIdx}`}
                        className="grid grid-cols-1 sm:grid-cols-[16px_160px_1fr_auto] gap-2 items-center"
                      >
                        <ExternalLink
                          className="w-3.5 h-3.5 hidden sm:block shrink-0"
                          style={{ color: 'var(--ink-muted)' }}
                        />
                        <input
                          type="text"
                          maxLength={20}
                          value={sub.label}
                          onChange={(e) =>
                            updateGroupItems(idx, (list) =>
                              list.map((it, k) => (k === subIdx ? { ...it, label: e.target.value } : it))
                            )
                          }
                          placeholder={m.hdrLinksLabelPh}
                          className="acct-input py-1.5 text-xs"
                        />
                        <input
                          type="url"
                          value={sub.url}
                          onChange={(e) =>
                            updateGroupItems(idx, (list) =>
                              list.map((it, k) => (k === subIdx ? { ...it, url: e.target.value } : it))
                            )
                          }
                          placeholder={m.hdrLinksUrlPh}
                          className="acct-input py-1.5 text-xs font-mono-num"
                        />
                        <div className="flex items-center gap-1 justify-self-end">
                          <button
                            type="button"
                            disabled={subIdx === 0}
                            aria-label={m.hdrLinksMoveUpAria}
                            onClick={() =>
                              updateGroupItems(idx, (list) => swapItems(list, subIdx, subIdx - 1))
                            }
                            className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-35"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={subIdx === entry.items.length - 1}
                            aria-label={m.hdrLinksMoveDownAria}
                            onClick={() =>
                              updateGroupItems(idx, (list) => swapItems(list, subIdx, subIdx + 1))
                            }
                            className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-35"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--ink-secondary)' }}
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            aria-label={m.hdrLinksRemoveAria}
                            onClick={() =>
                              updateGroupItems(idx, (list) => list.filter((_, k) => k !== subIdx))
                            }
                            className="p-1.5 rounded-lg border cursor-pointer"
                            style={{ borderColor: 'var(--border-color)', color: 'var(--danger)' }}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}

                  <button
                    type="button"
                    disabled={entry.items.length >= MAX_GROUP_ITEMS}
                    onClick={() => updateGroupItems(idx, (list) => [...list, { label: '', url: 'https://' }])}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium cursor-pointer disabled:opacity-45 transition-colors hover:bg-[var(--bg-subtle)]"
                    style={{
                      borderColor: 'var(--border-color)',
                      color: 'var(--ink-secondary)',
                    }}
                  >
                    <Plus className="w-3 h-3" />
                    <span>{m.hdrLinksAddSubBtn}</span>
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
