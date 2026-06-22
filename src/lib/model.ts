// Hand-written mirror of the Rust `playmakerfsm::model` JSON shape. Discriminator styles vary by
// enum (the Rust types use different serde taggings): {type,value}, {kind,value}, {kind,target},
// and plain external tagging. Each enum below documents which it uses.

export interface FsmModel {
	name: string;
	start_state: string;
	events: Event[];
	global_transitions: Transition[];
	states: State[];
	variables: Variable[];
}

export interface Event {
	name: string;
	is_global: boolean;
	is_system: boolean;
}

export interface Transition {
	event: string;
	to_state: string;
}

export interface State {
	name: string;
	is_start: boolean;
	transitions: Transition[];
	actions: Action[];
}

export interface Action {
	class: string;
	custom_name: string | null;
	enabled: boolean;
	params: Param[];
}

export interface Param {
	name: string;
	type_name: string;
	value: ParamValue;
}

// tag="type", content="value"
export type ParamValue =
	| { type: 'Bool'; value: boolean }
	| { type: 'Int'; value: number }
	| { type: 'Float'; value: number }
	| { type: 'Vector'; value: number[] }
	| { type: 'PackedVar'; value: string | null }
	| { type: 'Event'; value: string | null }
	| { type: 'Str'; value: string }
	| { type: 'FsmString'; value: StrValue }
	| { type: 'Owner'; value: GoRef }
	| { type: 'Var'; value: VarValue }
	| { type: 'GameObject'; value: GoRef }
	| { type: 'Object'; value: GoRef }
	| { type: 'EventTarget'; value: EventTarget }
	| { type: 'Function'; value: Call }
	| { type: 'Template'; value: TemplateControl }
	| { type: 'Enum'; value: EnumValue }
	| { type: 'Array'; value: ArrayValue }
	| { type: 'Property'; value: Property }
	| { type: 'AnimCurve'; value: Curve }
	| { type: 'List'; value: Param[] }
	| { type: 'Pptr'; value: ObjectRef }
	| { type: 'Raw'; value: number[] };

// tag="kind", content="value"
export type StrValue = { kind: 'Var'; value: string } | { kind: 'Literal'; value: string };

// tag="type", content="value"
export type VarValue =
	| { type: 'Var'; value: string }
	| { type: 'Unset' }
	| { type: 'Unused' }
	| { type: 'Float'; value: number }
	| { type: 'Int'; value: number }
	| { type: 'Bool'; value: boolean }
	| { type: 'Str'; value: string }
	| { type: 'Object'; value: ObjectRef }
	| { type: 'Vector'; value: number[] }
	| { type: 'Enum'; value: number }
	| { type: 'Array'; value: ArrayValue };

// tag="kind", content="value"
export type EnumValue =
	| { kind: 'Var'; value: string }
	| { kind: 'Named'; value: { enum_name: string; value: number } }
	| { kind: 'Value'; value: number };

// tag="kind", content="value"
export type ArrayValue =
	| { kind: 'Var'; value: string }
	| { kind: 'Values'; value: Value[] };

// tag="type", content="value"
export type Value =
	| { type: 'Var'; value: string }
	| { type: 'Bool'; value: boolean }
	| { type: 'Int'; value: number }
	| { type: 'Float'; value: number }
	| { type: 'Str'; value: string }
	| { type: 'Vector'; value: number[] }
	| { type: 'Enum'; value: { enum_name: string; value: number } }
	| { type: 'Object'; value: ObjectRef }
	| { type: 'Array'; value: ArrayValue };

// externally tagged: "SelfOwner" | {Var: string} | {Object: ObjectRef}
export type GoRef = 'SelfOwner' | { Var: string } | { Object: ObjectRef };

export interface ObjectRef {
	file: string | null;
	target: RefTarget;
}

// tag="kind", content="target"
export type RefTarget =
	| { kind: 'Path'; target: string }
	| { kind: 'Loose'; target: { name: string | null; id: number } }
	| { kind: 'Null' };

export interface EventTarget {
	kind: number;
	game_object: GoRef;
	fsm_name: string | null;
	fsm: ObjectRef;
	exclude_self: boolean;
	send_to_children: boolean;
}

export interface Call {
	function: string;
	parameter_type: string;
	value: Value | null;
}

export interface TemplateControl {
	template: number;
	inputs: VarOverride[];
	outputs: VarOverride[];
	overrides: VarOverride[];
	events: [string, string][];
}

export interface VarOverride {
	variable: string;
	value: VarValue;
}

export interface Property {
	target: GoRef;
	type_name: string;
	property: string;
	set: boolean;
}

export interface Curve {
	keys: CurveKey[];
	pre_infinity: number;
	post_infinity: number;
	rotation_order: number;
}

export interface CurveKey {
	time: number;
	value: number;
	in_slope: number;
	out_slope: number;
	in_weight: number;
	out_weight: number;
	weighted_mode: number;
}

export interface Variable {
	name: string;
	category: string;
}

// out/<game>/index.json entry
export interface IndexEntry {
	file: string;
	path_id: number;
	name: string;
	hash: string;
}
