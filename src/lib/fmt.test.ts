import { describe, expect, it } from 'vitest';
import { fmtGoRef, fmtObjectRef, fmtValue, short, valueKind } from './fmt';
import type { ObjectRef } from './model';

describe('short', () => {
	it('takes the last dotted segment', () => {
		expect(short('HutongGames.PlayMaker.Actions.SetBoolValue')).toBe('SetBoolValue');
		expect(short('NoDots')).toBe('NoDots');
	});
});

describe('fmtObjectRef', () => {
	it('null target', () => {
		expect(fmtObjectRef({ file: null, target: { kind: 'Null' } })).toBe('<null>');
	});
	it('hierarchy path, with and without file', () => {
		expect(fmtObjectRef({ file: null, target: { kind: 'Path', target: 'A/B@Comp' } })).toBe(
			'A/B@Comp'
		);
		expect(fmtObjectRef({ file: 'x.assets', target: { kind: 'Path', target: 'A@Comp' } })).toBe(
			'A@Comp (x.assets)'
		);
	});
	it('loose object falls back to name, else path id', () => {
		expect(
			fmtObjectRef({ file: 'a.assets', target: { kind: 'Loose', target: { name: 'foo', id: 5 } } })
		).toBe('foo (a.assets)');
		expect(
			fmtObjectRef({ file: null, target: { kind: 'Loose', target: { name: null, id: 7 } } })
		).toBe('loose:7');
	});
});

describe('fmtGoRef', () => {
	it('self / variable / object', () => {
		expect(fmtGoRef('SelfOwner')).toBe('Self');
		expect(fmtGoRef({ Var: 'Hero' })).toBe('var "Hero"');
		const o: ObjectRef = { file: null, target: { kind: 'Null' } };
		expect(fmtGoRef({ Object: o })).toBe('<null>');
	});
});

describe('fmtValue', () => {
	it('scalars and vectors', () => {
		expect(fmtValue({ type: 'Bool', value: true })).toBe('true');
		expect(fmtValue({ type: 'Int', value: 3 })).toBe('3');
		expect(fmtValue({ type: 'Float', value: 1.5 })).toBe('1.5');
		expect(fmtValue({ type: 'Vector', value: [0, 1, 2] })).toBe('(0, 1, 2)');
	});

	it('packed vars and events distinguish null', () => {
		expect(fmtValue({ type: 'PackedVar', value: null })).toBe('(unset)');
		expect(fmtValue({ type: 'PackedVar', value: 'Gravity Scale' })).toBe('var "Gravity Scale"');
		expect(fmtValue({ type: 'Event', value: null })).toBe('(none)');
		expect(fmtValue({ type: 'Event', value: 'SLASH' })).toBe('->"SLASH"');
	});

	it('fsm strings, enums, arrays', () => {
		expect(fmtValue({ type: 'FsmString', value: { kind: 'Literal', value: 'hi' } })).toBe('"hi"');
		expect(fmtValue({ type: 'FsmString', value: { kind: 'Var', value: 'n' } })).toBe('var "n"');
		expect(
			fmtValue({
				type: 'Enum',
				value: { kind: 'Named', value: { enum_name: 'A.B.Mode', value: 1 } }
			})
		).toBe('Mode(1)');
		expect(fmtValue({ type: 'Array', value: { kind: 'Var', value: 'xs' } })).toBe('var "xs"');
		expect(
			fmtValue({ type: 'Array', value: { kind: 'Values', value: [{ type: 'Int', value: 1 }] } })
		).toBe('array[1 elems]');
	});

	it('list reports element count', () => {
		expect(
			fmtValue({
				type: 'List',
				value: [{ name: '', type_name: 'Int', value: { type: 'Int', value: 1 } }]
			})
		).toBe('[1 elems]');
	});
});

describe('valueKind', () => {
	it('flags events and variable bindings for colouring', () => {
		expect(valueKind({ type: 'Event', value: 'X' })).toBe('event');
		expect(valueKind({ type: 'PackedVar', value: 'n' })).toBe('var');
		expect(valueKind({ type: 'Int', value: 1 })).toBe('');
	});
});
