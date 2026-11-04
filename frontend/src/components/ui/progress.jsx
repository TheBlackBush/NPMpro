import * as React from "react"
import { cn } from "cn"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  solid = false, // NPMpro: a plain bg-primary fill for meters that compare values (Monitoring top lists)
  ...props
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={value} // NPMpro: Radix needs the value for aria-valuenow and data-state; none means indeterminate
      className={cn(
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    >
      {/* NPMpro: without a value the bar is indeterminate: a brand gradient segment that slides (npmpro-loader in
          globals.css), a full static bar for people who reduce motion. With a value the brand gradient spans the
          whole track and the clip shows its first value% with a rounded end, so 30% shows the first 30% of the
          colours; the style prop only for a real value */}
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          value == null
            ? "h-full w-2/5 animate-[npmpro-loader_1.2s_ease-in-out_infinite] rounded-full bg-[image:var(--brand-gradient)] motion-reduce:w-full motion-reduce:animate-none"
            : solid
              ? "size-full flex-1 bg-primary transition-all"
              : "size-full flex-1 rounded-full bg-[image:var(--brand-gradient)] transition-[clip-path]"
        )}
        style={
          value == null
            ? undefined
            : solid
              ? { transform: `translateX(-${100 - value}%)` }
              : { clipPath: `inset(0 ${100 - value}% 0 0 round 9999px)` }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
