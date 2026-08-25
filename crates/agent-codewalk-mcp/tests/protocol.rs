//! Cross-language protocol contract.
//!
//! The fixtures in `protocol/fixtures` are shared with the TypeScript validator. This
//! suite pins the Rust half: which documents deserialize, and which are rejected before
//! they ever reach the editor.

use agent_codewalk_mcp::model::Walkthrough;
use serde_json::Value;

const VALID_MINIMAL: &str = include_str!("../../../protocol/fixtures/valid-minimal.json");
const NEGATIVE: &str = include_str!("../../../protocol/fixtures/invalid.json");

#[test]
fn accepts_the_shared_minimal_fixture() {
    let walkthrough: Walkthrough = serde_json::from_str(VALID_MINIMAL).unwrap();
    assert_eq!(walkthrough.schema_version, 1);
    assert_eq!(walkthrough.file_order, vec!["ready"]);
    assert!(walkthrough.uncovered_hunks.is_empty());
}

#[test]
fn accepts_the_negative_fixture_base() {
    let base = negative_fixture()["base"].clone();
    let walkthrough: Walkthrough = serde_json::from_value(base).unwrap();
    assert_eq!(walkthrough.steps.len(), 2);
    assert_eq!(walkthrough.flow_order, vec!["ready", "caller"]);
}

#[test]
fn rejects_exactly_the_cases_the_contract_assigns_to_deserialization() {
    let fixture = negative_fixture();
    let base = fixture["base"].clone();
    let cases = fixture["cases"].as_array().expect("cases must be an array");
    assert!(!cases.is_empty(), "the negative contract must not be empty");

    for case in cases {
        let name = case["name"].as_str().expect("case name");
        let layer = case["layer"].as_str().expect("case layer");
        let document = mutate(base.clone(), case);
        let parsed = serde_json::from_value::<Walkthrough>(document);
        if layer == "deserialization" {
            assert!(
                parsed.is_err(),
                "{name} must be rejected by Rust deserialization"
            );
        } else {
            assert!(
                parsed.is_ok(),
                "{name} is a {layer} case, so Rust must accept it and reject it at publish time: {:?}",
                parsed.err()
            );
        }
    }
}

#[test]
fn covers_every_enforcement_layer() {
    let fixture = negative_fixture();
    let mut layers: Vec<&str> = fixture["cases"]
        .as_array()
        .expect("cases must be an array")
        .iter()
        .map(|case| case["layer"].as_str().expect("case layer"))
        .collect();
    layers.sort_unstable();
    layers.dedup();
    assert_eq!(layers, vec!["deserialization", "schema", "semantics"]);
}

#[test]
fn round_trips_a_published_walkthrough() {
    let walkthrough: Walkthrough = serde_json::from_str(VALID_MINIMAL).unwrap();
    let encoded = serde_json::to_string(&walkthrough).unwrap();
    let decoded: Walkthrough = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded.id, walkthrough.id);
    assert_eq!(decoded.steps.len(), walkthrough.steps.len());
    assert_eq!(
        decoded.steps[0].anchor.normalized_hash,
        walkthrough.steps[0].anchor.normalized_hash
    );
}

fn negative_fixture() -> Value {
    serde_json::from_str(NEGATIVE).expect("the negative fixture must be valid JSON")
}

/// Applies a case mutation, addressing nested values with dotted paths.
fn mutate(mut document: Value, case: &Value) -> Value {
    if let Some(assignments) = case.get("set").and_then(Value::as_object) {
        for (path, value) in assignments {
            assign(&mut document, path, Some(value.clone()));
        }
    }
    if let Some(removals) = case.get("delete").and_then(Value::as_array) {
        for path in removals {
            assign(
                &mut document,
                path.as_str().expect("delete path must be a string"),
                None,
            );
        }
    }
    document
}

fn assign(document: &mut Value, path: &str, value: Option<Value>) {
    let segments: Vec<&str> = path.split('.').collect();
    let (last, parents) = segments.split_last().expect("a path must not be empty");
    let mut current = document;
    for segment in parents {
        current = descend(current, segment);
    }
    match value {
        Some(value) => {
            *descend(current, last) = value;
        }
        None => {
            current
                .as_object_mut()
                .expect("delete targets an object")
                .remove(*last);
        }
    }
}

fn descend<'a>(current: &'a mut Value, segment: &str) -> &'a mut Value {
    if let Ok(index) = segment.parse::<usize>()
        && current.is_array()
    {
        return current
            .get_mut(index)
            .expect("fixture path addresses an existing array element");
    }
    current
        .as_object_mut()
        .expect("fixture path addresses an object")
        .entry(segment.to_owned())
        .or_insert(Value::Null)
}
