import {
  DEFAULT_DIALS,
  dialConfigFrom,
  type DialConfig,
  type DialSettings,
} from '../../research/settings.js';
import type { ResearchSessionStore } from '../../research/store.js';
import type { CliDependencies } from '../dependencies.js';
import type { CouncilPreset } from '../presets.js';
import { basketSize, createBasket, type ContextBasket } from './basket.js';

/** Which providers plain-text prompts go to. */
export type ProviderSelection =
  | { kind: 'auto' }
  | { kind: 'all' }
  | { kind: 'named'; names: string[] };

export interface ChatTurn {
  role: 'user' | 'duck';
  text: string;
}

/** Mutable state that lives for one interactive shell session. */
export interface ShellState {
  selectedSession?: string;
  selection: ProviderSelection;
  preset?: CouncilPreset;
  repoRoot: string;
  /** Effective novelty and skepticism (environment and settings file); shown in the prompt. */
  dials: DialConfig;
  /** Conversation history per provider name. */
  chats: Map<string, ChatTurn[]>;
  /** Session ids shown by the last report listing, so `/open 2` can refer to them. */
  lastReportListing: string[];
  /** Files, patterns, and pasted snippets shared by chat and `/run`. */
  basket: ContextBasket;
  /** Packet hashes the person already agreed to send this session. */
  confirmedPackets: Set<string>;
  /** Provider names seen so far, for completion. */
  knownProviders: string[];
  closing: boolean;
}

export interface ShellContext extends CliDependencies {
  store: ResearchSessionStore;
  state: ShellState;
  /** Aborted when the person interrupts the current command. */
  signal?: AbortSignal;
}

export function createShellState(
  store: ResearchSessionStore,
  cwd: string,
  dials: DialConfig = dialConfigFrom(undefined)
): ShellState {
  return {
    selectedSession: store.currentId(),
    selection: { kind: 'auto' },
    repoRoot: cwd,
    dials,
    chats: new Map(),
    lastReportListing: [],
    basket: createBasket(),
    confirmedPackets: new Set(),
    knownProviders: [],
    closing: false,
  };
}

/** The single provider a `named` selection points at, or undefined for auto/all. */
export function selectedProviderName(state: ShellState): string | undefined {
  return state.selection.kind === 'named' ? state.selection.names[0] : undefined;
}

export function describeSelection(selection: ProviderSelection): string | undefined {
  if (selection.kind === 'auto') return undefined;
  if (selection.kind === 'all') return 'all';
  return selection.names.join('+');
}

/** `N8/S5` when either dial is off its default; undefined otherwise. */
export function describeDialsSuffix(dials: DialSettings): string | undefined {
  if (dials.novelty === DEFAULT_DIALS.novelty && dials.skepticism === DEFAULT_DIALS.skepticism) {
    return undefined;
  }
  return `N${dials.novelty}/S${dials.skepticism}`;
}

/** `scope · ducks · preset · N8/S5 · ctx:3` for the readline prompt. */
export function promptText(state: ShellState): string {
  const parts = [state.selectedSession || 'home'];
  const selection = describeSelection(state.selection);
  if (selection) parts.push(selection);
  if (state.preset) parts.push(state.preset.name);
  const dials = describeDialsSuffix(state.dials);
  if (dials) parts.push(dials);
  const items = basketSize(state.basket);
  if (items > 0) parts.push(`ctx:${items}`);
  return `${parts.join(' · ')}> `;
}

export function chatTurns(state: ShellState, provider: string): ChatTurn[] {
  let turns = state.chats.get(provider);
  if (!turns) {
    turns = [];
    state.chats.set(provider, turns);
  }
  return turns;
}

/** Prior turns in the `User: …` / `Duck: …` form the grounded-ask prompt expects. */
export function priorTurnLines(turns: ChatTurn[]): string[] {
  return turns.map((turn) => `${turn.role === 'user' ? 'User' : 'Duck'}: ${turn.text}`);
}

/** Remember provider names for tab completion. */
export function rememberProviders(state: ShellState, names: readonly string[]): void {
  for (const name of names)
    if (!state.knownProviders.includes(name)) state.knownProviders.push(name);
}
