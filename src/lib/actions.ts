import type { Action, ParamValue } from './model';
import { short } from './fmt';

// Action-specific semantics live here, kept out of the generic fmt/pseudo rendering.
// Each rule decides whether an action has no observable effect in the shipped asset
// (e.g. a compare whose branch events are all unset and whose result goes nowhere).

const value = (a: Action, name: string): ParamValue | undefined =>
	a.params.find((p) => p.name === name)?.value;

/** an FsmEvent param that is unset (`(none)`) — fires nothing */
const noEvent = (v: ParamValue | undefined): boolean => v?.type === 'Event' && v.value === null;

/** a store slot that writes nowhere: not bound to a named variable */
const storesNowhere = (v: ParamValue | undefined): boolean =>
	!(v?.type === 'PackedVar' && v.value !== null);

/**
 * Per-action "this does nothing" rules, keyed by short class name. Only add an action here once its
 * effects are known (from the PlayMaker decomp): the rule must cover *every* way it could have an
 * effect, otherwise we'd dim something that still mutates state.
 */
const DEAD_RULES: Record<string, (a: Action) => boolean> = {
	// Logic compares/tests whose only effect is firing branch events (and, for StringCompare, an
	// optional stored bool). With every event unset and nothing stored, they are pure no-ops.
	StringCompare: (a) =>
		noEvent(value(a, 'equalEvent')) &&
		noEvent(value(a, 'notEqualEvent')) &&
		storesNowhere(value(a, 'storeResult')),
	IntCompare: (a) =>
		noEvent(value(a, 'equal')) && noEvent(value(a, 'lessThan')) && noEvent(value(a, 'greaterThan')),
	FloatCompare: (a) =>
		noEvent(value(a, 'equal')) && noEvent(value(a, 'lessThan')) && noEvent(value(a, 'greaterThan')),
	BoolTest: (a) => noEvent(value(a, 'isTrue')) && noEvent(value(a, 'isFalse'))
};

/** True when the action is enabled but, per its rule, has no observable effect. */
export function isDeadAction(a: Action): boolean {
	return DEAD_RULES[short(a.class)]?.(a) ?? false;
}
