//! Resolve C# enum param values to their member names by reading the game assembly.
//!
//! PlayMaker FSMs store enums two ways. A generic `Enum` param is a plain int with no type info — the
//! enum type is implied by the action class + field name, so we resolve it via a `(class, field) →
//! {int → member}` map. A typed `FsmEnum` param already carries its enum type's full name (e.g.
//! `HutongGames.PlayMaker.Actions.HeroBoxControl+HeroBoxState`) but only a numeric value, so we resolve
//! it via a `full type name → {int → member}` map. Both member names are baked into the model at decode
//! time.

use std::borrow::Cow;
use std::collections::HashMap;
use std::path::Path;

use dotnetdll::prelude::*;
use dotnetdll::resolved::members::Constant;
use dotnetdll::resolved::types::{BaseType, MemberType, TypeSource, UserType};
use playmakerfsm::model::{EnumValue, FsmModel, ParamValue};

/// `(action class full name, field name)` → `{enum int value → member name}`
pub type EnumMap = HashMap<(String, String), HashMap<i32, String>>;

/// Resolved enum tables built from the assembly: `by_field` for generic `Enum` params (no type info),
/// `by_name` (full type name → members) for typed `FsmEnum` params that carry their enum type name.
pub struct EnumMaps {
    pub by_field: EnumMap,
    pub by_name: HashMap<String, HashMap<i32, String>>,
}

/// `{value → member}` for an enum type definition, or `None` if `td` isn't an enum.
fn members_of(td: &dotnetdll::resolved::types::TypeDefinition) -> Option<HashMap<i32, String>> {
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
    members_of(&res[*idx])
}

/// The full type name in PlayMaker's `enumName` form: `Namespace.Outer+Nested` (`+` per nesting level).
fn full_type_name(res: &Resolution, td: &dotnetdll::resolved::types::TypeDefinition) -> String {
    match td.encloser {
        Some(enc) => format!("{}+{}", full_type_name(res, &res[enc]), td.name),
        None => match &td.namespace {
            Some(ns) if !ns.is_empty() => format!("{ns}.{}", td.name),
            _ => td.name.to_string(),
        },
    }
}

/// Build both enum tables from the game's `Assembly-CSharp.dll`.
pub fn build_enum_map(managed: &Path) -> EnumMaps {
    let mut by_field = EnumMap::new();
    let mut by_name = HashMap::new();
    let Ok(bytes) = std::fs::read(managed.join("Assembly-CSharp.dll")) else {
        return EnumMaps { by_field, by_name };
    };
    let Ok(res) = Resolution::parse(&bytes, ReadOptions::default()) else {
        return EnumMaps { by_field, by_name };
    };
    for (_idx, td) in res.enumerate_type_definitions() {
        // by_name: the type itself, if it's an enum (resolves typed FsmEnum params).
        if let Some(members) = members_of(td) {
            by_name.insert(full_type_name(&res, td), members);
        }
        // by_field: action fields whose type is a same-assembly enum (resolves generic Enum params).
        let class = match &td.namespace {
            Some(ns) if !ns.is_empty() => format!("{ns}.{}", td.name),
            _ => td.name.to_string(),
        };
        for f in &td.fields {
            if let Some(members) = enum_members(&res, &f.return_type) {
                by_field.insert((class.clone(), f.name.to_string()), members);
            }
        }
    }
    EnumMaps { by_field, by_name }
}

/// Replace enum param values with their resolved member name where the assembly maps know it: generic
/// `Enum` ints via `by_field`, typed `FsmEnum` (`Named`) values via `by_name`.
pub fn bake_enums(model: &mut FsmModel<'_>, maps: &EnumMaps) {
    for state in &mut model.states {
        for action in &mut state.actions {
            for param in &mut action.params {
                let resolved = match &param.value {
                    ParamValue::Int(v) if param.type_name == "Enum" => {
                        let key = (action.class.to_string(), param.name.to_string());
                        maps.by_field.get(&key).and_then(|m| m.get(v)).cloned()
                    }
                    ParamValue::Enum(EnumValue::Named { enum_name, value }) => maps
                        .by_name
                        .get(enum_name)
                        .and_then(|m| m.get(value))
                        .cloned(),
                    _ => None,
                };
                if let Some(name) = resolved {
                    param.value = ParamValue::EnumMember(Cow::Owned(name));
                }
            }
        }
    }
}
