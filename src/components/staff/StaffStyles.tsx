// The staff stylesheet is imported here, from a component only the code-split
// staff layout renders, so it never blocks first paint on public pages.
// (package.json has sideEffects:false, so the import must live in a module
// that is actually used.)
import "./staff.css";

export function StaffStyles() {
  return null;
}
