import type { Action, Param, ParamValue } from './model';
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

/** `<short class>.<param>` pairs whose empty-string literal is just an unset default → hide it. */
const HIDDEN_EMPTY_STRINGS = new Set(['Tk2dPlayAnimation.animLibName']);

const isEmptyString = (v: ParamValue): boolean =>
	v.type === 'FsmString' && v.value.kind === 'Literal' && v.value.value === '';

/**
 * Params that are pure noise in the pseudo view because they sit at their default and carry no
 * information. Hidden from the colourised view only — the canonical text form keeps every param.
 */
export function isHiddenParam(a: Action, p: Param): boolean {
	// `everyFrame` defaults to false on every action's Reset(); `true` is the only informative value.
	if (p.name === 'everyFrame' && p.value.type === 'Bool' && p.value.value === false) return true;
	// Empty strings only via a per-action whitelist (a blank string is meaningful for some actions).
	if (isEmptyString(p.value) && HIDDEN_EMPTY_STRINGS.has(`${short(a.class)}.${p.name}`))
		return true;
	return false;
}

/** The variable a param value is bound to, if any (across the different var-bearing encodings). */
function varName(v: ParamValue): string | null {
	switch (v.type) {
		case 'PackedVar':
			return v.value;
		case 'FsmString':
			return v.value.kind === 'Var' ? v.value.value : null;
		case 'Owner':
		case 'GameObject':
		case 'Object':
			return typeof v.value === 'object' && 'Var' in v.value ? v.value.Var : null;
		case 'Var':
			return v.value.type === 'Var' ? v.value.value : null;
		default:
			return null;
	}
}

/**
 * The single output parameter an action writes into a variable, if any — PlayMaker's `store*` naming
 * convention. Returns `undefined` for actions with zero or multiple such outputs (e.g. raycasts that
 * store hit point/normal/distance at once), so those keep their plain `Action(args)` form.
 */
export function storeParam(a: Action): Param | undefined {
	const stores = a.params.filter((p) => /^store/i.test(p.name) && varName(p.value) !== null);
	return stores.length === 1 ? stores[0] : undefined;
}
