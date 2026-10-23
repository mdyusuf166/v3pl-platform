import type { LucideIcon } from "lucide-react";

type Props = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
};

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed px-6 py-14 text-center animate-in fade-in duration-300 fill-mode-both motion-reduce:animate-none">
      {Icon && <Icon className="mb-3 size-8 text-muted-foreground animate-in fade-in zoom-in-95 duration-300 fill-mode-both motion-reduce:animate-none" />}
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
