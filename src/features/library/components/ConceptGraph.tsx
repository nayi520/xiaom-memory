'use client';

/**
 * 知识图谱画布（V8）—— 力导向图，纯 canvas 渲染（d3-force 排布 + 手写绘制）。
 *
 * 设计取舍：不引入 react-force-graph-2d（会连带 force-graph / 多个 d3 包，包体偏大），
 * 仅用 d3-force（~30KB，纯 JS）做物理排布，自己用 2D canvas 画节点/边，包体可控。
 *
 * 本组件**必须 client-only**：内部直接操作 canvas 与 requestAnimationFrame，
 * 由 ConceptGraphPanel 用 dynamic(() => import, { ssr:false }) 包裹，避免 SSR 阶段触碰 canvas/window。
 *
 * 交互：
 *   - 节点按 domain 着色（同一领域同色，图例在 Panel 顶部）。
 *   - 节点半径随 cardCount 略增（卡多 = 更常复习）。
 *   - hover 高亮节点 + 其相邻边，显示名称气泡；移开恢复。
 *   - 点击节点跳转 /library/concept/{id}。
 *   - 拖拽节点可固定位置；滚轮缩放、空白处拖拽平移。
 *   - 尊重 prefers-reduced-motion：减少模拟动画（直接收敛到稳定布局）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  forceCenter,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceCollide,
  type Simulation,
} from 'd3-force';
import type { GraphLink, GraphNode } from '../graph';

/** 力导向用的节点（d3-force 会在其上挂 x/y/vx/vy/fx/fy）。 */
interface SimNode extends GraphNode {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}
/** 力导向用的边（d3-force 会把 source/target 由 id 字符串替换为节点对象引用）。 */
interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
  relationType: string | null;
  reason: string | null;
}

interface Props {
  nodes: GraphNode[];
  links: GraphLink[];
  /** 领域 → 颜色（与 Panel 图例一致）。未命中走默认灰。 */
  colorOf: (domain: string | null) => string;
}

const NODE_BASE_RADIUS = 5;
const NODE_MAX_RADIUS = 13;

function nodeRadius(cardCount: number): number {
  // 卡片数 → 半径（次线性增长，避免极端值过大）。
  return Math.min(NODE_MAX_RADIUS, NODE_BASE_RADIUS + Math.sqrt(cardCount) * 1.6);
}

export default function ConceptGraph({ nodes, links, colorOf }: Props) {
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // 悬停节点 id（用于高亮 + tooltip）。
  const [hoverId, setHoverId] = useState<string | null>(null);

  // 把入参拷成可变 Sim 结构（d3 会原地改写，不能直接用 props 引用）。
  const simNodes = useMemo<SimNode[]>(
    () => nodes.map((n) => ({ ...n })),
    [nodes]
  );
  const simLinks = useMemo<SimLink[]>(
    () => links.map((l) => ({ ...l })),
    [links]
  );

  // 视图变换（缩放 / 平移），用 ref 持有避免频繁 setState 触发重渲染。
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  // 交互态（拖拽节点 / 平移画布）用 ref，rAF 循环里读。
  const dragRef = useRef<{
    mode: 'node' | 'pan' | null;
    node: SimNode | null;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({ mode: null, node: null, lastX: 0, lastY: 0, moved: false });
  const hoverRef = useRef<string | null>(null);
  hoverRef.current = hoverId;

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let width = wrap.clientWidth || 600;
    let height = wrap.clientHeight || 460;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    function resize() {
      width = wrap!.clientWidth || 600;
      height = wrap!.clientHeight || 460;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.floor(width * dpr);
      canvas!.height = Math.floor(height * dpr);
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
    }
    resize();

    // 邻接表：hover 时高亮相邻节点 / 边。
    const adjacency = new Map<string, Set<string>>();
    for (const l of simLinks) {
      const s = typeof l.source === 'string' ? l.source : l.source.id;
      const t = typeof l.target === 'string' ? l.target : l.target.id;
      if (!adjacency.has(s)) adjacency.set(s, new Set());
      if (!adjacency.has(t)) adjacency.set(t, new Set());
      adjacency.get(s)!.add(t);
      adjacency.get(t)!.add(s);
    }

    // ---- d3-force 模拟 ----
    const sim: Simulation<SimNode, SimLink> = forceSimulation(simNodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(60)
          .strength(0.4)
      )
      .force('charge', forceManyBody().strength(-180))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>().radius((d) => nodeRadius(d.cardCount) + 4))
      .alpha(1)
      .alphaDecay(0.028);

    if (reduceMotion) {
      // 减少动画：快速跑若干 tick 收敛，再静态渲染。
      sim.stop();
      for (let i = 0; i < 200; i++) sim.tick();
    }

    const ctx = canvas.getContext('2d')!;

    // 世界坐标 → 屏幕坐标
    const toScreen = (x: number, y: number) => {
      const v = viewRef.current;
      return { x: x * v.scale + v.tx, y: y * v.scale + v.ty };
    };
    // 屏幕坐标 → 世界坐标
    const toWorld = (sx: number, sy: number) => {
      const v = viewRef.current;
      return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale };
    };

    function draw() {
      const v = viewRef.current;
      ctx.save();
      ctx.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx.scale(dpr, dpr);

      const hover = hoverRef.current;
      const neighbors = hover ? adjacency.get(hover) : null;

      // ---- 边 ----
      ctx.lineWidth = 1;
      for (const l of simLinks) {
        const s = l.source as SimNode;
        const t = l.target as SimNode;
        if (s.x == null || t.x == null) continue;
        const a = toScreen(s.x, s.y!);
        const b = toScreen(t.x, t.y!);
        const active =
          hover && (s.id === hover || t.id === hover);
        ctx.strokeStyle = active
          ? 'rgba(99,102,241,0.55)' // brand-ish 高亮
          : hover
            ? 'rgba(161,161,170,0.12)' // 非相邻边淡出
            : 'rgba(161,161,170,0.28)';
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // ---- 节点 ----
      ctx.font = '12px ui-sans-serif, system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const n of simNodes) {
        if (n.x == null) continue;
        const p = toScreen(n.x, n.y!);
        const r = nodeRadius(n.cardCount) * Math.min(v.scale, 1.4);
        const dim =
          hover && n.id !== hover && !(neighbors && neighbors.has(n.id));
        ctx.globalAlpha = dim ? 0.25 : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = colorOf(n.domain);
        ctx.fill();
        if (n.id === hover) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // ---- 标签：仅 hover 节点（避免大图标签糊成一片）。缩放够大时也画相邻节点名。 ----
      const labelFor = (n: SimNode) => {
        if (n.x == null) return;
        const p = toScreen(n.x, n.y!);
        const r = nodeRadius(n.cardCount) * Math.min(v.scale, 1.4);
        const text = n.name.length > 14 ? `${n.name.slice(0, 14)}…` : n.name;
        const padX = 6;
        const w = ctx.measureText(text).width + padX * 2;
        const h = 20;
        const bx = p.x - w / 2;
        const by = p.y - r - h - 4;
        ctx.fillStyle = 'rgba(24,24,27,0.92)';
        roundRect(ctx, bx, by, w, h, 6);
        ctx.fill();
        ctx.fillStyle = '#fafafa';
        ctx.fillText(text, p.x, by + h / 2 + 0.5);
      };
      if (hover) {
        const hn = simNodes.find((n) => n.id === hover);
        if (hn) labelFor(hn);
      }

      ctx.restore();
    }

    let raf = 0;
    function frame() {
      draw();
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    // ---- 命中测试：屏幕点 → 节点（取最近且在半径内者） ----
    function pickNode(sx: number, sy: number): SimNode | null {
      const w = toWorld(sx, sy);
      let best: SimNode | null = null;
      let bestD = Infinity;
      for (const n of simNodes) {
        if (n.x == null) continue;
        const dx = n.x - w.x;
        const dy = n.y! - w.y;
        const d = dx * dx + dy * dy;
        const rr = (nodeRadius(n.cardCount) + 3) / viewRef.current.scale;
        if (d <= rr * rr && d < bestD) {
          bestD = d;
          best = n;
        }
      }
      return best;
    }

    function localXY(e: PointerEvent | WheelEvent) {
      const rect = canvas!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onPointerDown(e: PointerEvent) {
      const { x, y } = localXY(e);
      const hit = pickNode(x, y);
      const d = dragRef.current;
      d.moved = false;
      d.lastX = x;
      d.lastY = y;
      if (hit) {
        d.mode = 'node';
        d.node = hit;
        hit.fx = hit.x;
        hit.fy = hit.y;
        if (!reduceMotion) sim.alphaTarget(0.2).restart();
      } else {
        d.mode = 'pan';
        d.node = null;
      }
      canvas!.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      const { x, y } = localXY(e);
      const d = dragRef.current;
      if (d.mode === 'node' && d.node) {
        const w = toWorld(x, y);
        d.node.fx = w.x;
        d.node.fy = w.y;
        d.moved = true;
      } else if (d.mode === 'pan') {
        const v = viewRef.current;
        v.tx += x - d.lastX;
        v.ty += y - d.lastY;
        d.lastX = x;
        d.lastY = y;
        d.moved = true;
      } else {
        // 仅 hover 检测
        const hit = pickNode(x, y);
        const id = hit?.id ?? null;
        if (id !== hoverRef.current) setHoverId(id);
        canvas!.style.cursor = hit ? 'pointer' : 'grab';
      }
    }

    function onPointerUp(e: PointerEvent) {
      const d = dragRef.current;
      const { x, y } = localXY(e);
      if (d.mode === 'node' && d.node && !d.moved) {
        // 点击（未拖动）→ 跳转概念详情。
        router.push(`/library/concept/${d.node.id}`);
      }
      if (d.mode === 'node' && d.node) {
        // 松手后解除固定，让布局自然恢复（拖动定位是临时的）。
        d.node.fx = null;
        d.node.fy = null;
        if (!reduceMotion) sim.alphaTarget(0);
      }
      d.mode = null;
      d.node = null;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        /* noop */
      }
      void x;
      void y;
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const { x, y } = localXY(e);
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(0.3, Math.min(3.5, v.scale * factor));
      // 以光标为锚点缩放。
      const wx = (x - v.tx) / v.scale;
      const wy = (y - v.ty) / v.scale;
      v.scale = next;
      v.tx = x - wx * next;
      v.ty = y - wy * next;
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', () => setHoverId(null));
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const ro = new ResizeObserver(() => {
      resize();
      sim.force('center', forceCenter(width / 2, height / 2));
      if (!reduceMotion) sim.alpha(0.3).restart();
    });
    ro.observe(wrap);

    return () => {
      cancelAnimationFrame(raf);
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
    // simNodes/simLinks 由 props 派生（useMemo），变化时整体重建模拟。
  }, [simNodes, simLinks, colorOf, router]);

  return (
    <div
      ref={wrapRef}
      className="relative h-[60vh] min-h-[360px] w-full touch-none overflow-hidden rounded-card border border-zinc-200/80 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/40"
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      <p className="pointer-events-none absolute bottom-2 right-3 select-none text-[11px] text-zinc-400 dark:text-zinc-500">
        滚轮缩放 · 拖拽平移 · 点击节点查看概念
      </p>
    </div>
  );
}

/** canvas 圆角矩形路径（标签气泡用）。 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
