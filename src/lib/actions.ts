import type { Action, Param, ParamValue } from './model';
import { short } from './fmt';

// Action-specific semantics live here, kept out of the generic fmt/pseudo rendering: which actions
// are no-ops (dead), which params are default noise the pseudo view hides, and which param is an
// action's variable output. Defaults are taken from the PlayMaker decomp (each action's Reset).

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

/** `<short class>.<param>` pairs whose literal `0` is the action's default (per its Reset) → hide it. */
const HIDDEN_ZERO_FLOATS = new Set(['FloatCompare.tolerance']);

/** `<short class>.<param>` pairs whose literal `false` is the action's default (per its Reset) → hide. */
const HIDDEN_FALSE_BOOLS = new Set(['AnimatePositionTo.reverse', 'AnimatePositionTo.realTime']);

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
	// Whitelisted numeric defaults (e.g. FloatCompare.tolerance = 0).
	if (
		p.value.type === 'Float' &&
		p.value.value === 0 &&
		HIDDEN_ZERO_FLOATS.has(`${short(a.class)}.${p.name}`)
	)
		return true;
	// Whitelisted false-bool defaults (e.g. AnimatePositionTo.reverse / .realTime).
	if (
		p.value.type === 'Bool' &&
		p.value.value === false &&
		HIDDEN_FALSE_BOOLS.has(`${short(a.class)}.${p.name}`)
	)
		return true;
	// `FsmOwnerDefault` set to UseOwner (`Self`) is the implicit target — only a specified object is news.
	if (p.value.type === 'Owner' && p.value.value === 'SelfOwner') return true;
	// An event target of kind 0 (`Self`) with no specific FSM is the implicit "send to myself" default
	// (e.g. SendEvent / SendEventByName) — same idea as the owner Self above.
	if (p.value.type === 'EventTarget' && p.value.value.kind === 0 && !p.value.value.fsm_name)
		return true;
	// An unbound variable slot (`<var>`): use-variable is set but no variable was chosen, so the param
	// has no effect (e.g. SetPosition leaves that axis unchanged, a store writes nowhere).
	if (p.value.type === 'PackedVar' && p.value.value === null) return true;
	// Same idea for an FsmVar slot that points at no variable: `(unset var)` / `(unused)`.
	if (p.value.type === 'Var' && (p.value.value.type === 'Unset' || p.value.value.type === 'Unused'))
		return true;
	// An unset event branch (`equal=(none)`, `isFalse=(none)` …) fires nothing — keep only wired events.
	if (p.value.type === 'Event' && p.value.value === null) return true;
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

/** Binary math operators rendered as expressions — class → [leftParam, rightParam]. */
const OPERATORS: Record<string, [string, string]> = {
	FloatOperator: ['float1', 'float2'],
	IntOperator: ['integer1', 'integer2']
};
// PlayMaker's Operation enum order; the first four are infix, Min/Max render as min()/max().
const OP_SYMBOLS = ['+', '-', '*', '/', 'min', 'max'];

/**
 * A binary math operator's operands and operator symbol, for rendering `a * b` / `min(a, b)`.
 * `undefined` if the action isn't a known operator or its `operation` enum is out of range.
 */
export function binaryOp(
	a: Action
): { left: Param; right: Param; op: string; infix: boolean } | undefined {
	const names = OPERATORS[short(a.class)];
	if (!names) return undefined;
	const left = a.params.find((p) => p.name === names[0]);
	const right = a.params.find((p) => p.name === names[1]);
	const operation = a.params.find((p) => p.name === 'operation')?.value;
	if (!left || !right || operation?.type !== 'Int') return undefined;
	const op = OP_SYMBOLS[operation.value];
	return op === undefined ? undefined : { left, right, op, infix: operation.value < 4 };
}

/** Pure variable-assignment actions, rendered as `<target var> = <value>` — class → [target, value]. */
const SETTERS: Record<string, [string, string]> = {
	SetBoolValue: ['boolVariable', 'boolValue'],
	SetFloatValue: ['floatVariable', 'floatValue'],
	SetIntValue: ['intVariable', 'intValue'],
	SetStringValue: ['stringVariable', 'stringValue'],
	SetVector2Value: ['vector2Variable', 'vector2Value'],
	SetVector3Value: ['vector3Variable', 'vector3Value']
};

/**
 * A pure setter action's target (a variable) and value params — for rendering `var "x" = value`.
 * `undefined` if the action isn't a known setter or its target isn't actually a variable.
 */
export function setter(a: Action): { target: Param; value: Param } | undefined {
	const names = SETTERS[short(a.class)];
	if (!names) return undefined;
	const target = a.params.find((p) => p.name === names[0]);
	const value = a.params.find((p) => p.name === names[1]);
	if (target && value && varName(target.value) !== null) return { target, value };
	return undefined;
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
