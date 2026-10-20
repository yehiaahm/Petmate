import {
  Activity,
  Ban,
  BadgeCheck,
  Bell,
  BookOpen,
  Calendar,
  Cog,
  CreditCard,
  Database,
  Dna,
  FileText,
  Flag,
  Folder,
  Heart,
  HeartPulse,
  History,
  Hotel,
  Image,
  KeyRound,
  Landmark,
  Layers,
  LayoutDashboard,
  LifeBuoy,
  Mail,
  Megaphone,
  MessageCircle,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  Package,
  PawPrint,
  Radar,
  Receipt,
  Repeat,
  Scale,
  ShieldAlert,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Star,
  Stethoscope,
  Store,
  Tag,
  Truck,
  Undo2,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/lib/admin/registry";

/**
 * Icons are named in the registry and resolved here, because a component
 * cannot cross from a server component to a client one but a string can.
 */

export type NavIconName =
  | IconName
  | "dashboard"
  | "shield"
  | "settings"
  | "database"
  | "activity"
  | "health";

const ICONS: Record<NavIconName, LucideIcon> = {
  users: Users,
  key: KeyRound,
  paw: PawPrint,
  tag: Tag,
  heart: Heart,
  dna: Dna,
  book: BookOpen,
  stethoscope: Stethoscope,
  calendar: Calendar,
  hotel: Hotel,
  store: Store,
  package: Package,
  folder: Folder,
  cart: ShoppingCart,
  receipt: Receipt,
  truck: Truck,
  card: CreditCard,
  undo: Undo2,
  landmark: Landmark,
  file: FileText,
  layers: Layers,
  repeat: Repeat,
  megaphone: Megaphone,
  star: Star,
  flag: Flag,
  scale: Scale,
  badge: BadgeCheck,
  radar: Radar,
  lifebuoy: LifeBuoy,
  message: MessageSquare,
  messages: MessagesSquare,
  "users-round": UsersRound,
  newspaper: Newspaper,
  comment: MessageCircle,
  bell: Bell,
  mail: Mail,
  cog: Cog,
  image: Image,
  history: History,
  ban: Ban,
  sparkles: Sparkles,
  dashboard: LayoutDashboard,
  shield: ShieldAlert,
  settings: SlidersHorizontal,
  database: Database,
  activity: Activity,
  health: HeartPulse,
};

export function AdminIcon({ name, className }: { name: NavIconName; className?: string }) {
  const Icon = ICONS[name] ?? Database;
  return <Icon className={className} aria-hidden />;
}
