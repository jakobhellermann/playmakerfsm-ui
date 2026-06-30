import { describe, expect, it } from 'vitest';
import { actionText, actionTokens, args, toPseudocode } from './pseudo';
import type { FsmModel } from './model';

describe('args', () => {
	it('joins named params and shows unnamed ones as bare values', () => {
		expect(
			args([
				{ name: 'x', type_name: 'FsmInt', value: { type: 'Int', value: 1 } },
				{ name: '', type_name: 'FsmFloat', value: { type: 'Float', value: 2 } }
			])
		).toBe('x=1, 2');
	});
	it('empty', () => {
		expect(args([])).toBe('');
	});
});

describe('actionText', () => {
	it('marks disabled actions', () => {
		expect(actionText({ class: 'X.Foo', custom_name: null, enabled: true, params: [] })).toBe(
			'Foo()'
		);
		expect(actionText({ class: 'X.Bar', custom_name: null, enabled: false, params: [] })).toBe(
			'Bar()  // disabled'
		);
	});
});

describe('actionTokens', () => {
	it('renders a layerMask array inline with names, index as hover text', () => {
		const tokens = actionTokens({
			class: 'X.RayCast',
			custom_name: null,
			enabled: true,
			params: [
				{
					name: 'layerMask',
					type_name: 'Array',
					value: {
						type: 'List',
						value: [
							{
								name: '',
								type_name: 'FsmInt',
								value: { type: 'Layer', value: { index: 8, name: 'Terrain' } }
							},
							{
								name: '',
								type_name: 'FsmInt',
								value: { type: 'Layer', value: { index: 25, name: 'Soft Terrain' } }
							}
						]
					}
				}
			]
		});
		expect(tokens.map((t) => t.text).join('')).toBe('RayCast(layerMask=[Terrain, Soft Terrain])');
		expect(tokens.find((t) => t.text === 'Terrain')?.title).toBe('layer 8');
		expect(tokens.find((t) => t.text === 'Soft Terrain')?.title).toBe('layer 25');
	});

	it('highlights a var embedded in an eventTarget', () => {
		const tokens = actionTokens({
			class: 'X.SendEventByName',
			custom_name: null,
			enabled: true,
			params: [
				{
					name: 'eventTarget',
					type_name: 'FsmEventTarget',
					value: {
						type: 'EventTarget',
						value: {
							kind: 1,
							game_object: { Var: 'HUD Canvas' },
							fsm_name: null,
							fsm: { file: null, target: { kind: 'Null' } },
							exclude_self: false,
							send_to_children: false
						}
					}
				}
			]
		});
		expect(tokens.map((t) => t.text).join('')).toBe(
			'SendEventByName(eventTarget=GameObject(var "HUD Canvas"))'
		);
		expect(tokens.find((t) => t.cls === 'var')?.text).toBe('var "HUD Canvas"');
	});
});

describe('toPseudocode', () => {
	it('renders states, transitions and global transitions', () => {
		const m: FsmModel = {
			name: 'Demo',
			start_state: 'A',
			events: [],
			global_transitions: [{ event: 'GO', to_state: 'B' }],
			states: [
				{
					name: 'A',
					is_start: true,
					position: { x: 0, y: 0, w: 0, h: 0 },
					transitions: [{ event: 'NEXT', to_state: 'B' }],
					actions: [
						{
							class: 'X.Foo',
							custom_name: null,
							enabled: true,
							params: [{ name: 'p', type_name: 'FsmBool', value: { type: 'Bool', value: true } }]
						}
					]
				},
				{
					name: 'B',
					is_start: false,
					position: { x: 0, y: 0, w: 0, h: 0 },
					transitions: [],
					actions: [{ class: 'X.Bar', custom_name: null, enabled: false, params: [] }]
				}
			],
			variables: []
		};
		expect(toPseudocode(m)).toBe(
			`fsm Demo {
  start A
  on GO -> B  // from any state

  state A {
    Foo(p=true)
    on NEXT -> B
  }

  state B {
    Bar()  // disabled
  }
}`
		);
	});
});
