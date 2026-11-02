import { cn } from "cn"
import { Loader2Icon } from "lucide-react"

function Spinner({
  className,
  ...props
}) {
  return (
    // NPMpro: no hard-coded English label ("Loading"): the caller passes a translated aria-label, or aria-hidden inside a labelled button
    <Loader2Icon data-slot="spinner" role="status" className={cn("tw:size-4 tw:animate-spin", className)} {...props} />
  )
}

export { Spinner }
