import std.json : JSONType, parseJSON;
import std.math : abs;
import std.stdio : stderr;
import std.string : fromStringz, toStringz;

extern(C) int iat_evaluate_parameters_json(
    const(char)* inputPath,
    const(char)* valuesJson,
    char** outJson,
    char** outError,
);
extern(C) void iat_string_free(char* value);

private bool near(double actual, double expected) {
    return abs(actual - expected) <= 0.0001;
}

int main(string[] args) {
    if (args.length != 2) {
        stderr.writeln("parameter-evaluation-probe: expected input.inp");
        return 2;
    }

    char* json;
    char* error;
    auto result = iat_evaluate_parameters_json(
        toStringz(args[1]),
        toStringz(`{"Move X":[1,0],"Move Y":[-1,0]}`),
        &json,
        &error,
    );
    scope(exit) {
        if (json !is null) iat_string_free(json);
        if (error !is null) iat_string_free(error);
    }

    if (result != 0) {
        stderr.writeln(
            "parameter-evaluation-probe: evaluation failed: ",
            error is null ? "<no diagnostic>" : fromStringz(error),
        );
        return 3;
    }
    if (json is null || error !is null) {
        stderr.writeln("parameter-evaluation-probe: invalid success contract");
        return 4;
    }

    auto decoded = parseJSON(fromStringz(json));
    if (decoded["appliedParameters"].type != JSONType.array || decoded["appliedParameters"].array.length != 2 ||
        decoded["targets"].type != JSONType.array || decoded["targets"].array.length != 2 ||
        decoded["restoredParameters"].type != JSONType.array || decoded["restoredParameters"].array.length != 2) {
        stderr.writeln("parameter-evaluation-probe: result inventory mismatch: ", decoded.toString());
        return 5;
    }

    bool appliedX;
    bool appliedY;
    foreach (parameter; decoded["appliedParameters"].array) {
        auto name = parameter["name"].str;
        auto value = parameter["value"].array;
        if (name == "Move X" && near(value[0].floating, 1) && near(value[1].floating, 0)) appliedX = true;
        if (name == "Move Y" && near(value[0].floating, -1) && near(value[1].floating, 0)) appliedY = true;
    }

    bool targetX;
    bool targetY;
    foreach (target; decoded["targets"].array) {
        auto name = target["parameterName"].str;
        auto property = target["property"].str;
        auto path = target["targetPath"].str;
        auto applied = target["appliedValue"].floating;
        auto restored = target["restoredValue"].floating;
        if (path != "/Root/Rig" || !near(restored, 0)) continue;
        if (name == "Move X" && property == "transform.t.x" && near(applied, 20)) targetX = true;
        if (name == "Move Y" && property == "transform.t.y" && near(applied, -12)) targetY = true;
    }

    bool restoredX;
    bool restoredY;
    foreach (parameter; decoded["restoredParameters"].array) {
        auto name = parameter["name"].str;
        auto value = parameter["value"].array;
        if (!near(value[0].floating, 0) || !near(value[1].floating, 0)) continue;
        if (name == "Move X") restoredX = true;
        if (name == "Move Y") restoredY = true;
    }

    if (!appliedX || !appliedY || !targetX || !targetY || !restoredX || !restoredY) {
        stderr.writeln("parameter-evaluation-probe: applied/readback/restore contract mismatch: ", decoded.toString());
        return 6;
    }

    return 0;
}
