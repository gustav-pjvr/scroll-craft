// ES module entry for bundlers and the React adapter. The UMD file assigns to
// globalThis when `module` is absent (which it is in every ESM context), so the
// side-effect import below defines the global and this re-exports it.
import './scrollcraft.js';
export default globalThis.ScrollCraft;
