/**
 * 统一表单控件样式（input / textarea / select 共用 fieldClass）。
 * 统一边框、圆角、focus 环（focus-visible 友好）、深色配色、占位符色，
 * 取代各录入组件里手写且略有出入的一长串类名。
 */
import { forwardRef } from 'react';
import { cn } from './cn';

const FIELD =
  'w-full rounded-field border border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-400 shadow-sm outline-none transition duration-150 ease-smooth hover:border-zinc-300 focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:hover:border-zinc-600';

/** 供少量需要手写控件的地方复用（如 select、原生 details 内输入）。 */
export function fieldClass(extra?: string) {
  return cn(FIELD, extra);
}

export const Input = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(FIELD, 'px-4 py-3 text-base', className)}
      {...props}
    />
  );
});

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(FIELD, 'resize-none px-4 py-3 text-base leading-relaxed', className)}
      {...props}
    />
  );
});
