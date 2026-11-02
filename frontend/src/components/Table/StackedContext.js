import { createContext, useContext } from "react";

// True inside the body of a stacked table (rows become cards below md), so an empty state passed in by a page can
// lay itself out as a full-width block on phones without a prop on every caller
const StackedContext = createContext(false);

const useStacked = () => useContext(StackedContext);

// The empty row and its one cell below md in a stacked table: blocks at full width, not table parts that shrink to
// their content inside the block table (set on the elements themselves, the row rules of the body do not reach them)
const STACKED_EMPTY_ROW = "max-md:block max-md:w-full";
const STACKED_EMPTY_CELL = "max-md:block max-md:w-full";

export { STACKED_EMPTY_CELL, STACKED_EMPTY_ROW, StackedContext, useStacked };
