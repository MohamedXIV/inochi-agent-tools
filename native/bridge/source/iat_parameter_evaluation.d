module iat_parameter_evaluation;

import core.stdc.stdlib : malloc;
import core.stdc.string : memcpy;
import inmath : vec2;
import inochi2d.core.format.inp : inLoadPuppet;
import inochi2d.core.nodes : Node;
import inochi2d.core.param : Parameter;
import inochi2d.core.puppet : Puppet;
import std.json : JSONType, JSONValue, parseJSON, toJSON;
import std.math : abs, isFinite;
import std.string : fromStringz, split;

private struct EvaluationTarget {
    string parameterName;
    string targetPath;
    string property;
    Node target;
    float baselineValue;
    float appliedValue;
}

private char* copyCString(string value) nothrow {
    auto memory = cast(char*) malloc(value.length + 1);
    if (memory is null) return null;
    if (value.length > 0) memcpy(memory, value.ptr, value.length);
    memory[value.length] = '\0';
    return memory;
}

private int fail(char** outError, int code, string message) nothrow {
    if (outError !is null) *outError = copyCString(message);
    return code;
}

private Node resolveNodePath(Puppet puppet, string path) {
    if (puppet is null || puppet.root is null || path.length == 0 || path[0] != '/') return null;
    auto segments = path.split("/");
    if (segments.length < 2 || segments[1] != puppet.root.name.value) return null;
    Node current = puppet.root;
    foreach (segment; segments[2 .. $]) {
        if (segment.length == 0) return null;
        Node found;
        size_t matches;
        foreach (child; current.children) {
            if (child.name.value == segment) { found = child; matches++; }
        }
        if (matches != 1) return null;
        current = found;
    }
    return current;
}

private string semanticNodePath(Node node) {
    if (node is null || node.puppet is null || node.puppet.root is null) return "";
    auto root = node.puppet.root;
    string path;
    Node current = node;
    while (current !is null) {
        path = "/" ~ current.name.value ~ path;
        if (current is root) return path;
        current = current.parent;
    }
    return "";
}

private Parameter resolveParameterName(Puppet puppet, string name) {
    Parameter found;
    size_t matches;
    foreach (parameter; puppet.parameters) {
        if (parameter.name.value == name) { found = parameter; matches++; }
    }
    return matches == 1 ? found : null;
}

private bool decodePair(ref JSONValue value, out vec2 pair) {
    if (value.type != JSONType.array || value.array.length != 2) return false;
    float number(ref JSONValue item, out bool ok) {
        ok = true;
        final switch (item.type) {
            case JSONType.float_: return cast(float) item.floating;
            case JSONType.integer: return cast(float) item.integer;
            case JSONType.uinteger: return cast(float) item.uinteger;
            default: ok = false; return 0;
        }
    }
    bool xOk;
    bool yOk;
    auto x = number(value.array[0], xOk);
    auto y = number(value.array[1], yOk);
    if (!xOk || !yOk || !isFinite(x) || !isFinite(y)) return false;
    pair = vec2(x, y);
    return true;
}

private bool inRange(Parameter parameter, vec2 value) {
    if (value.x < parameter.min.x || value.x > parameter.max.x) return false;
    if (!parameter.isVec2) return value.y == 0;
    return value.y >= parameter.min.y && value.y <= parameter.max.y;
}

private JSONValue parameterEntry(Parameter parameter) {
    JSONValue item = JSONValue.emptyObject;
    item["name"] = parameter.name.value;
    item["value"] = JSONValue([parameter.value.x, parameter.value.y]);
    return item;
}

export extern(C) int iat_evaluate_parameters_json(
    const(char)* inputPath,
    const(char)* valuesJson,
    char** outJson,
    char** outError,
) nothrow {
    if (outJson is null || outError is null) return 2;
    *outJson = null;
    *outError = null;
    if (inputPath is null || valuesJson is null) return fail(outError, 2, "input path and parameter values are required");

    try {
        auto input = fromStringz(inputPath).idup;
        auto values = parseJSON(fromStringz(valuesJson).idup);
        if (values.type != JSONType.object || values.object.length == 0) return fail(outError, 10, "parameter values must be a non-empty object");

        auto puppet = inLoadPuppet!Puppet(input);
        scope(exit) destroy(puppet);
        if (puppet is null) return fail(outError, 1, "failed loading puppet for parameter evaluation");

        // Establish serialized/default parameter offsets before recording baselines.
        puppet.update(0);

        Parameter[] requestedParameters;
        vec2[] requestedValues;
        EvaluationTarget[] targets;
        foreach (name, ref rawValue; values.object) {
            auto parameter = resolveParameterName(puppet, name);
            vec2 requested;
            if (parameter is null || !decodePair(rawValue, requested) || !inRange(parameter, requested)) {
                return fail(outError, 10, "unknown parameter or out-of-range parameter value");
            }
            requestedParameters ~= parameter;
            requestedValues ~= requested;
            foreach (binding; parameter.bindings) {
                auto target = binding.getNode();
                auto targetPath = semanticNodePath(target);
                auto property = binding.getName();
                if (target is null || targetPath.length == 0 || !target.hasParam(property)) {
                    return fail(outError, 10, "invalid parameter binding during evaluation");
                }
                targets ~= EvaluationTarget(name, targetPath, property, target, target.getValue(property), 0);
            }
        }

        foreach (index, parameter; requestedParameters) parameter.value = requestedValues[index];
        puppet.update(0);

        JSONValue appliedParameters = JSONValue.emptyArray;
        foreach (parameter; requestedParameters) appliedParameters.array ~= parameterEntry(parameter);
        foreach (ref target; targets) target.appliedValue = target.target.getValue(target.property);

        foreach (parameter; requestedParameters) parameter.value = parameter.defaults;
        puppet.update(0);

        JSONValue restoredParameters = JSONValue.emptyArray;
        foreach (parameter; requestedParameters) restoredParameters.array ~= parameterEntry(parameter);
        JSONValue targetResults = JSONValue.emptyArray;
        enum tolerance = 0.0001f;
        foreach (ref target; targets) {
            auto restored = target.target.getValue(target.property);
            if (abs(restored - target.baselineValue) > tolerance) {
                return fail(outError, 6, "parameter evaluation failed to restore target defaults");
            }
            JSONValue item = JSONValue.emptyObject;
            item["parameterName"] = target.parameterName;
            item["targetPath"] = target.targetPath;
            item["property"] = target.property;
            item["appliedValue"] = target.appliedValue;
            item["restoredValue"] = restored;
            targetResults.array ~= item;
        }

        JSONValue result = JSONValue.emptyObject;
        result["appliedParameters"] = appliedParameters;
        result["targets"] = targetResults;
        result["restoredParameters"] = restoredParameters;
        auto json = result.toJSON();
        *outJson = copyCString(json);
        if (*outJson is null) return fail(outError, 1, "failed allocating parameter evaluation result");
        return 0;
    } catch (Throwable error) {
        return fail(outError, 1, error.msg.idup);
    }
}
