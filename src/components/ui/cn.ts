/**
 * 轻量 className 合并工具（无外部依赖：不引入 clsx/tailwind-merge，保持 deps 不变）。
 * 接受字符串 / 条件表达式 / falsy，过滤后以空格拼接。
 * 注意：不做 Tailwind 冲突去重，调用方自行保证后写覆盖（顺序即优先级）。
 */
export type ClassValue = string | number | false | null | undefined;

export function cn(...inputs: ClassValue[]): string {
  return inputs.filter(Boolean).join(' ');
}
