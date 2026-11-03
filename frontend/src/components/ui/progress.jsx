import * as React from "react"
import { cn } from "cn"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
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
          globals.css), a full static bar for people who reduce motion; the style prop only for a real value */}
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          value == null
            ? "h-full w-2/5 animate-[npmpro-loader_1.2s_ease-in-out_infinite] bg-[image:var(--brand-gradient)] motion-reduce:w-full motion-reduce:animate-none"
            : "size-full flex-1 bg-primary transition-all"
        )}
        style={value == null ? undefined : { transform: `translateX(-${100 - value}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
