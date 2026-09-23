// Types for scrollcraft-react.js. Hand-written; keep in step with the JS file
// and with the engine api in lab/DESIGN.md §3.1.
import type {
  ForwardRefExoticComponent,
  HTMLAttributes,
  ReactElement,
  ReactNode,
  RefAttributes,
  RefObject
} from 'react';

export type ScrollCraftScope = 'auto' | 'page' | 'section';
export type ScrollCraftMedia = 'auto' | 'lite' | 'full';

/** The api object returned by ScrollCraft.mount(). */
export interface ScrollCraftApi {
  layout(): void;
  read(): void;
  acts: ReadonlyArray<unknown>;
  worlds: ReadonlyArray<unknown>;
  clips: ReadonlyArray<unknown>;
  lerp: number;
  root: Element;
  scope: 'page' | 'section';
  /** Live getter. */
  readonly media: 'lite' | 'full';
  subscribe(fn: (api: ScrollCraftApi) => void): () => void;
  refresh(): void;
  rescan(): void;
  destroy(): void;
  readonly destroyed: boolean;
}

export interface ScrollCraftMountOptions {
  scope?: ScrollCraftScope;
  media?: ScrollCraftMedia;
  lerp?: number;
  onRead?: (api: ScrollCraftApi) => void;
}

/** The engine global (window.ScrollCraft, or the default export of engine/scrollcraft.esm.js). */
export interface ScrollCraftEngine {
  mount(root?: Element | Document | string, opts?: ScrollCraftMountOptions): ScrollCraftApi;
  readonly reduce: boolean;
  instances: ScrollCraftApi[];
  version?: string;
}

/** A module namespace with a default export, or the object itself. */
export type Loadable<T> = T | { default: T };

/** Async loader for the engine, for consumers who copied it somewhere else. */
export type EngineLoader = () => Promise<Loadable<ScrollCraftEngine>>;

/** Handle returned by the 3D module's mount (engine/scrollcraft-3d.js, DESIGN.md §3.4). */
export interface ScrollCraft3DHandle {
  destroy(): void;
  capture?(actEl: Element, opts?: { p?: number; width?: number; height?: number; dpr?: number }): Promise<Blob>;
}

export interface ScrollCraft3DModule {
  mount(root: Element, opts?: Record<string, unknown> & { api?: ScrollCraftApi }): ScrollCraft3DHandle | Promise<ScrollCraft3DHandle>;
}

export type ThreeDLoader = () => Promise<Loadable<ScrollCraft3DModule>>;

export interface UseScrollCraftOptions extends ScrollCraftMountOptions {
  /** Default: import('../../engine/scrollcraft.esm.js'). Define it at module scope so its identity is stable. */
  engine?: EngineLoader;
  /**
   * When the contents of this array change (element-wise, Object.is), the hook calls api.rescan()
   * once (not a remount). Its length may change and it may be omitted; omitted counts as [].
   */
  deps?: ReadonlyArray<unknown>;
  /** Optional loader for the 3D module; mounted after the engine, destroyed in the same cleanup. */
  threeD?: ThreeDLoader;
  /** Passed to ScrollCraft3D.mount(root, { ...threeDOptions, api }). */
  threeDOptions?: Record<string, unknown>;
  /** Called once per mount with the live api. */
  onReady?: (api: ScrollCraftApi) => void;
}

/**
 * Mount the engine on ref.current for the life of the component. Returns a ref
 * holding the live api (null before mount and after unmount).
 */
export function useScrollCraft(
  ref: RefObject<Element | null>,
  options?: UseScrollCraftOptions
): RefObject<ScrollCraftApi | null>;

/** Resolve the engine before first render so the effect can mount synchronously. */
export function preloadScrollCraft(loader?: EngineLoader): Promise<ScrollCraftEngine>;

/** The live api ref of the nearest <ScrollCraft>, or null outside one. */
export function useScrollCraftApi(): RefObject<ScrollCraftApi | null> | null;

type IntrinsicTag = keyof HTMLElementTagNameMap;

export interface ScrollCraftProps
  extends Omit<HTMLAttributes<HTMLElement>, 'children'>,
    Omit<UseScrollCraftOptions, 'scope'> {
  /** Element to render. Default 'section'. */
  as?: IntrinsicTag;
  /** Default 'section'; the element then also gets class "sc-scope". */
  scope?: ScrollCraftScope;
  /** Keep static. React re-setting className drops the classes the engine added. */
  className?: string;
  children?: ReactNode;
}

export const ScrollCraft: ForwardRefExoticComponent<ScrollCraftProps & RefAttributes<HTMLElement>>;

export interface KineticProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'dangerouslySetInnerHTML'> {
  /** Element to render. Default 'h2'. */
  as?: IntrinsicTag;
  /** data-sc-cue: "from [to [rampIn [rampOut]]]" in act progress. Default "0". */
  cue?: string | number;
  /** data-sc-kinetic. Default 'lines'. */
  split?: 'lines' | 'words' | 'chars';
  /** data-sc-rise. */
  rise?: number | string;
  /** Plain text only (strings and numbers). It is HTML-escaped. */
  children?: string | number | ReadonlyArray<string | number | boolean | null | undefined>;
}

export function Kinetic(props: KineticProps): ReactElement;

export const _escapeHtml: (s: unknown) => string;
export const _unwrapEngine: (mod: unknown, globalName?: string) => ScrollCraftEngine | null;
