import type { Action, FsmModel, Param } from './model';
import { fmtValue, short, valueKind } from './fmt';
import { binaryOp, compoundOp, isHiddenParam, setter, storeParam } from './actions';

/** compact one-line arg list for an action: `name=value, …` (unnamed params show just the value) */
export function args(params: Param[]): string {
	return params
		.map((p) => {
			const v = fmtValue(p.value);
			return p.name ? `${p.name}=${v}` : v;
		})
		.join(', ');
}

/** one line for an action: `ActionClass(args)`, with a trailing `// disabled` when not enabled */
export function actionText(a: FsmModel['states'][number]['actions'][number]): string {
	const line = `${short(a.class)}(${args(a.params)})`;
	return a.enabled ? line : `${line}  // disabled`;
}

/** A colorised fragment of an action line: `cls` is the css colour class (omitted = default text). */
export interface Token {
	text: string;
	cls?: string;
	/** hover text — used to reveal the elements behind a collapsed `[N elems]` list */
	title?: string;
	/** event name — when this token is an event value (→"CANCEL"), for click-to-navigate */
	event?: string;
}

/**
 * Tokenised, colour-tagged form of an action line for the PseudoView. Several action shapes get a
 * friendlier rendering — math operators as `a * b`, setters and single var-bound `store*` outputs as
 * `var "x" = …` — otherwise it's `Action(args)`. The plain-text `actionText` stays the canonical form.
 */
export function actionTokens(a: Action): Token[] {
	const valueToken = (p: Param): Token => {
		// a collapsed `[N elems]` list keeps its elements as hover text
		const title =
			p.value.type === 'List' ? p.value.value.map((e) => fmtValue(e.value)).join(', ') : undefined;
		return {
			text: fmtValue(p.value),
			cls: valueKind(p.value) || undefined,
			title,
			event: p.value.type === 'Event' && p.value.value ? p.value.value : undefined
		};
	};
	// small lists render inline (`[a, b]`, each element coloured); large ones stay collapsed.
	const LIST_INLINE_MAX = 12;
	const valueTokens = (p: Param): Token[] => {
		if (p.value.type !== 'List' || p.value.value.length > LIST_INLINE_MAX) return [valueToken(p)];
		const out: Token[] = [{ text: '[' }];
		p.value.value.forEach((e, i) => {
			if (i > 0) out.push({ text: ', ' });
			out.push(valueToken(e));
		});
		out.push({ text: ']' });
		return out;
	};

	// in-place arithmetic collapses to `var "x" += y` — only when no flag (perSecond, …) is visible.
	const comp = compoundOp(a);
	if (comp) {
		const used = [comp.target, comp.operand];
		const others = a.params.filter((p) => !used.includes(p) && !isHiddenParam(a, p));
		if (others.length === 0) {
			return [
				{ text: fmtValue(comp.target.value), cls: 'var' },
				{ text: ` ${comp.op}= ` },
				valueToken(comp.operand)
			];
		}
	}

	const store = storeParam(a);

	// binary math operators: `target = a * b` (Min/Max as `min(a, b)`)
	const op = binaryOp(a);
	if (store && op) {
		const used = [store, op.left, op.right];
		const others = a.params.filter(
			(p) => !used.includes(p) && p.name !== 'operation' && !isHiddenParam(a, p)
		);
		if (others.length === 0) {
			const lhs: Token = { text: fmtValue(store.value), cls: 'var' };
			return op.infix
				? [lhs, { text: ' = ' }, valueToken(op.left), { text: ` ${op.op} ` }, valueToken(op.right)]
				: [
						lhs,
						{ text: ' = ' },
						{ text: `${op.op}(` },
						valueToken(op.left),
						{ text: ', ' },
						valueToken(op.right),
						{ text: ')' }
					];
		}
	}

	// pure setter actions collapse to `var "x" = value` — but only when nothing else is visible
	// (e.g. an everyFrame=true would otherwise be dropped), else fall through to the normal form.
	const set = setter(a);
	if (set) {
		const others = a.params.filter(
			(p) => p !== set.target && p !== set.value && !isHiddenParam(a, p)
		);
		if (others.length === 0) {
			return [
				{ text: fmtValue(set.target.value), cls: 'var' },
				{ text: ' = ' },
				valueToken(set.value)
			];
		}
	}

	const toks: Token[] = [];
	const rest = a.params.filter((p) => p !== store && !isHiddenParam(a, p));
	if (store) toks.push({ text: fmtValue(store.value), cls: 'var' }, { text: ' = ' });
	toks.push({ text: short(a.class), cls: 'act' }, { text: '(' });
	rest.forEach((p, j) => {
		if (j > 0) toks.push({ text: ', ' });
		if (p.name) toks.push({ text: `${p.name}=` });
		toks.push(...valueTokens(p));
	});
	toks.push({ text: ')' });
	return toks;
}

/**
 * Canonical plain-text pseudocode for an FSM. The PseudoView component renders a colorised version
 * of the same structure; this text form is what the snapshot tests pin.
 */
export function toPseudocode(model: FsmModel): string {
	const out: string[] = [`fsm ${model.name} {`, `  start ${model.start_state}`];
	for (const t of model.global_transitions) {
		out.push(`  on ${t.event} → ${t.to_state}  // from any state`);
	}
	for (const s of model.states) {
		out.push('', `  state ${s.name} {`);
		for (const a of s.actions) out.push(`    ${actionText(a)}`);
		for (const t of s.transitions) out.push(`    on ${t.event} → ${t.to_state}`);
		out.push('  }');
	}
	out.push('}');
	return out.join('\n');
}
