'use client';

/**
 * 多选选择态管理（V20 批量操作）。
 *
 * 在「最近记录 / 时间线 / 回收站」里进入「选择模式」后维护一组被选中的 id：
 *  - 桌面：行内勾选框进入并多选；移动：长按某行进入选择模式并选中它（见 useLongPress）。
 *  - 提供 toggle / 进入并选中 / 全选 / 反全选 / 退出（清空）等原子操作。
 *  - selectionMode 为派生态：有选中项即视为处于选择态（也可显式进入空选择态以露出工具栏）。
 *
 * 纯状态，不含 UI / 网络；批量动作由调用方结合 runBatch 与既有接口完成。
 */

import { useCallback, useMemo, useState } from 'react';

export interface SelectionApi {
  /** 当前选中的 id 集合。 */
  selected: Set<string>;
  /** 选中数量。 */
  count: number;
  /** 是否处于选择模式（显式进入，或有选中项）。 */
  active: boolean;
  /** 某 id 是否被选中。 */
  isSelected: (id: string) => boolean;
  /** 切换某 id 的选中态（顺带进入选择模式）。 */
  toggle: (id: string) => void;
  /** 进入选择模式并选中某 id（移动端长按用）。 */
  enterWith: (id: string) => void;
  /** 显式进入空选择模式（露出工具栏，等待勾选）。 */
  enter: () => void;
  /** 全选给定 id 列表。 */
  selectAll: (ids: string[]) => void;
  /** 清空选中但保持在选择模式。 */
  clear: () => void;
  /** 退出选择模式（清空选中）。 */
  exit: () => void;
}

export function useSelection(): SelectionApi {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 显式进入态：即便没有选中项也想露出工具栏（例如点了「选择」入口）。
  const [forced, setForced] = useState(false);

  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  const toggle = useCallback((id: string) => {
    setForced(true);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const enterWith = useCallback((id: string) => {
    setForced(true);
    setSelected((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const enter = useCallback(() => setForced(true), []);

  const selectAll = useCallback((ids: string[]) => {
    setForced(true);
    setSelected(new Set(ids));
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const exit = useCallback(() => {
    setForced(false);
    setSelected(new Set());
  }, []);

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      active: forced || selected.size > 0,
      isSelected,
      toggle,
      enterWith,
      enter,
      selectAll,
      clear,
      exit,
    }),
    [selected, forced, isSelected, toggle, enterWith, enter, selectAll, clear, exit]
  );
}
