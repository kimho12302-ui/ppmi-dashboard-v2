import { cn } from "@/lib/utils";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export function Card({ children, className, ...props }: CardProps) {
  return (
    // ★ 그림자를 인라인 style 로 주면 인라인이 항상 이기므로 surface-hero/-sunken
    //   계층 클래스가 무력화된다. 클래스(.card-base)로 내려서 계층이 덮을 수 있게 한다.
    <div
      className={cn(
        "card-base rounded-xl border bg-card text-card-foreground",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className, ...props }: CardProps) {
  return (
    <div className={cn("px-6 py-4 border-b", className)} {...props}>
      {children}
    </div>
  );
}

export function CardContent({ children, className, ...props }: CardProps) {
  return (
    <div className={cn("px-6 py-4", className)} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn("text-sm font-semibold text-muted-foreground", className)} {...props}>
      {children}
    </h3>
  );
}
