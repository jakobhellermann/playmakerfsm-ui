import type { Action, FsmModel, Param } from './model';
import { fmtValue, short, valueKind } from './fmt';
import { isHiddenParam, storeParam } from './actions';

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
}

/**
 * Tokenised, colour-tagged form of an action line for the PseudoView. A single var-bound `store*`
 * output is lifted into an assignment prefix (`var "x" = Action(…)`); variables and events carry
 * their value colour. The plain-text `actionText` above stays the canonical (snapshot) form.
 */
export function actionTokens(a: Action): Token[] {
	const toks: Token[] = [];
	const store = storeParam(a);
	const rest = a.params.filter((p) => p !== store && !isHiddenParam(a, p));
	if (store) toks.push({ text: fmtValue(store.value), cls: 'var' }, { text: ' = ' });
	toks.push({ text: short(a.class), cls: 'act' }, { text: '(' });
	rest.forEach((p, j) => {
		if (j > 0) toks.push({ text: ', ' });
		if (p.name) toks.push({ text: `${p.name}=` });
		// a collapsed `[N elems]` list keeps its elements as hover text
		const title =
			p.value.type === 'List' ? p.value.value.map((e) => fmtValue(e.value)).join(', ') : undefined;
		toks.push({ text: fmtValue(p.value), cls: valueKind(p.value) || undefined, title });
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
