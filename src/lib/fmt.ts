import type {
	ArrayValue,
	Call,
	EnumValue,
	EventTarget,
	GoRef,
	ObjectRef,
	ParamValue,
	Property,
	StrValue,
	TemplateControl,
	Value,
	VarValue
} from './model';

export const short = (cls: string) => cls.split('.').pop() ?? cls;
const q = (s: string) => JSON.stringify(s);

export function fmtObjectRef(r: ObjectRef): string {
	let loc: string;
	switch (r.target.kind) {
		case 'Null':
			return '<null>';
		case 'Path':
			loc = r.target.target;
			break;
		case 'Loose':
			loc = r.target.target.name ?? `loose:${r.target.target.id}`;
			break;
	}
	return r.file ? `${loc} (${r.file})` : loc;
}

export function fmtGoRef(r: GoRef): string {
	if (r === 'SelfOwner') return 'Self';
	if ('Var' in r) return `var ${q(r.Var)}`;
	return fmtObjectRef(r.Object);
}

function fmtStr(s: StrValue): string {
	return s.kind === 'Var' ? `var ${q(s.value)}` : q(s.value);
}

function fmtEnum(e: EnumValue): string {
	switch (e.kind) {
		case 'Var':
			return `var ${q(e.value)}`;
		case 'Named':
			return `${short(e.value.enum_name)}(${e.value.value})`;
		case 'Value':
			return String(e.value);
	}
}

function fmtArray(a: ArrayValue): string {
	return a.kind === 'Var' ? `var ${q(a.value)}` : `array[${a.value.length} elems]`;
}

function fmtVar(v: VarValue): string {
	switch (v.type) {
		case 'Var':
			return `var ${q(v.value)}`;
		case 'Unset':
			return '(unset var)';
		case 'Unused':
			return '(unused)';
		case 'Float':
		case 'Int':
			return String(v.value);
		case 'Bool':
			return String(v.value);
		case 'Str':
			return q(v.value);
		case 'Object':
			return fmtObjectRef(v.value);
		case 'Vector':
			return `(${v.value.join(',')})`;
		case 'Enum':
			return `enum(${v.value})`;
		case 'Array':
			return fmtArray(v.value);
	}
}

function fmtEventTarget(t: EventTarget): string {
	const kind =
		['Self', 'GameObject', 'GameObjectFSM', 'FSMComponent', 'BroadcastAll', 'HostFSM', 'SubFSMs'][
			t.kind
		] ?? '?';
	const bits: string[] = [];
	if (t.kind === 1 || t.kind === 2) bits.push(fmtGoRef(t.game_object));
	if (t.fsm_name) bits.push(`fsm=${q(t.fsm_name)}`);
	return bits.length ? `${kind}(${bits.join(', ')})` : kind;
}

// the active parameter value of a FunctionCall (a `Value`, the variant decode.rs selects by type)
function fmtCallValue(v: Value): string {
	switch (v.type) {
		case 'Var':
			return `var ${q(v.value)}`;
		case 'Bool':
		case 'Int':
		case 'Float':
			return String(v.value);
		case 'Str':
			return q(v.value);
		case 'Vector':
			return `(${v.value.join(', ')})`;
		case 'Enum':
			return `${short(v.value.enum_name)}(${v.value.value})`;
		case 'Object':
			return fmtObjectRef(v.value);
		case 'Array':
			return fmtArray(v.value);
	}
}

function fmtFunction(f: Call): string {
	if (!f.parameter_type || f.parameter_type === 'None') return `${f.function}()`;
	// fall back to the bare type when the value couldn't be decoded
	return f.value
		? `${f.function}(${fmtCallValue(f.value)})`
		: `${f.function}(<${f.parameter_type}>)`;
}

function fmtProperty(p: Property): string {
	const ty = short(p.type_name);
	return p.property ? `${ty}.${p.property}` : ty;
}

function fmtTemplate(t: TemplateControl): string {
	const vmap = (es: { variable: string; value: VarValue }[], arrow: string) =>
		es.map((o) =>
			o.value.type === 'Var' ? `${o.variable}${arrow}var ${q(o.value.value)}` : o.variable
		);
	const parts = [`template=${t.template}`];
	for (const [label, vars] of [
		['in', vmap(t.inputs, '<-')],
		['out', vmap(t.outputs, '->')],
		['vars', vmap(t.overrides, '=')]
	] as const) {
		if (vars.length) parts.push(`${label}[${vars.join(', ')}]`);
	}
	if (t.events.length) parts.push(`events[${t.events.map(([f, to]) => `${f}->${to}`).join(', ')}]`);
	return parts.join(' ');
}

// single-line rendering of a parameter value (List is rendered structurally by the component)
export function fmtValue(v: ParamValue): string {
	switch (v.type) {
		case 'Bool':
		case 'Int':
		case 'Float':
			return String(v.value);
		case 'Vector':
			return `(${v.value.join(', ')})`;
		case 'PackedVar':
			return v.value === null ? '(unset)' : `var ${q(v.value)}`;
		case 'Event':
			return v.value === null ? '(none)' : `→${q(v.value)}`;
		case 'Str':
			return q(v.value);
		case 'FsmString':
			return fmtStr(v.value);
		case 'Owner':
		case 'GameObject':
		case 'Object':
			return fmtGoRef(v.value);
		case 'Var':
			return fmtVar(v.value);
		case 'EventTarget':
			return fmtEventTarget(v.value);
		case 'Function':
			return fmtFunction(v.value);
		case 'Template':
			return fmtTemplate(v.value);
		case 'Enum':
			return fmtEnum(v.value);
		case 'EnumMember':
			return v.value;
		case 'Array':
			return fmtArray(v.value);
		case 'Property':
			return fmtProperty(v.value);
		case 'AnimCurve':
			return `curve[${v.value.keys.length} keys]`;
		case 'List':
			return `[${v.value.length} elems]`;
		case 'Pptr':
			return fmtObjectRef(v.value);
		case 'Raw':
			return `(${v.value.length}B)`;
	}
}

// css class for coloring a value
export function valueKind(v: ParamValue): string {
	if (v.type === 'Event') return 'event';
	const s = fmtValue(v);
	if (s.startsWith('var ')) return 'var';
	if (v.type === 'Str' || (v.type === 'FsmString' && v.value.kind === 'Literal')) return 'str';
	return '';
}
