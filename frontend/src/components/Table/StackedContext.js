import { createContext, useContext } from "react";
import { STACK_MODES } from "src/modules/TableStack";

// True inside the body of a stacked table (rows become cards on narrow widths), so an empty state passed in by a page
// can lay itself out as a full-width block on phones without a prop on every caller
const StackedContext = createContext(false);

const useStacked = () => useContext(StackedContext);

// "viewport" or "container": what the stacking follows, see modules/TableStack.js
const StackModeContext = createContext("viewport");

const useStack = () => STACK_MODES[useContext(StackModeContext)] ?? STACK_MODES.viewport;

export { StackedContext, StackModeContext, useStack, useStacked };
