/**
 * 全站图标中心（基于 lucide-react，线性风格，与底栏 SVG 同一语言）。
 *
 * 取代散落各处的 emoji（✏️🎙️🔗🖼️📝💡🎉✅🗑️… ）与零散内联 SVG：
 *  - 记录类型（text/voice/link/image）统一走 NoteTypeIcon，一处定义、各页引用；
 *  - 语义/操作/状态图标从这里具名再导出，调用方只认 ui 层、不直接 import lucide，
 *    便于日后整体换库或调风格。
 *
 * 约定：装饰性图标加 aria-hidden（由 lucide 默认行为 + 这里统一关闭 focusable）；
 * 需要语义的场景由调用方在外层补 aria-label / title。
 */
import {
  Pencil,
  Mic,
  Link2,
  Image as ImageIcon,
  FileText,
  Lightbulb,
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Trash2,
  RotateCcw,
  Search,
  X,
  Clock,
  MessageCircleQuestion,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Plus,
  Mail,
  PartyPopper,
  Leaf,
  GraduationCap,
  BookOpen,
  BookOpenCheck,
  Sun,
  Moon,
  Monitor,
  Loader2,
  Copy,
  Check,
  Flame,
  TrendingUp,
  CornerDownLeft,
  ArrowUp,
  ArrowDown,
  Target,
  Zap,
  EyeOff,
  Keyboard,
  Save,
  CalendarClock,
  Home,
  Volume2,
  VolumeX,
  Bug,
  Undo2,
  Layers,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

export type { LucideIcon, LucideProps };

// —— 语义 / 操作 / 状态图标：具名再导出，调用方从 '@/components/ui' 取 —— //
export {
  Pencil as TextIcon,
  Pencil as EditIcon,
  Mic as VoiceIcon,
  Link2 as LinkIcon,
  ImageIcon,
  FileText as NoteIcon,
  Lightbulb as WhyIcon,
  Sparkles as AiIcon,
  CheckCircle2 as SuccessIcon,
  XCircle as FailIcon,
  AlertTriangle as WarningIcon,
  Trash2 as TrashIcon,
  RotateCcw as RestoreIcon,
  Search as SearchIcon,
  X as CloseIcon,
  Clock as ClockIcon,
  MessageCircleQuestion as AskIcon,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Plus as PlusIcon,
  Mail as MailIcon,
  PartyPopper as CelebrateIcon,
  Leaf as RestIcon,
  GraduationCap as GraduateIcon,
  BookOpen as LibraryIcon,
  BookOpenCheck as ReviewIcon,
  Sun as SunIcon,
  Moon as MoonIcon,
  Monitor as SystemIcon,
  Loader2 as SpinnerIcon,
  Copy as CopyIcon,
  Check as CheckIcon,
  Flame as StreakIcon,
  TrendingUp as TrendIcon,
  CornerDownLeft as EnterIcon,
  ArrowUp as ArrowUpIcon,
  ArrowDown as ArrowDownIcon,
  Target as GoalIcon,
  Zap as ComboIcon,
  EyeOff as SuspendIcon,
  Keyboard as KeyboardIcon,
  Save as SaveIcon,
  CalendarClock as DueIcon,
  Home as HomeIcon,
  Volume2 as SpeakIcon,
  VolumeX as MuteIcon,
  Bug as LeechIcon,
  Undo2 as UndoIcon,
  Layers as CramIcon,
};

/** 记录类型 → 图标组件（一处定义，替代各页重复的 TYPE_ICON emoji 表）。 */
const NOTE_TYPE_ICONS: Record<string, LucideIcon> = {
  text: Pencil,
  voice: Mic,
  link: Link2,
  image: ImageIcon,
};

/** 记录类型 → 中文标签（记录详情页类型行复用）。 */
export const NOTE_TYPE_LABELS: Record<string, string> = {
  text: '文本',
  voice: '语音',
  link: '链接',
  image: '图片',
};

/**
 * 记录类型图标（text/voice/link/image，未知回退通用 note 图标）。
 * 默认 1em 跟随字号；可用 className 覆盖尺寸/颜色。
 */
export function NoteTypeIcon({
  type,
  className = 'h-[1.05em] w-[1.05em]',
  ...props
}: { type: string } & Omit<LucideProps, 'ref'>) {
  const Icon = NOTE_TYPE_ICONS[type] ?? FileText;
  return <Icon aria-hidden className={className} {...props} />;
}
