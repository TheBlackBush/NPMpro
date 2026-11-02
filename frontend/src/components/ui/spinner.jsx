import { cn } from "cn"
import { Loader2Icon } from "lucide-react"
import { intl } from "src/locale" // NPMpro: translated labels

function Spinner({
  className,
  ...props
}) {
  return (
    <Loader2Icon
      data-slot="spinner"
      role="status"
      aria-label={intl.formatMessage({ id: "loading" })} // NPMpro: translated
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

export { Spinner }
