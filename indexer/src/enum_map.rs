//! Resolve C# enum param values to their member names by reading the game assembly.
//!
//! PlayMaker FSMs store enum params as plain ints with a generic `Enum` type tag. The actual enum
//! type is determined by the action class + field name, so we build a `(class, field) → {int → member}`
//! map from the assembly and bake the member names into the model at decode time.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::Path;

use dotnetdll::prelude::*;
use dotnetdll::resolved::members::Constant;
use dotnetdll::resolved::types::{BaseType, MemberType, TypeSource, UserType};
use playmakerfsm::model::{FsmModel, ParamValue};

/// `(action class full name, field name)` → `{enum int value → member name}`
pub type EnumMap = HashMap<(String, String), HashMap<i32, String>>;

/// If `ty` is a same-assembly (Definition) enum, its `{value → member}` table, else `None`.
fn enum_members(res: &Resolution, ty: &MemberType) -> Option<HashMap<i32, String>> {
	let MemberType::Base(b) = ty else {
		return None;
	};
	let BaseType::Type {
		source: TypeSource::User(UserType::Definition(idx)),
		..
	} = b.as_ref()
	else {
		return None;
	};
	let td = &res[*idx];
	// every enum has a synthetic `value__` field holding the underlying value
	if !td.fields.iter().any(|f| f.name == "value__") {
		return None;
	}
	let members: HashMap<i32, String> = td
		.fields
		.iter()
		.filter(|f| f.literal)
		.filter_map(|f| match &f.default {
			Some(Constant::Int32(v)) => Some((*v, f.name.to_string())),
			_ => None,
		})
		.collect();
	(!members.is_empty()).then_some(members)
}

/// Map every action field whose type is a same-assembly enum to its `{value → member}` table.
pub fn build_enum_map(managed: &Path) -> EnumMap {
	let mut map = EnumMap::new();
	let Ok(bytes) = std::fs::read(managed.join("Assembly-CSharp.dll")) else {
		return map;
	};
	let Ok(res) = Resolution::parse(&bytes, ReadOptions::default()) else {
		return map;
	};
	for (_idx, td) in res.enumerate_type_definitions() {
		let class = match &td.namespace {
			Some(ns) if !ns.is_empty() => format!("{ns}.{}", td.name),
			_ => td.name.to_string(),
		};
		for f in &td.fields {
			if let Some(members) = enum_members(&res, &f.return_type) {
				map.insert((class.clone(), f.name.to_string()), members);
			}
		}
	}
	map
}

/// Replace `Enum`-typed int params with their resolved member name where the assembly map knows it.
pub fn bake_enums(model: &mut FsmModel<'_>, map: &EnumMap) {
	for state in &mut model.states {
		for action in &mut state.actions {
			for param in &mut action.params {
				if param.type_name != "Enum" {
					continue;
				}
				let ParamValue::Int(v) = param.value else {
					continue;
				};
				let key = (action.class.to_string(), param.name.to_string());
				if let Some(name) = map.get(&key).and_then(|m| m.get(&v)) {
					param.value = ParamValue::EnumMember(Cow::Owned(name.clone()));
				}
			}
		}
	}
}
